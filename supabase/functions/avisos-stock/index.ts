// avisos-stock · «Avisame cuando vuelva» de Augusta, por mail (Resend, desde avisos@augustaintimates.com).
// POST {accion:'suscribir', email, product_id, variant_id, origen}            → la web: una prenda sin stock o con pocas.
// POST {accion:'suscribir', tipo:'talle', email, category_id, talle, origen}  → el armador: «cuando entren en mi talle».
// POST {accion:'baja_info'|'baja', token, todo?} → la página www/avisos/baja.html · POST ?baja=<token> → baja en un clic (List-Unsubscribe-Post).
// Cron (x-cron-key, cada 20 min): lee el stock en la Storefront API pública y manda los avisos. Un mail por persona y vuelta.
// Regla del aviso: la prenda vuelve a estar a la venta y su stock supera el más bajo que tuvo desde el pedido
//   (sin stock → entra; «quedan 2» → llegan más). En talle: aparece disponible una variante que no lo estaba.
// Secretos: RESEND_API_KEY (lo carga Diego); clave del cron = CRON_KEY o app_config.cron_key. Opcionales: AVISOS_FROM, AVISOS_REPLY_TO, AVISOS_TOPE_DIA (plan gratis: 100/día).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { mailAnotado, mailVolvio, nombreLindo, pesos } from "./plantilla.js";

const SB_URL = Deno.env.get("SUPABASE_URL")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, CRON_KEY = Deno.env.get("CRON_KEY") || "";
const RESEND = Deno.env.get("RESEND_API_KEY") || "";
const FROM = Deno.env.get("AVISOS_FROM") || "Augusta Intimates <avisos@augustaintimates.com>";
const REPLY_TO = Deno.env.get("AVISOS_REPLY_TO") || "augustaintimates@gmail.com";
const TOPE_DIA = Number(Deno.env.get("AVISOS_TOPE_DIA") || 95);
const STORE = 1142221, SF = `https://storefront-api.tiendanube.com/2026-11/stores/${STORE}`, WEB = "https://www.augustaintimates.com";
const YO = `${SB_URL}/functions/v1/avisos-stock`;
const UA = "Augusta avisos (rosaint.ar@gmail.com)";
const TALLES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];
// Categorías del armador. Las que no piden talle (medias) se anotan con talle "U" = cualquiera.
const CATEGORIAS_TALLE: Record<number, string> = { 33305231: "bombachas", 20830243: "medias" };
const ORIGENES = new Set(["ficha", "armador", "catalogo", "bolsa", "otro"]);
const db = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Clave del cron: el secreto CRON_KEY o, como en el resto de Percha, app_config.cron_key.
let claveCron: string | null = null;
async function esCron(req: Request) {
  const h = req.headers.get("x-cron-key");
  if (!h) return false;
  if (claveCron === null) claveCron = CRON_KEY || (await db.from("app_config").select("valor").eq("clave", "cron_key").maybeSingle()).data?.valor || "";
  return !!claveCron && h === claveCron;
}

const PERMITIDOS = [/^https:\/\/(www\.)?augustaintimates\.com$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const cors = (req: Request) => {
  const o = req.headers.get("origin") || "";
  return { "Access-Control-Allow-Origin": PERMITIDOS.some((r) => r.test(o)) ? o : WEB, "Vary": "Origin", "Access-Control-Allow-Headers": "content-type, x-cron-key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
};
const json = (req: Request, b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors(req), "Content-Type": "application/json" } });

