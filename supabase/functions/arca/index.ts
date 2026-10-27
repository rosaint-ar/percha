// arca · factura electrónica (ARCA, ex AFIP): web services WSAA (acceso) + WSFEv1 (CAE).
// Acciones (body.accion):
//   csr          (admin) genera la clave privada (queda cifrada en Vault, nunca sale del servidor) y el pedido de certificado (CSR)
//   certificado  (admin) guarda el certificado .crt que devolvió ARCA (tiene que corresponder a la clave) y prueba la conexión
//   probar       (admin) ARCA responde · acceso con el certificado · punto de venta habilitado · último número
//   facturar     (miembro) manda a ARCA lo pendiente de la empresa (o body.comprobante_id) y devuelve cómo quedó
//   (cron, x-cron-key) manda lo pendiente de todas las empresas
// Numeración: uno a la vez por empresa (turno en facturacion_config). Antes de pedir un número se guarda en numero_intento;
// si ARCA no contestó y después aparece ese número autorizado con el mismo importe y documento, se recupera el CAE.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import forge from "https://esm.sh/node-forge@1.3.1";
const SB_URL = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const URLS = {
  produccion: { wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms", wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx" },
  homologacion: { wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms", wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx" },
} as const;
const r2 = (n: number) => Math.round((+n || 0) * 100) / 100;
const imp = (n: number) => r2(n).toFixed(2);
const xesc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const desesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml: string, t: string) => { const m = new RegExp(`<(?:\\w+:)?${t}>([\\s\\S]*?)</(?:\\w+:)?${t}>`).exec(xml); return m ? m[1] : null; };
const tags = (xml: string, t: string) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${t}>([\\s\\S]*?)</(?:\\w+:)?${t}>`, "g"))].map((m) => m[1]);
// fecha y hora de Argentina (UTC−3, sin horario de verano)
const enAR = (d = new Date()) => new Date(d.getTime() - 3 * 3600 * 1000);
const isoAR = (d: Date) => enAR(d).toISOString().replace(/\.\d+Z$/, "-03:00");
const hoyAR = () => enAR().toISOString().slice(0, 10).replace(/-/g, "");
const fechaArca = (s: string | null) => s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;

async function soap(url: string, action: string, cuerpo: string, ns = "http://ar.gov.afip.dif.FEV1/") {
  const env = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${ns}"><soap:Body>${cuerpo}</soap:Body></soap:Envelope>`;
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 40000);
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: action }, body: env, signal: ctl.signal });
    const t = await r.text();
    const falla = tag(t, "faultstring");
    if (falla) throw new Error(desesc(falla));
    if (!r.ok) throw new Error(`ARCA respondió ${r.status}`);
    return t;
  } finally { clearTimeout(to); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(SB_URL, SERVICE);
  const body = await req.json().catch(() => ({}));
  const accion = body.accion || "facturar";
  const { data: ck } = await admin.from("app_config").select("valor").eq("clave", "cron_key").maybeSingle();
  const esCron = !!(req.headers.get("x-cron-key") && ck?.valor && req.headers.get("x-cron-key") === ck.valor);
  let empresas: string[] = [];
  if (esCron && accion === "simular" && body.empresa_id) {
    empresas = [body.empresa_id];
  } else if (esCron) {
    const { data } = await admin.from("comprobantes").select("empresa_id").eq("estado", "pendiente");
    empresas = [...new Set((data || []).map((x: any) => x.empresa_id))];
  } else {
    const comoUsuario = createClient(SB_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await comoUsuario.auth.getUser();
    if (!user) return json({ error: "Sesión inválida" }, 401);
    if (!body.empresa_id) return json({ error: "Falta empresa_id" }, 400);
    const { data: miembro } = await comoUsuario.rpc("es_miembro", { e: body.empresa_id });
    if (!miembro) return json({ error: "No pertenecés a esta empresa" }, 403);
    if (accion !== "facturar") { const { data: adm } = await comoUsuario.rpc("es_admin", { e: body.empresa_id }); if (!adm) return json({ error: "Solo administración" }, 403); }
    empresas = [body.empresa_id];
  }

  const cfgDe = async (e: string) => (await admin.from("facturacion_config").select("*").eq("empresa_id", e).maybeSingle()).data;
  const empDe = async (e: string) => (await admin.from("empresas").select("id,nombre,razon_social,cuit,condicion_iva").eq("id", e).single()).data;
  const cuitDe = (cfg: any, emp: any) => String(cfg?.cuit || emp?.cuit || "").replace(/\D/g, "");

  // ---------- acceso (WSAA): ticket de 12 h, guardado para no pedir otro (ARCA rechaza pedir uno nuevo si el anterior sigue vigente) ----------
  async function acceso(e: string, cfg: any) {
    const { data: tk } = await admin.from("arca_tokens").select("*").eq("empresa_id", e).eq("ambiente", cfg.ambiente).eq("servicio", "wsfe").maybeSingle();
    if (tk && new Date(tk.expira).getTime() - Date.now() > 10 * 60 * 1000) return { token: tk.token, sign: tk.sign };
    const { data: pem, error } = await admin.rpc("arca_clave", { e });
    if (error || !pem) throw new Error("No está la clave del certificado: generá el pedido de certificado de nuevo");
    if (!cfg.cert_pem) throw new Error("Falta subir el certificado de ARCA");
    const ahora = new Date();
    const tra = `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>${Math.floor(ahora.getTime() / 1000)}</uniqueId><generationTime>${isoAR(new Date(ahora.getTime() - 10 * 60 * 1000))}</generationTime><expirationTime>${isoAR(new Date(ahora.getTime() + 10 * 60 * 1000))}</expirationTime></header><service>wsfe</service></loginTicketRequest>`;
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(tra, "utf8");
    const cert = forge.pki.certificateFromPem(cfg.cert_pem);
    p7.addCertificate(cert);
    p7.addSigner({ key: forge.pki.privateKeyFromPem(pem), certificate: cert, digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [{ type: forge.pki.oids.contentType, value: forge.pki.oids.data }, { type: forge.pki.oids.messageDigest }, { type: forge.pki.oids.signingTime, value: new Date() }] });
    p7.sign();
    const cms = forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
    const r = await soap(URLS[cfg.ambiente as "produccion"].wsaa, "", `<wsaa:loginCms xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms>`, "http://wsaa.view.sua.dvadac.desein.afip.gov");
    const ret = desesc(tag(r, "loginCmsReturn") || "");
    const token = tag(ret, "token"), sign = tag(ret, "sign"), exp = tag(ret, "expirationTime");
    if (!token || !sign) throw new Error("ARCA no dio acceso: " + (ret || r).slice(0, 300));
    await admin.from("arca_tokens").upsert({ empresa_id: e, ambiente: cfg.ambiente, servicio: "wsfe", token, sign, expira: exp || new Date(Date.now() + 11 * 3600 * 1000).toISOString() });
    return { token, sign };
  }
  const authXml = (a: any, cuit: string) => `<ar:Auth><ar:Token>${a.token}</ar:Token><ar:Sign>${a.sign}</ar:Sign><ar:Cuit>${cuit}</ar:Cuit></ar:Auth>`;
  const erroresDe = (xml: string) => [...tags(xml, "Err"), ...tags(xml, "Obs")].map((x) => `${tag(x, "Code") || ""} ${desesc(tag(x, "Msg") || "")}`.trim()).filter(Boolean);
  async function ultimo(cfg: any, a: any, cuit: string, tipo: number) {
    const r = await soap(URLS[cfg.ambiente as "produccion"].wsfe, "http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado",
      `<ar:FECompUltimoAutorizado>${authXml(a, cuit)}<ar:PtoVta>${cfg.punto_venta}</ar:PtoVta><ar:CbteTipo>${tipo}</ar:CbteTipo></ar:FECompUltimoAutorizado>`);
    const n = tag(r, "CbteNro"); if (n === null) throw new Error(erroresDe(r).join(" · ") || "ARCA no devolvió el último número");
    return +n;
  }
  async function consultar(cfg: any, a: any, cuit: string, tipo: number, nro: number) {
    const r = await soap(URLS[cfg.ambiente as "produccion"].wsfe, "http://ar.gov.afip.dif.FEV1/FECompConsultar",
      `<ar:FECompConsultar>${authXml(a, cuit)}<ar:FeCompConsReq><ar:CbteTipo>${tipo}</ar:CbteTipo><ar:CbteNro>${nro}</ar:CbteNro><ar:PtoVta>${cfg.punto_venta}</ar:PtoVta></ar:FeCompConsReq></ar:FECompConsultar>`);
    const g = tag(r, "ResultGet"); if (!g) return null;
    return { total: +(tag(g, "ImpTotal") || 0), doc: tag(g, "DocNro"), cae: tag(g, "CodAutorizacion"), vence: tag(g, "FchVto"), fecha: tag(g, "CbteFch") };
  }

  // ---------- el renglón del pedido a ARCA (FECAEDetRequest) ----------
  function armarDetalle(c: any, nro: number, asoc: any, cuit: string, fch: string) {
    const total = r2(+c.total), esC = [11, 12, 13].includes(c.tipo);
    const neto = esC ? total : r2(total / 1.21), iva = esC ? 0 : r2(total - neto);
    const asocXml = asoc ? `<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>${asoc.tipo}</ar:Tipo><ar:PtoVta>${asoc.punto_venta}</ar:PtoVta><ar:Nro>${asoc.numero}</ar:Nro><ar:Cuit>${cuit}</ar:Cuit><ar:CbteFch>${String(asoc.fecha || "").replace(/-/g, "")}</ar:CbteFch></ar:CbteAsoc></ar:CbtesAsoc>` : "";
    const ivaXml = esC ? "" : `<ar:Iva><ar:AlicIva><ar:Id>5</ar:Id><ar:BaseImp>${imp(neto)}</ar:BaseImp><ar:Importe>${imp(iva)}</ar:Importe></ar:AlicIva></ar:Iva>`;
    return `<ar:Concepto>1</ar:Concepto><ar:DocTipo>${c.doc_tipo}</ar:DocTipo><ar:DocNro>${c.doc_nro}</ar:DocNro><ar:CbteDesde>${nro}</ar:CbteDesde><ar:CbteHasta>${nro}</ar:CbteHasta><ar:CbteFch>${fch}</ar:CbteFch>`
      + `<ar:ImpTotal>${imp(total)}</ar:ImpTotal><ar:ImpTotConc>0.00</ar:ImpTotConc><ar:ImpNeto>${imp(neto)}</ar:ImpNeto><ar:ImpOpEx>0.00</ar:ImpOpEx><ar:ImpTrib>0.00</ar:ImpTrib><ar:ImpIVA>${imp(iva)}</ar:ImpIVA>`
      + `<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz><ar:CondicionIVAReceptorId>${c.receptor_condicion}</ar:CondicionIVAReceptorId>${asocXml}${ivaXml}`;
  }

  // ---------- mandar un comprobante ----------
  async function mandar(c: any, cfg: any, emp: any, a: any) {
    const cuit = cuitDe(cfg, emp);
    let asoc: any = null;
    if (c.asociado_id) {
      asoc = (await admin.from("comprobantes").select("*").eq("id", c.asociado_id).single()).data;
      if (!asoc || asoc.estado !== "autorizado") return { estado: "pendiente", error: "La factura original todavía no está autorizada" };
    }
    const ult = await ultimo(cfg, a, cuit, c.tipo);
    // ¿ARCA ya autorizó el número que pedimos la vez anterior y no llegamos a enterarnos?
    if (c.numero_intento && ult >= c.numero_intento) {
      const q = await consultar(cfg, a, cuit, c.tipo, c.numero_intento);
      if (q && Math.abs(q.total - +c.total) < 0.01 && String(q.doc) === String(c.doc_nro) && q.cae) {
        const fila = { estado: "autorizado", numero: c.numero_intento, cae: q.cae, cae_vence: fechaArca(q.vence), fecha: fechaArca(q.fecha), autorizado: new Date().toISOString(), errores: null, observaciones: "Recuperado de ARCA" };
        await admin.from("comprobantes").update(fila).eq("id", c.id); return fila;
      }
    }
    const nro = ult + 1;
    await admin.from("comprobantes").update({ numero_intento: nro, intentos: (c.intentos || 0) + 1 }).eq("id", c.id);
    const fch = c.fecha && !c.asociado_id ? String(c.fecha).slice(0, 10).replace(/-/g, "") : hoyAR();   // la fecha elegida al facturar (la nota de crédito, del día)
    const det = armarDetalle(c, nro, asoc, cuit, fch);
    let r: string;
    try {
      r = await soap(URLS[cfg.ambiente as "produccion"].wsfe, "http://ar.gov.afip.dif.FEV1/FECAESolicitar",
        `<ar:FECAESolicitar>${authXml(a, cuit)}<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${cfg.punto_venta}</ar:PtoVta><ar:CbteTipo>${c.tipo}</ar:CbteTipo></ar:FeCabReq><ar:FeDetReq><ar:FECAEDetRequest>${det}</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq></ar:FECAESolicitar>`);
    } catch (err) {
      // sin respuesta: queda pendiente con el número pedido; la próxima vuelta se fija si ARCA lo autorizó
      const msg = "ARCA no respondió: " + String((err as Error).message || err).slice(0, 200);
      await admin.from("comprobantes").update({ errores: msg }).eq("id", c.id);
      return { estado: "pendiente", error: msg };
    }
    const res = tag(r, "FECAEDetResponse") || "", resultado = tag(res, "Resultado") || tag(r, "Resultado");
    const errs = erroresDe(r), cae = tag(res, "CAE");
    if (resultado === "A" && cae) {
      const fila = { estado: "autorizado", numero: nro, cae, cae_vence: fechaArca(tag(res, "CAEFchVto")), fecha: fechaArca(fch), autorizado: new Date().toISOString(), errores: null, observaciones: errs.join(" · ") || null, respuesta: r.slice(0, 4000) };
      await admin.from("comprobantes").update(fila).eq("id", c.id); return fila;
    }
    // número que no es el siguiente (otro sistema facturó en el medio): se reintenta sola en la próxima vuelta
    if (errs.some((x) => x.startsWith("10016"))) { await admin.from("comprobantes").update({ numero_intento: null, errores: errs.join(" · ") }).eq("id", c.id); return { estado: "pendiente", error: errs.join(" · ") }; }
    const fila = { estado: "rechazado", numero_intento: null, errores: errs.join(" · ") || "ARCA rechazó el comprobante", respuesta: r.slice(0, 4000) };
    await admin.from("comprobantes").update(fila).eq("id", c.id); return fila;
  }

  try {
    if (accion === "simular") {
      const e = empresas[0]; const emp = await empDe(e); const cfg = await cfgDe(e); const cuit = cuitDe(cfg, emp);
      const { data: v } = await admin.from("ventas").select("id,numero,total,estado,reservada").eq("id", body.venta_id).eq("empresa_id", e).maybeSingle();
      if (!v) return json({ error: "No existe esa venta" }, 400);
      const pasos: any[] = []; const paso = (nombre: string, ok: boolean, detalle = "") => pasos.push({ nombre, ok, detalle });
      const a = await acceso(e, cfg); paso("Acceso a ARCA", true, "con el certificado de Percha");
      const tipo = emp.condicion_iva === "responsable_inscripto" ? 6 : 11;
      const ult = await ultimo(cfg, a, cuit, tipo); paso("Próximo número", true, `${String(cfg.punto_venta).padStart(5, "0")}-${String(ult + 1).padStart(8, "0")}`);
      const ws = URLS[cfg.ambiente as "produccion"].wsfe;
      const ci = await soap(ws, "http://ar.gov.afip.dif.FEV1/FEParamGetCondicionIvaReceptor", `<ar:FEParamGetCondicionIvaReceptor>${authXml(a, cuit)}<ar:ClaseCmp>${tipo === 11 ? "C" : "B"}</ar:ClaseCmp></ar:FEParamGetCondicionIvaReceptor>`);
      const conds = tags(ci, "CondicionIvaReceptor").map((x) => ({ id: +(tag(x, "Id") || 0), desc: desesc(tag(x, "Desc") || "") }));
      const cf = conds.find((x) => x.id === 5); paso("Consumidor final aceptado en Factura " + (tipo === 11 ? "C" : "B"), !!cf, cf ? cf.desc : conds.map((x) => x.id + " " + x.desc).join(", ") || erroresDe(ci).join(" · "));
      const tc = await soap(ws, "http://ar.gov.afip.dif.FEV1/FEParamGetTiposCbte", `<ar:FEParamGetTiposCbte>${authXml(a, cuit)}</ar:FEParamGetTiposCbte>`);
      const tipos = tags(tc, "CbteTipo").map((x) => +(tag(x, "Id") || 0)); paso("Factura y nota de crédito habilitadas", tipos.includes(tipo) && tipos.includes(tipo + 2), `tipos ${tipo} y ${tipo + 2}`);
      const ok = v.estado === "completada" && !v.reservada && +v.total > 0 && +v.total < +cfg.umbral_identificar;
      paso("La venta se puede facturar como consumidor final", ok, `#${v.numero} · ${v.estado} · $${v.total}`);
      const det = armarDetalle({ tipo, doc_tipo: 99, doc_nro: "0", total: v.total, receptor_condicion: 5 }, ult + 1, null, cuit, hoyAR());
      return json({ ok: pasos.every((x) => x.ok), pasos, numero: ult + 1, pedido: `<FeCabReq><CantReg>1</CantReg><PtoVta>${cfg.punto_venta}</PtoVta><CbteTipo>${tipo}</CbteTipo></FeCabReq>` + det.replace(/ar:/g, "") });
    }

    if (accion === "csr") {
      const e = empresas[0]; const emp = await empDe(e); const cfg = await cfgDe(e); const cuit = cuitDe(cfg, emp);
      if (cuit.length !== 11) return json({ error: "Primero cargá el CUIT de la empresa" }, 400);
      const par = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
      const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", par.privateKey));
      const pemPkcs8 = "-----BEGIN PRIVATE KEY-----\n" + forge.util.encode64(String.fromCharCode(...pkcs8)).match(/.{1,64}/g)!.join("\n") + "\n-----END PRIVATE KEY-----\n";
      const clave = forge.pki.privateKeyFromPem(pemPkcs8);
      const csr = forge.pki.createCertificationRequest();
      csr.publicKey = forge.pki.setRsaPublicKey(clave.n, clave.e);
      const org = String(emp.razon_social || emp.nombre).normalize("NFD").replace(/[̀-ͯ®]/g, "").replace(/[^A-Za-z0-9 .,-]/g, "").trim().slice(0, 60) || "Percha";
      csr.setSubject([{ name: "countryName", value: "AR" }, { name: "organizationName", value: org }, { name: "commonName", value: "percha" }, { type: "2.5.4.5", value: `CUIT ${cuit}` }]);
      csr.sign(clave, forge.md.sha256.create());
      const pemCsr = forge.pki.certificationRequestToPem(csr);
      await admin.rpc("arca_clave_guardar", { e, pem: forge.pki.privateKeyToPem(clave) });
      await admin.from("facturacion_config").update({ csr_pem: pemCsr, csr_creado: new Date().toISOString(), cuit, estado: cfg?.cert_pem ? cfg.estado : "csr_listo", actualizado: new Date().toISOString() }).eq("empresa_id", e);
      return json({ ok: true, csr: pemCsr, alias: "percha" });
    }

    if (accion === "certificado") {
      const e = empresas[0]; const emp = await empDe(e); let cfg = await cfgDe(e); const cuit = cuitDe(cfg, emp);
      let pem = String(body.pem || "").trim();
      if (!pem.includes("BEGIN CERTIFICATE")) pem = "-----BEGIN CERTIFICATE-----\n" + pem.replace(/\s+/g, "").match(/.{1,64}/g)!.join("\n") + "\n-----END CERTIFICATE-----";
      let cert: any; try { cert = forge.pki.certificateFromPem(pem); } catch { return json({ error: "Ese archivo no es un certificado. Tiene que ser el .crt que descargaste de ARCA." }, 400); }
      const { data: kpem } = await admin.rpc("arca_clave", { e });
      if (!kpem) return json({ error: "Primero generá el pedido de certificado desde acá" }, 400);
      const clave = forge.pki.privateKeyFromPem(kpem);
      if (cert.publicKey.n.toString(16) !== clave.n.toString(16)) return json({ error: "Ese certificado no corresponde al último pedido generado en Percha. Subí el .crt que ARCA dio para ese pedido (o generá uno nuevo y volvé a pedirlo)." }, 400);
      const sn = (cert.subject.attributes.find((x: any) => x.type === "2.5.4.5") || {}).value || "";
      if (cuit && !String(sn).replace(/\D/g, "").includes(cuit)) return json({ error: `El certificado es de otro CUIT (${sn})` }, 400);
      await admin.from("facturacion_config").update({ cert_pem: forge.pki.certificateToPem(cert), cert_vence: cert.validity.notAfter.toISOString(), estado: "csr_listo", ultimo_error: null, actualizado: new Date().toISOString() }).eq("empresa_id", e);
      await admin.from("arca_tokens").delete().eq("empresa_id", e);
      body.accion = "probar";
    }

    if (accion === "probar" || body.accion === "probar") {
      const e = empresas[0]; const emp = await empDe(e); const cfg = await cfgDe(e); const cuit = cuitDe(cfg, emp);
      const pasos: any[] = [];
      const paso = (nombre: string, ok: boolean, detalle = "") => { pasos.push({ nombre, ok, detalle }); return ok; };
      let listo = false, ultimoNro: number | null = null, error: string | null = null;
      try {
        const d = await soap(URLS[cfg.ambiente as "produccion"].wsfe, "http://ar.gov.afip.dif.FEV1/FEDummy", "<ar:FEDummy/>");
        paso("ARCA responde", tag(d, "AppServer") === "OK", `servidores: ${tag(d, "AppServer")}/${tag(d, "DbServer")}/${tag(d, "AuthServer")}`);
        const a = await acceso(e, cfg); paso("Acceso con el certificado", true, "ticket de acceso vigente");
        const pv = await soap(URLS[cfg.ambiente as "produccion"].wsfe, "http://ar.gov.afip.dif.FEV1/FEParamGetPtosVenta", `<ar:FEParamGetPtosVenta>${authXml(a, cuit)}</ar:FEParamGetPtosVenta>`);
        const puntos = tags(pv, "PtoVenta").map((x) => ({ nro: +(tag(x, "Nro") || 0), tipo: tag(x, "EmisionTipo"), bloqueado: tag(x, "Bloqueado"), baja: tag(x, "FchBaja") })).filter((x) => x.nro && x.bloqueado !== "S" && (!x.baja || x.baja === "NULL"));
        const hay = puntos.some((x) => x.nro === +cfg.punto_venta);
        if (paso("Punto de venta Web Services", !!cfg.punto_venta && hay, puntos.length ? `habilitados: ${puntos.map((x) => x.nro).join(", ")}` : "ARCA no tiene ningún punto de venta Web Services para este CUIT")) {
          const tipo = emp.condicion_iva === "responsable_inscripto" ? 6 : 11;
          ultimoNro = await ultimo(cfg, a, cuit, tipo); paso("Numeración", true, `último ${tipo === 11 ? "Factura C" : "Factura B"} emitida: ${ultimoNro}`); listo = true;
        }
      } catch (err) { error = String((err as Error).message || err); paso("Error", false, error); }
      await admin.from("facturacion_config").update({ estado: listo ? "listo" : (cfg.cert_pem ? "error" : cfg.estado), ultimo_error: listo ? null : (error || pasos.filter((p) => !p.ok).map((p) => p.nombre + ": " + p.detalle).join(" · ")), ultima_prueba: new Date().toISOString(), ultimo_numero: ultimoNro, actualizado: new Date().toISOString() }).eq("empresa_id", e);
      return json({ ok: listo, pasos });
    }

    // ---------- facturar lo pendiente ----------
    const resultado: any[] = [];
    for (const e of empresas) {
      const cfg = await cfgDe(e); if (!cfg || cfg.estado !== "listo") { resultado.push({ empresa: e, error: "Facturación sin configurar" }); continue; }
      const { data: turno } = await admin.rpc("arca_tomar_turno", { e, segundos: 120 });
      if (!turno) { resultado.push({ empresa: e, error: "Otra facturación está en curso: en unos segundos sale" }); continue; }
      try {
        const emp = await empDe(e); const a = await acceso(e, cfg);
        let q = admin.from("comprobantes").select("*").eq("empresa_id", e).eq("estado", "pendiente").order("creado").limit(20);
        if (body.comprobante_id) q = q.eq("id", body.comprobante_id);
        const { data: pend } = await q;
        for (const c of pend || []) resultado.push({ id: c.id, ...(await mandar(c, cfg, emp, a)) });
      } catch (err) {
        resultado.push({ empresa: e, error: String((err as Error).message || err) });
        if (body.comprobante_id) await admin.from("comprobantes").update({ errores: String((err as Error).message || err).slice(0, 300) }).eq("id", body.comprobante_id);
      } finally { await admin.rpc("arca_soltar_turno", { e }); }
    }
    return json({ ok: true, resultado });
  } catch (err) {
    return json({ error: String((err as Error).message || err) }, 500);
  }
});