// ---------- Tienda Nube (Storefront API pública: no usa token) ----------
async function sf(path: string) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(SF + path, { headers: { "User-Agent": UA } });
    if (r.status === 429 || r.status >= 500) { await espera(1200 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`storefront ${r.status}`);
    return await r.json();
  }
  throw new Error("storefront sin respuesta");
}
const CAMPOS = "id,name,handle,images,variants,attributes,published,categories";
async function productos(ids: number[]) {
  const out = new Map<number, any>();
  for (let i = 0; i < ids.length; i += 50) {
    const j = await sf(`/products?ids=${ids.slice(i, i + 50).join(",")}&per_page=50&fields=${CAMPOS}`);
    for (const p of j.data || []) out.set(p.id, p);
  }
  return out;
}
async function categoriaDisponible(cat: number) {
  const out: any[] = [];
  for (let page = 1, pages = 1; page <= pages && page <= 10; page++) {
    const j = await sf(`/products?category_id=${cat}&min_stock=1&per_page=200&page=${page}&fields=${CAMPOS}`);
    out.push(...(j.data || []));
    pages = j.pagination?.total_pages || 1;
  }
  return out.filter((p) => p.published !== false);
}
const stockDe = (v: any) => (!v.stock_management || v.stock === null ? 99 : Number(v.stock) || 0);
const disponible = (p: any, v: any) => p.published !== false && v.visible !== false && stockDe(v) > 0;
const atributo = (p: any, re: RegExp) => (p.attributes || []).findIndex((a: any) => re.test(a?.es || a || ""));
function detalle(p: any, v: any) {
  return (v.values || []).map((val: any, i: number) => {
    const a = p.attributes?.[i]?.es || p.attributes?.[i] || "";
    return a ? `${a} ${val?.es ?? val}` : String(val?.es ?? val);
  }).join(" · ");
}
function foto(p: any, v: any) {
  const im = (p.images || []).find((x: any) => x.id === v?.image_id) || p.images?.[0];
  return String(im?.src || "").replace(/-1024-1024(\.\w+)$/, "-320-0$1");
}
const precio = (v: any) => pesos(Number(v.promotional_price || v.price));
// Mismo criterio que el armador: «XS al M», «M», «Único» (único = línea de talles chicos o grandes según el nombre).
function rango(p: any, v: any): [number, number] {
  const i = atributo(p, /talle/i), val = i >= 0 ? (v.values[i]?.es ?? v.values[i]) : v.values.join(" ");
  const t = String(val).toUpperCase().replace(/[()]/g, " ");
  const r = t.match(/\b(XXXL|XXL|XL|XS|S|M|L)\b\s*AL\s*\b(XXXL|XXL|XL|XS|S|M|L)\b/);
  if (r) return [TALLES.indexOf(r[1]), TALLES.indexOf(r[2])];
  const s = t.match(/\b(XXXL|XXL|XL|XS|S|M|L)\b/);
  if (s && t.trim().split(/\s+/).length <= 2) return [TALLES.indexOf(s[1]), TALLES.indexOf(s[1])];
  return /xxl|xxxl|talles grandes/i.test(p.name) ? [5, 6] : [0, 4];
}
const leVa = (p: any, v: any, talle: string) => { if (talle === "U") return true; const [a, b] = rango(p, v), i = TALLES.indexOf(talle); return i >= a && i <= b; };
const enTalle = (talle: string) => (talle === "U" ? "" : ` en talle ${talle}`);

// Por #producto/<id>: anda para cualquier prenda (las direcciones lindas de routes.json no tienen las nuevas).
// Sin parámetros de seguimiento: Gmail los toma como señal de publicidad (manda a Promociones).
const enlace = (p: any, _campania: string) => `${WEB}/#producto/${p.id}`;

// ---------- Resend ----------
async function enviar(a: { to: string; subject: string; html: string; text: string; unClic?: string; clave: string; tag: string }) {
  const headers: Record<string, string> = {};
  if (a.unClic) { headers["List-Unsubscribe"] = `<${a.unClic}>`; headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"; }
  for (let i = 0; i < 3; i++) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json", "Idempotency-Key": a.clave },
      body: JSON.stringify({ from: FROM, to: [a.to], reply_to: REPLY_TO, subject: a.subject, html: a.html, text: a.text, headers, tags: [{ name: "tipo", value: a.tag }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return { id: j.id as string };
    if (r.status === 429) { await espera(1100 * (i + 1)); continue; }
    return { error: `${r.status} ${j?.message || j?.name || ""}`.trim(), definitivo: r.status === 422 || r.status === 403 };
  }
  return { error: "429 límite de Resend" };
}
const inicioDiaAR = () => { const d = new Date(Date.now() - 3 * 3600e3); d.setUTCHours(3, 0, 0, 0); if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString(); };
async function enviadosHoy() {
  const desde = inicioDiaAR();
  const [a, b] = await Promise.all([
    db.from("avisos_stock").select("id", { count: "exact", head: true }).gte("avisado", desde).not("envio_id", "is", null),
    db.from("avisos_stock").select("id", { count: "exact", head: true }).gte("confirmado", desde),
  ]);
  return (a.count || 0) + (b.count || 0);
}
const linkBaja = (token: string) => `${WEB}/avisos/baja.html?t=${token}`;
const ipHash = async (req: Request) => {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + "|" + SERVICE.slice(-24)));
  return [...new Uint8Array(h)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
};

// ---------- Suscribir ----------
async function suscribir(req: Request, b: any) {
  const email = String(b.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email) || email.length > 200) return json(req, { ok: false, motivo: "email", mensaje: "Revisá el mail: parece que falta algo." }, 400);
  const origen = ORIGENES.has(b.origen) ? b.origen : "otro";
  const ip = await ipHash(req);
  const hace1h = new Date(Date.now() - 3600e3).toISOString();
  const { count: porIp } = await db.from("avisos_stock").select("id", { count: "exact", head: true }).eq("ip_hash", ip).gte("creado", hace1h);
  if ((porIp || 0) >= 20) return json(req, { ok: false, motivo: "muchos", mensaje: "Recibimos muchos pedidos seguidos. Probá de nuevo en un rato." }, 429);
  const { count: pend } = await db.from("avisos_stock").select("id", { count: "exact", head: true }).eq("email", email).is("avisado", null).is("baja", null);
  if ((pend || 0) >= 40) return json(req, { ok: false, motivo: "muchos", mensaje: "Ya tenés muchos avisos anotados con este mail." }, 429);

  // Una o varias filas (variant_ids: varios colores/talles de la misma prenda en un solo pedido).
  let filas: any[], items: any[] = [];
  if (b.tipo === "talle") {
    const cat = Number(b.category_id), talle = String(b.talle || "").toUpperCase();
    if (!CATEGORIAS_TALLE[cat] || !(TALLES.includes(talle) || talle === "U")) return json(req, { ok: false, motivo: "datos", mensaje: "No pudimos anotar el aviso." }, 400);
    const lista = await categoriaDisponible(cat);
    const base = lista.flatMap((p) => p.variants.filter((v: any) => disponible(p, v) && leVa(p, v, talle)).map((v: any) => v.id));
    filas = [{ tipo: "talle", email, category_id: cat, talle, producto: nombreLindo(CATEGORIAS_TALLE[cat]) + enTalle(talle), variante: talle === "U" ? "" : `Talle ${talle}`, base_ids: base, origen, ip_hash: ip }];
  } else {
    const pid = Number(b.product_id), vids = [...new Set((Array.isArray(b.variant_ids) ? b.variant_ids : [b.variant_id]).map(Number).filter(Boolean))].slice(0, 12);
    if (!pid || !vids.length) return json(req, { ok: false, motivo: "datos", mensaje: "No pudimos anotar el aviso." }, 400);
    const p = (await productos([pid])).get(pid);
    if (!p) return json(req, { ok: false, motivo: "producto", mensaje: "No encontramos esta prenda." }, 404);
    filas = [];
    for (const vid of vids) {
      const v = p.variants?.find((x: any) => x.id === vid);
      if (!v) continue;
      const st = disponible(p, v) ? stockDe(v) : 0;
      if (st > 3 && origen !== "bolsa") continue; // ya hay: no hace falta aviso (salvo desde la bolsa: quiere más unidades de las que quedan)
      filas.push({ tipo: "variante", email, product_id: pid, variant_id: vid, producto: nombreLindo(p.name), variante: detalle(p, v), imagen: foto(p, v), enlace: enlace(p, "volvio"), stock_base: st, origen, ip_hash: ip });
      items.push({ nombre: nombreLindo(p.name), detalle: detalle(p, v), imagen: foto(p, v), enlace: enlace(p, "volvio"), precio: precio(v) });
    }
    if (!filas.length) return json(req, { ok: false, motivo: "hay_stock", mensaje: "¡Hay stock! Ya la podés agregar a tu bolsa." }, 409);
  }
  const nuevas: any[] = [];
  let ya = 0;
  for (const f of filas) {
    const { data, error } = await db.from("avisos_stock").insert(f).select("id, token").single();
    if (data) nuevas.push({ ...f, ...data });
    else if (error?.code === "23505") ya++;
    else { console.error(error); return json(req, { ok: false, motivo: "error", mensaje: "No pudimos anotar el aviso. Probá de nuevo." }, 500); }
  }
  if (!nuevas.length) return json(req, { ok: true, ya: true, anotados: 0, mensaje: "Ya estaba anotado: te avisamos a este mail apenas entre ♡" });
  // Mail de «listo», en segundo plano (si queda cupo del día; el de «volvió» tiene prioridad).
  const listo = async () => {
    if (!RESEND || (await enviadosHoy()) >= TOPE_DIA - 25) return;
    const f = nuevas[0], baja = linkBaja(f.token), titulo = "Listo, te avisamos ♡";
    const cuales = nuevas.length > 1 ? `${f.producto} (${nuevas.map((x) => x.variante).join(" / ")})` : `${f.producto}${f.variante ? ` (${f.variante})` : ""}`;
    const intro = f.tipo === "talle"
      ? `Cuando entren ${CATEGORIAS_TALLE[f.category_id]} nuevas${f.talle === "U" ? "" : ` que te vayan en talle ${f.talle}`}, te escribimos a este mail.`
      : `Apenas vuelva ${cuales}, te escribimos a este mail para que seas de las primeras.`;
    const r = await enviar({
      to: email, subject: f.tipo === "talle" ? `Te avisamos cuando entren ${CATEGORIAS_TALLE[f.category_id]}${enTalle(f.talle)}` : `Te avisamos cuando vuelva ${f.producto}`,
      html: mailAnotado({ titulo, intro, items: items.slice(0, 4), previa: intro, baja, motivo: "Recibís este mail porque pediste un aviso en augustaintimates.com." }),
      text: `${titulo}\n\n${intro}\n\nTe escribimos una sola vez, cuando entre.\n\nNo quiero este aviso: ${baja}`,
      clave: `anotado-${nuevas.map((x) => x.id).join("-")}`, tag: "anotado",
    });
    if ("id" in r) await db.from("avisos_stock").update({ confirmado: new Date().toISOString() }).in("id", nuevas.map((x) => x.id));
    else console.error("mail anotado", r.error);
  };
  // @ts-ignore EdgeRuntime existe en Supabase
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(listo()); else await listo();
  return json(req, { ok: true, anotados: nuevas.length, ya, mensaje: "¡Listo! Te avisamos a este mail apenas entre ♡" });
}

// ---------- Baja ----------
// La página está en la web (avisos/baja.html): Supabase no sirve HTML desde las funciones. Acá solo datos.
// POST ?baja=<token> sin cuerpo JSON = baja en un clic desde Gmail/Apple Mail (List-Unsubscribe-Post).
async function baja(req: Request, token: string, accion: string, todo: boolean) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json(req, { ok: false, mensaje: "No encontramos este aviso." }, 404);
  const { data: f } = await db.from("avisos_stock").select("id, tipo, email, producto, variante, baja, avisado").eq("token", token).maybeSingle();
  if (!f) return json(req, { ok: false, mensaje: "No encontramos este aviso." }, 404);
  const otros = async () => (await db.from("avisos_stock").select("id", { count: "exact", head: true }).eq("email", f.email).is("avisado", null).is("baja", null).neq("id", f.id)).count || 0;
  if (accion === "baja_info") return json(req, { ok: true, tipo: f.tipo, producto: f.producto, variante: f.variante, ya: !!f.baja, avisado: !!f.avisado, otros: await otros() });
  const ahora = new Date().toISOString();
  if (todo) await db.from("avisos_stock").update({ baja: ahora }).eq("email", f.email).is("avisado", null).is("baja", null);
  else if (!f.baja) await db.from("avisos_stock").update({ baja: ahora }).eq("id", f.id);
  return json(req, { ok: true, producto: f.producto, otros: await otros() });
}

// ---------- Revisar (cron) ----------
async function revisar() {
  const { data: filas, error } = await db.from("avisos_stock").select("*").is("avisado", null).is("baja", null).order("creado").limit(2000);
  if (error) throw error;
  const listos: { fila: any; items: any[] }[] = [];
  const cambios: { id: number; c: Record<string, unknown> }[] = [];

  const variantes = (filas || []).filter((f) => f.tipo === "variante");
  const prods = await productos([...new Set(variantes.map((f) => Number(f.product_id)))]);
  for (const f of variantes) {
    const p = prods.get(Number(f.product_id)), v = p?.variants?.find((x: any) => x.id === Number(f.variant_id));
    if (!p || !v) continue; // despublicada o borrada: queda esperando
    const st = disponible(p, v) ? stockDe(v) : 0;
    if (st > f.stock_base) listos.push({ fila: f, items: [{ nombre: nombreLindo(p.name), detalle: detalle(p, v), imagen: foto(p, v), enlace: await enlace(p, "volvio"), precio: precio(v), pocas: st <= 3, st }] });
    else if (st < f.stock_base) cambios.push({ id: f.id, c: { stock_base: st } });
  }

  const porTalle = new Map<string, any[]>();
  for (const f of (filas || []).filter((f) => f.tipo === "talle")) { const k = `${f.category_id}|${f.talle}`; porTalle.set(k, [...(porTalle.get(k) || []), f]); }
  const cats = new Map<number, any[]>();
  for (const k of porTalle.keys()) { const c = Number(k.split("|")[0]); if (!cats.has(c)) cats.set(c, await categoriaDisponible(c)); }
  for (const [k, fs] of porTalle) {
    const [c, talle] = [Number(k.split("|")[0]), k.split("|")[1]];
    const ahora = cats.get(c)!.flatMap((p) => p.variants.filter((v: any) => disponible(p, v) && leVa(p, v, talle)).map((v: any) => ({ p, v })));
    const ids = new Set(ahora.map((x) => x.v.id));
    for (const f of fs) {
      const base = new Set<number>((f.base_ids || []).map(Number));
      const nuevas = ahora.filter((x) => !base.has(x.v.id));
      if (nuevas.length) {
        const unaPorProducto = [...new Map(nuevas.sort((a, b) => stockDe(b.v) - stockDe(a.v)).map((x) => [x.p.id, x])).values()].slice(0, 4);
        listos.push({ fila: f, items: await Promise.all(unaPorProducto.map(async ({ p, v }) => ({ nombre: nombreLindo(p.name), detalle: detalle(p, v), imagen: foto(p, v), enlace: await enlace(p, "talle"), precio: precio(v), pocas: stockDe(v) <= 3 }))) });
      } else {
        const queda = [...base].filter((id) => ids.has(id));
        if (queda.length !== base.size) cambios.push({ id: f.id, c: { base_ids: queda } });
      }
    }
  }
  for (const x of cambios) await db.from("avisos_stock").update(x.c).eq("id", x.id);
  if (!RESEND) return { listos: listos.length, enviados: 0, aviso: "Falta RESEND_API_KEY: no se mandó nada." };

  // Un mail por persona con todo lo que volvió, en el orden en que lo pidieron. Respeta el cupo del día.
  const porMail = new Map<string, { filas: any[]; items: any[] }>();
  for (const l of listos) { const g = porMail.get(l.fila.email) || { filas: [], items: [] }; g.filas.push(l.fila); g.items.push(...l.items); porMail.set(l.fila.email, g); }
  let cupo = TOPE_DIA - (await enviadosHoy()), enviados = 0, errores = 0, pendientes = 0;
  const inicio = Date.now();
  for (const [email, g] of porMail) {
    if (cupo <= 0 || Date.now() - inicio > 40000) { pendientes++; continue; }
    const items = g.items.slice(0, 6), soloTalle = g.filas.every((f) => f.tipo === "talle"), una = items.length === 1;
    const ft = g.filas.find((f) => f.tipo === "talle"), talle = ft?.talle, que = ft ? CATEGORIAS_TALLE[ft.category_id] || "prendas" : "";
    const titulo = soloTalle ? (talle === "U" ? `Entraron ${que} nuevas` : `Entraron en tu talle ${talle}`) : una ? `Volvió ${items[0].nombre}` : "Volvió lo que esperabas";
    const intro = soloTalle ? `Te avisamos como pediste: estas ${que} nuevas${talle === "U" ? " ya están a la venta" : ` te van en talle ${talle}`}.`
      : una ? "La que estabas esperando ya está otra vez a la venta. Te avisamos primero a vos." : "Las prendas que estabas esperando ya están otra vez a la venta. Te avisamos primero a vos.";
    const baja = linkBaja(g.filas[0].token);
    const destino = una ? items[0].enlace : soloTalle ? `${WEB}/#arma-tu-pack` : `${WEB}/`;
    const r = await enviar({
      to: email, subject: titulo,
      html: mailVolvio({ titulo, intro, items, boton: { texto: una ? "La quiero" : soloTalle ? "Armar mi pack" : "Ver en la tienda", enlace: destino }, previa: intro, baja, motivo: "Recibís este mail porque pediste que te avisemos en augustaintimates.com. Este aviso no se repite." }),
      text: `${titulo}\n\n${intro}\n\n${items.map((i) => `${i.nombre} (${i.detalle})\n${i.enlace}`).join("\n\n")}\n\nNo quiero este aviso: ${baja}`,
      unClic: `${YO}?baja=${g.filas[0].token}`, clave: `volvio-${g.filas.map((f) => f.id).join("-")}`, tag: soloTalle ? "talle" : "volvio",
    });
    const ids = g.filas.map((f) => f.id);
    if ("id" in r) { enviados++; cupo--; await db.from("avisos_stock").update({ avisado: new Date().toISOString(), envio_id: r.id, error: null }).in("id", ids); }
    else { errores++; await db.from("avisos_stock").update(r.definitivo ? { error: r.error, baja: new Date().toISOString() } : { error: r.error }).in("id", ids); }
    await espera(550); // Resend: 2 pedidos por segundo
  }
  return { pendientes_total: filas?.length || 0, listos: listos.length, personas: porMail.size, enviados, errores, sin_cupo: pendientes, cupo_restante: cupo };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const url = new URL(req.url);
  try {
    if (req.method !== "POST") return json(req, { ok: false }, 405);
    if (url.searchParams.has("baja")) return await baja(req, url.searchParams.get("baja") || "", "baja", false);
    if (await esCron(req)) {
      const b = await req.json().catch(() => ({}));
      if (b.accion === "probar" && b.email) {
        // Vista previa con prendas reales (sin tocar la tabla): manda los dos mails al mail indicado.
        const lista = (await categoriaDisponible(33305231)).slice(0, 2);
        const items = await Promise.all(lista.map(async (p) => { const v = p.variants.find((x: any) => disponible(p, x)); return { nombre: nombreLindo(p.name), detalle: detalle(p, v), imagen: foto(p, v), enlace: await enlace(p, "prueba"), precio: precio(v), pocas: stockDe(v) <= 3 }; }));
        const a = await enviar({ to: b.email, subject: `Volvió ${items[0].nombre} (prueba)`, html: mailVolvio({ titulo: `Volvió ${items[0].nombre}`, intro: "La que estabas esperando ya está otra vez a la venta. Te avisamos primero a vos.", items: [items[0]], boton: { texto: "La quiero", enlace: items[0].enlace }, previa: "Prueba del aviso de reposición", baja: "", motivo: "Mail de prueba del aviso de reposición." }), text: "Prueba", clave: `prueba-volvio-${Date.now()}`, tag: "prueba" });
        await espera(600);
        const c = await enviar({ to: b.email, subject: "Te avisamos cuando vuelva (prueba)", html: mailAnotado({ titulo: "Listo, te avisamos ♡", intro: `Apenas vuelva ${items[1].nombre} (${items[1].detalle}), te escribimos a este mail para que seas de las primeras.`, items: [items[1]], previa: "Prueba del aviso anotado", baja: "", motivo: "Mail de prueba del aviso anotado." }), text: "Prueba", clave: `prueba-anotado-${Date.now()}`, tag: "prueba" });
        return json(req, { ok: true, volvio: a, anotado: c });
      }
      return json(req, { ok: true, ...(await revisar()) });
    }
    const b = await req.json().catch(() => ({}));
    if (b.accion === "suscribir") return await suscribir(req, b);
    if (b.accion === "baja" || b.accion === "baja_info") return await baja(req, String(b.token || ""), b.accion, b.todo === true);
    return json(req, { ok: false }, 400);
  } catch (e) {
    console.error(e);
    return json(req, { ok: false, mensaje: "No pudimos anotar el aviso. Probá de nuevo." }, 500);
  }
});
