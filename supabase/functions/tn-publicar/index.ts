// tn-publicar · lo nuevo de Percha va solo a Tienda Nube, OCULTO (para completar fotos y descripción allá), y las fotos de
// Tienda Nube vuelven a Percha. (04/11/2026, Diego: "la idea es no tocar más Tienda Nube… cuando creo un producto nuevo o agrego
// un color nuevo, que impacte directo en Tienda Nube pero OCULTO… cuando cargue las fotos a Tienda Nube que impacten en Percha".)
// Lo llama el cron cada minuto (x-cron-key = app_config.cron_key) o un admin (sesión, body { empresa_id }).
// body.simular = true: no escribe nada, devuelve lo que haría · body.producto_id: solo ese producto (aunque no esté en la cola).
// 1) canal_publicar (la llenan los disparadores de variantes/productos): con 2 min sin cambios, por producto:
//    · sin publicación en la web → UNA publicación nueva OCULTA con sus colores y talles
//    · ya publicado → el talle nuevo de un color que ya está va a la publicación de ese color (visible: ya tiene fotos);
//      un color nuevo va OCULTO a la publicación que tiene "Color", o a una publicación nueva oculta si la prenda tiene
//      una publicación por color
//    · precio = el de Lista (tn-precios agrega la oferta en ≤10 min), stock = el de Percha para la web, 10 g y 4×4×4
//    · cada variante creada queda cruzada (canal_items, cruce manual): stock y precios siguen solos
// 2) cada 5 min: los productos que cambiaron en la web → sus fotos a Percha (producto_fotos, por color; las cargadas a mano
//    en Percha no se tocan) y si están visibles u ocultos (al mostrarlos reciben el stock de Percha).
// 13/11: la configuración sale de la conexión (Conexiones › Tienda Nube: publicar lo nuevo, oculto o no, espera, medidas,
// Nuevos Ingresos, fotos desde Percha). Avisos al instante de la web (?k=…): un producto cambió → se anota y se procesa
// en el minuto; app desinstalada → la conexión queda en error. {avisos:'ver'|'registrar'}: los avisos de la conexión.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { clienteTN, configDe, registrarAvisos, estadoAvisos, archivoBase, es, norm, talleClave } from "../_shared/tn.ts";
import { fotosDesdeLaWeb } from "../_shared/fotos.ts";
const SB_URL = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const CADA_FOTOS_MIN = 5, MAX_FOTOS = 25, MAX_AVISOS = 30;   // fotos de Percha → web: de a 25 por vuelta; avisos de la web: de a 30 publicaciones
const esColor = (a: string) => ["color", "colores", "estampa"].includes(norm(a));
const esTalle = (a: string) => ["talle", "talles", "talla", "tamano", "medida"].includes(norm(a));

// ---------- la cuenta de precios (copia de tn-precios / shared/precios.js: si se cambia una, cambiar las otras) ----------
const r2 = (x: number) => Math.round(x * 100) / 100;
function redondear(x: number, modo: string) {
  const arriba = /\+$/.test(modo || ""), m = String(modo || "no").replace("+", "");
  let paso = 0, resta = 0;
  if (["10", "100", "500", "1000"].includes(m)) paso = +m; else if (m === "990") { paso = 1000; resta = 10; } else if (m === "900") { paso = 1000; resta = 100; } else return Math.max(0, r2(x));
  const f = arriba ? (v: number) => Math.ceil(r2(v)) : Math.round;
  if (x < paso - resta) return Math.max(0, f(x));
  return Math.max(0, f((x + resta) / paso) * paso - resta);
}
const hoyAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
function vigente(p: any, canal: string) {
  const f = hoyAR(), dow = ((new Date(f + "T12:00").getDay() + 6) % 7) + 1;
  if (p.desde && f < p.desde) return false; if (p.hasta && f > p.hasta) return false;
  if (p.dias_semana && p.dias_semana.length && !p.dias_semana.includes(dow)) return false;
  if (p.canales && p.canales.length && !p.canales.includes(canal)) return false;
  return true;
}
function armar(d: any) {
  const excep = new Map<string, number>(), fijos = new Map<string, number>();
  for (const x of d.excep) excep.set(x.lista_id + "|" + (x.producto_id ? "p" + x.producto_id : "c" + x.categoria_id), +x.porcentaje);
  for (const x of d.fijos) fijos.set(x.lista_id + "|" + x.producto_id + "|" + (x.variante_id || ""), +x.precio);
  const rebajas = d.rebajas.map((p: any) => ({ p, precios: new Map<string, number>() }));
  const porId = new Map(rebajas.map((r: any) => [r.p.id, r]));
  for (const x of d.rp) { const r: any = porId.get(x.promocion_id); if (r) r.precios.set(x.producto_id + "|" + (x.variante_id || ""), +x.precio); }
  const base = d.listas.find((l: any) => l.predeterminada && !l.canal) || d.listas.find((l: any) => !l.canal) || { redondeo: "10+" };
  return { listas: d.listas, excep, fijos, rebajas, base };
}
function rebajaDe(v: any, ctx: any, op: any) {
  const base = +v.precio || 0; let mejor: any = null;
  for (const { p, precios } of ctx.rebajas) {
    if (!vigente(p, op.canal)) continue;
    let pr = precios.get(v.producto_id + "|" + v.id); if (pr == null) pr = precios.get(v.producto_id + "|");
    if (pr == null && +p.valor > 0) {
      const alcanza = p.alcance === "familias" ? (p.familia_ids || []).includes(op.categoria_id) : p.alcance === "productos" ? (p.producto_ids || []).includes(v.producto_id) : (op.tipo || "prenda") === "prenda";
      if (alcanza) pr = redondear(base * (1 - +p.valor / 100), ctx.base.redondeo || "10+");
    }
    if (pr != null && pr < base && (!mejor || pr < mejor.precio)) mejor = { id: p.id, nombre: p.nombre, precio: pr };
  }
  return mejor;
}
function calcular(v: any, lista: any, ctx: any, op: any) {
  const base = +v.precio || 0;
  let fijo = ctx.fijos.get(lista.id + "|" + v.producto_id + "|" + v.id); if (fijo == null) fijo = ctx.fijos.get(lista.id + "|" + v.producto_id + "|");
  if (fijo != null) return { precio: fijo, rebaja: null };
  const rebaja = lista.toma_rebajas !== false && !op.sinRebajas ? rebajaDe(v, ctx, op) : null;
  const punto = rebaja ? rebaja.precio : base;
  let pct = ctx.excep.get(lista.id + "|p" + v.producto_id);
  if (pct == null && op.categoria_id) pct = ctx.excep.get(lista.id + "|c" + op.categoria_id);
  if (pct == null) pct = +lista.porcentaje || 100;
  return { precio: pct === 100 ? punto : redondear(punto * pct / 100, lista.redondeo || "10+"), rebaja };
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(SB_URL, SERVICE);
  const body = await req.json().catch(() => ({}));
  // ---- aviso de Tienda Nube (webhook): se anota y se responde enseguida (la web espera una respuesta rápida) ----
  const k = new URL(req.url).searchParams.get("k");
  if (k) {
    const { data: wk } = await admin.from("app_config").select("valor").eq("clave", "tn_webhook_key").maybeSingle();
    if (!wk?.valor || k !== wk.valor) return json({ error: "Llave inválida" }, 401);
    const { data: cxa } = await admin.from("conexiones").select("id").eq("canal", "tiendanube").eq("externo_id", String(body.store_id ?? "")).limit(1).maybeSingle();
    if (!cxa) return json({ ok: true, ignorado: true });
    if (body.event === "app/uninstalled") {
      await admin.from("conexiones").update({ estado: "error", ultimo_error: "Se desinstaló la app en Tienda Nube: volvé a conectar para que siga sincronizando." }).eq("id", cxa.id);
      return json({ ok: true });
    }
    if (String(body.event || "").startsWith("product/") && body.id) await admin.from("canal_cambios_web").upsert({ conexion_id: cxa.id, producto_ext: String(body.id), evento: body.event, recibido: new Date().toISOString() });
    return json({ ok: true });
  }
  const { data: ck } = await admin.from("app_config").select("valor").eq("clave", "cron_key").maybeSingle();
  const esCron = !!ck?.valor && req.headers.get("x-cron-key") === ck.valor;
  let filtroEmpresa: string | null = null;
  if (!esCron) {
    const comoUsuario = createClient(SB_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await comoUsuario.auth.getUser();
    if (!user) return json({ error: "Sesión inválida" }, 401);
    if (!body.empresa_id) return json({ error: "Falta empresa_id" }, 400);
    const { data: ok } = await comoUsuario.rpc("es_admin", { e: body.empresa_id });
    if (!ok) return json({ error: "No administrás esta empresa" }, 403);
    filtroEmpresa = body.empresa_id;
  }
  const simular = !!body.simular;
  let qc = admin.from("conexiones").select("id,empresa_id,externo_id,canal,empujar_stock,ultima_sync_fotos,config").eq("estado", "activa").eq("canal", "tiendanube");
  if (filtroEmpresa) qc = qc.eq("empresa_id", filtroEmpresa);
  const { data: conexiones } = await qc;
  const resumen: any[] = [];

  for (const cx of conexiones || []) {
    const { data: sec } = await admin.from("conexion_secretos").select("access_token").eq("conexion_id", cx.id).maybeSingle();
    if (!sec) continue;
    // los avisos al instante de la conexión (Conexiones): ver cuáles hay o crear los que faltan
    if (body.avisos) {
      try { resumen.push({ conexion: cx.id, ...(body.avisos === "registrar" ? await registrarAvisos(admin, cx, sec.access_token, simular) : {}), avisos: await estadoAvisos(admin, cx, sec.access_token) }); }
      catch (err) { resumen.push({ conexion: cx.id, error: String((err as Error)?.message || err).slice(0, 200) }); }
      continue;
    }
    if (!cx.empujar_stock && !simular) continue;   // la web todavía no la maneja Percha
    const cfg = configDe(cx);
    const { tn } = clienteTN(cx.externo_id, sec.access_token);
    const MEDIDAS = cfg.medidas ? { weight: (+cfg.medidas.peso || 0).toFixed(3), width: (+cfg.medidas.ancho || 0).toFixed(2), height: (+cfg.medidas.alto || 0).toFixed(2), depth: (+cfg.medidas.profundidad || 0).toFixed(2) } : {};
    const ESPERA_MIN = Math.max(1, +cfg.espera_min || 10), DIAS_NUEVOS = Math.max(0, +cfg.nuevos_ingresos_dias || 0);
    const e = cx.empresa_id, res: any = { conexion: cx.id, publicados: [], fotos: null };
    let ctxPrecios: any = null, listaTN: any = null;
    const pagT = async (q: () => any) => { let todo: any[] = []; for (let d = 0; ; d += 1000) { const { data } = await q().range(d, d + 999); todo = todo.concat(data || []); if (!data || data.length < 1000) break; } return todo; };
    const cargarPrecios = async () => {
      if (ctxPrecios) return;
      const [listas, excep, fijos, rebajas, rp] = await Promise.all([
        pagT(() => admin.from("listas_precios").select("*").eq("empresa_id", e).eq("activa", true).order("orden")),
        pagT(() => admin.from("lista_excepciones").select("lista_id,categoria_id,producto_id,porcentaje").eq("empresa_id", e)),
        pagT(() => admin.from("precios").select("lista_id,producto_id,variante_id,precio").eq("empresa_id", e)),
        pagT(() => admin.from("promociones").select("*").eq("empresa_id", e).eq("activa", true).eq("tipo", "rebaja")),
        pagT(() => admin.from("rebaja_precios").select("promocion_id,producto_id,variante_id,precio").eq("empresa_id", e))]);
      ctxPrecios = armar({ listas, excep, fijos, rebajas, rp });
      listaTN = listas.find((l: any) => l.canal === "tiendanube") || ctxPrecios.base;
    };

    // ================= 1) publicar lo nuevo =================
    let cola: any[] = [];
    if (body.producto_id) cola = [{ id: null, producto_id: body.producto_id, variantes: null, detalle: null, intentos: 0 }];
    else if (cfg.publicar_nuevos) {   // apagado en Conexiones: lo nuevo queda solo en Percha (la cola espera)
      const hace = new Date(Date.now() - ESPERA_MIN * 60000).toISOString(), reintento = new Date(Date.now() - 10 * 60000).toISOString();
      const { data } = await admin.from("canal_publicar").select("*").eq("empresa_id", e).or(`and(estado.eq.pendiente,actualizado.lt.${hace}),and(estado.eq.error,intentos.lt.3,actualizado.lt.${reintento})`).order("actualizado").limit(5);
      cola = data || [];
    }
    for (const q of cola) {
      const marcar = async (estado: string, extra: Record<string, unknown>) => { if (!simular && q.id) await admin.from("canal_publicar").update({ estado, actualizado: new Date().toISOString(), ...(estado === "hecho" || estado === "omitido" ? { hecho: new Date().toISOString() } : {}), ...extra }).eq("id", q.id); };
      try {
        const r = await publicarProducto(q);
        res.publicados.push({ producto_id: q.producto_id, ...r });
        await marcar(r.omitido ? "omitido" : "hecho", { detalle: { ...(q.detalle || {}), ...r }, error: null });
      } catch (err) {
        const msg = String((err as Error)?.message || err);
        res.publicados.push({ producto_id: q.producto_id, error: msg });
        await marcar("error", { error: msg.slice(0, 500), intentos: (q.intentos || 0) + 1 });
      }
    }


    // ===== completar una publicación nueva como las demás de la tienda (12/11, Diego) =====
    // Categorías: las de la prenda MÁS PARECIDA que ya está publicada (misma familia en Percha, nombre parecido: PIA BORGOÑA
    // copia de PIA BORDÓ), + «Nuevos Ingresos» y la etiqueta «nuevos-ingresos» (para mostrarlas aparte en la web),
    // + «Talles grandes» si llega a 2XL/3XL. También la marca, el título y la descripción para Google, y «adulto / mujer».
    let catsTienda: any[] | null = null;
    const categoriasTienda = async () => { if (catsTienda) return catsTienda; catsTienda = []; for (let pg = 1; pg <= 5; pg++) { const l = await tn("GET", `/categories?fields=id,name,parent&per_page=200&page=${pg}`).catch(() => []); if (!Array.isArray(l) || !l.length) break; catsTienda.push(...l); if (l.length < 200) break; } return catsTienda; };
    const PALABRAS_VACIAS = new Set(["de", "la", "el", "y", "con", "c", "x"]);
    const tokens = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !PALABRAS_VACIAS.has(w));
    const parecido = (a: string, b: string) => { const ta = tokens(a), tb = tokens(b), sa = new Set(ta), sb = new Set(tb); let p = 0; ta.forEach((w, i) => { if (sb.has(w)) p += i === 0 ? 3 : 1; }); tb.forEach((w) => { if (!sa.has(w)) p -= 0.5; }); return p; };
    async function completarPublicacion(pe: string, p: any, forzar = false) {
      const info = await tn("GET", `/products/${pe}?fields=id,name,categories,brand,tags,seo_title,seo_description,variants`);
      const nombre = es(info.name);
      if (!forzar && (info.categories || []).length && info.brand) return { publicacion: pe, ya_estaba: true };
      // la prenda modelo
      const { data: herm } = await admin.from("productos").select("id,nombre").eq("empresa_id", e).eq("categoria_id", p.categoria_id).neq("id", p.id).limit(3000);
      const { data: todos } = await admin.from("productos").select("id,nombre").eq("empresa_id", e).eq("activo", true).neq("id", p.id).limit(5000);
      const orden = [{ h: { id: p.id, nombre: p.nombre } },
        ...(herm || []).map((h: any) => ({ h, s: parecido(nombre, h.nombre) })).sort((a: any, b: any) => b.s - a.s).slice(0, 12),
        ...(todos || []).map((h: any) => ({ h, s: parecido(nombre, h.nombre) })).sort((a: any, b: any) => b.s - a.s).slice(0, 12)];
      let modelo: any = null, modeloNombre = "";
      for (const { h } of orden) {
        const { data: cs } = await admin.from("canal_items").select("producto_ext,variantes!inner(producto_id)").eq("conexion_id", cx.id).eq("publicado", true).eq("de_percha", false).eq("variantes.producto_id", h.id).limit(1);
        if (!cs?.length || String(cs[0].producto_ext) === pe) continue;
        const m = await tn("GET", `/products/${cs[0].producto_ext}?fields=id,name,categories,brand,seo_title,seo_description,variants`).catch(() => null);
        if (m && (m.categories || []).length) { modelo = m; modeloNombre = h.nombre; break; }
      }
      const cats = await categoriasTienda();
      const nuevos = DIAS_NUEVOS ? cats.find((c: any) => /nuevos ingresos/i.test(es(c.name))) : null;   // 0 días en Conexiones = no se usa
      const { data: pc } = await admin.from("productos").select("categorias_web").eq("id", p.id).maybeSingle();
      const exactas: number[] | null = Array.isArray(pc?.categorias_web) && pc.categorias_web.length ? pc.categorias_web.map(Number) : null;
      const grandes = cats.filter((c: any) => /talles grandes/i.test(es(c.name)));
      const deModelo = (modelo?.categories || []).filter((c: any) => !/rebajas|favoritos|ofertas|sale/i.test(es(c.name)));
      const ids = new Set<number>(deModelo.map((c: any) => c.id));
      // talles grandes: según los talles de ESTA prenda, no los del modelo
      const { data: ts } = await admin.from("v_variantes").select("talle_nombre").eq("producto_id", p.id).eq("activa", true);
      const esGrande = (ts || []).some((t: any) => /\b(2xl|3xl|4xl|xxl|xxxl)\b/i.test(String(t.talle_nombre || "")));
      const padres = new Set(cats.filter((c: any) => ids.has(c.id)).map((c: any) => c.parent));
      // las categorías que DESCRIBEN la prenda van solo si su nombre lo dice (no se copian del modelo a ciegas): se sacan
      // si no corresponde y se suman las de la misma rama que sí (ej. «REGULABLE» → Regulables)
      const DESCRIBE: [RegExp, RegExp][] = [[/^regulables?$/, /\bregulable/], [/^elastico ancho$/, /\belastico ancho\b/], [/^algodon$/, /\balgodon\b/],
        [/^puntilla$/, /\bpuntilla\b/], [/^fru fru$/, /\bfru fru\b/], [/^sin costuras?$/, /\b(sin costuras?|seamless)\b/], [/^boxer femenino$/, /\bboxer\b/],
        [/^colaless$/, /^(less|colaless)\b/], [/^vedetinas?$/, /^vedetina/], [/^culotteless$/, /^culotteless/]];
      const n2 = (x: string) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      const nomN = n2(nombre);
      for (const c of cats) { const cn = n2(es(c.name)); const r = DESCRIBE.find(([rc]) => rc.test(cn)); if (!r) continue;
        if (!r[1].test(nomN)) ids.delete(c.id); else if (padres.has(c.parent)) ids.add(c.id); }
      for (const g of grandes) { if (esGrande && (ids.has(g.parent) || padres.has(g.parent))) ids.add(g.id); else if (!esGrande) ids.delete(g.id); }
      // las tildadas en Percha mandan (exactas); si no había ninguna, las sugeridas quedan en Percha para revisar
      if (exactas) { ids.clear(); exactas.forEach((id) => ids.add(id)); }
      else if (!simular) await admin.rpc("producto_categorias_sugeridas", { p_producto: p.id, p_cats: [...ids].filter((id) => !nuevos || id !== nuevos.id).sort((a, b) => a - b) });
      if (nuevos) ids.add(nuevos.id);
      const marca = modelo?.brand || null;
      const tags = [...new Set([...String(info.tags || "").split(",").map((t) => t.trim()).filter(Boolean), ...(nuevos ? ["nuevos-ingresos"] : [])])].join(", ");
      const tienda = (es(modelo?.seo_title).match(/ - (.+)$/) || [])[1] || (marca ? "Comprar en " + marca : "");
      const seoDesc = es(modelo?.seo_description) ? es(modelo.seo_description).replace(/^(Compr[aá] online )(.+?)( en \d)/i, (_m: string, a: string, _b: string, c: string) => a + nombre + c) : "";
      const cuerpo: any = { categories: [...ids], tags, ...(marca && !info.brand ? { brand: marca } : {}) };
      if (!es(info.seo_title) && tienda) cuerpo.seo_title = { es: (nombre + " - " + tienda).slice(0, 70) };
      if (!es(info.seo_description) && seoDesc && seoDesc !== es(modelo.seo_description)) cuerpo.seo_description = { es: seoDesc.slice(0, 320) };
      if (simular) return { publicacion: pe, modelo: modeloNombre, categorias: [...ids].length, cuerpo };
      await tn("PUT", `/products/${pe}`, cuerpo);
      if (nuevos && !info.categories?.some((c: any) => c.id === nuevos.id)) await admin.from("canal_items").update({ nuevo_hasta: new Date(Date.now() + DIAS_NUEVOS * 86400000).toISOString() }).eq("conexion_id", cx.id).eq("producto_ext", pe);
      // «adulto / mujer» (Google Shopping) como el modelo
      const mv = (modelo?.variants || [])[0];
      if (mv && (mv.age_group || mv.gender)) for (const v of (info.variants || []).filter((v: any) => !v.age_group || !v.gender)) await tn("PUT", `/products/${pe}/variants/${v.id}`, { age_group: v.age_group || mv.age_group, gender: v.gender || mv.gender }).catch(() => null);
      return { publicacion: pe, modelo: modeloNombre, categorias: [...ids].length };
    }

    if (body.completar) {
      const { data: dp } = await admin.from("canal_items").select("producto_ext,variantes!inner(producto_id)").eq("conexion_id", cx.id).eq("de_percha", true);
      const pubs = new Map<string, string>(); (dp || []).forEach((c: any) => pubs.set(String(c.producto_ext), c.variantes.producto_id));
      res.completadas = [];
      for (const [pe, pid] of pubs) {
        const { data: p } = await admin.from("productos").select("id,nombre,categoria_id").eq("id", pid).single();
        try { res.completadas.push(await completarPublicacion(pe, p, !!body.forzar)); } catch (err) { res.completadas.push({ publicacion: pe, error: String(err).slice(0, 150) }); }
      }
      resumen.push(res); continue;
    }
    // ===== categorías cambiadas en Percha → web (sql/144) =====
    if (!body.producto_id || body.categorias) {
      const { data: pend } = await admin.from("productos").select("id,nombre,categorias_web").eq("empresa_id", e).eq("categorias_web_pendiente", true).limit(20);
      if ((pend || []).length) {
        const nuevos = (await categoriasTienda()).find((c: any) => /nuevos ingresos/i.test(es(c.name)));
        res.categorias = [];
        for (const pr of pend || []) {
          const { data: cr } = await admin.from("canal_items").select("producto_ext,nuevo_hasta,variantes!inner(producto_id)").eq("conexion_id", cx.id).eq("variantes.producto_id", pr.id);
          const pubs = new Map<string, boolean>(); (cr || []).forEach((c: any) => pubs.set(String(c.producto_ext), (pubs.get(String(c.producto_ext)) || false) || (!!c.nuevo_hasta && c.nuevo_hasta > new Date().toISOString())));
          let ok = true;
          for (const [pe, esNuevo] of pubs) {
            const ids = (Array.isArray(pr.categorias_web) ? pr.categorias_web : []).map(Number);
            if (esNuevo && nuevos) ids.push(nuevos.id);
            if (simular) { res.categorias.push({ producto: pr.nombre, publicacion: pe, categorias: ids.length }); continue; }
            try { await tn("PUT", `/products/${pe}`, { categories: [...new Set(ids)] }); res.categorias.push({ producto: pr.nombre, publicacion: pe, categorias: ids.length }); }
            catch (err) { if (!String(err).includes(" 404")) { ok = false; res.categorias.push({ producto: pr.nombre, publicacion: pe, error: String(err).slice(0, 120) }); } }
          }
          if (ok && !simular) await admin.from("productos").update({ categorias_web_pendiente: false }).eq("id", pr.id);
        }
      }
    }
    // a mano (Diego, 12/11): sacar de «Nuevos Ingresos» todo lo que está ahí MENOS las publicaciones indicadas
    if (Array.isArray(body.quitar_nuevos_menos)) {
      const quedan = new Set(body.quitar_nuevos_menos.map(String));
      const nuevos = (await categoriasTienda()).find((c: any) => /nuevos ingresos/i.test(es(c.name)));
      res.quitadas = []; res.quedan = [];
      if (nuevos) for (let vuelta = 1, pg = 1; vuelta <= 6; vuelta++, pg = simular ? pg + 1 : 1) {
        const l = await tn("GET", `/products?category_id=${nuevos.id}&per_page=200&page=${pg}&fields=id,name,categories`);
        if (!Array.isArray(l) || !l.length) break;
        for (const pr of l) {
          if (quedan.has(String(pr.id))) { res.quedan.push(es(pr.name)); continue; }
          if (!simular) await tn("PUT", `/products/${pr.id}`, { categories: (pr.categories || []).map((c: any) => c.id).filter((id: number) => id !== nuevos.id) });
          res.quitadas.push(es(pr.name));
        }
        if (l.length < 200) break;   // de verdad se vuelve a pedir la página 1 (las sacadas ya no aparecen)
      }
      resumen.push(res); continue;
    }
    // «Nuevos Ingresos» dura 30 días (canal_items.nuevo_hasta): una vez por día se le saca la categoría y la etiqueta
    if (body.vencer_nuevos || (!body.producto_id && new Date().getUTCHours() === 9 && new Date().getUTCMinutes() < 2)) {
      const { data: vencidas } = await admin.from("canal_items").select("producto_ext").eq("conexion_id", cx.id).lt("nuevo_hasta", new Date().toISOString());
      const pes = [...new Set((vencidas || []).map((c: any) => String(c.producto_ext)))];
      res.nuevos_vencidos = [];
      if (pes.length) {
        const nuevos = (await categoriasTienda()).find((c: any) => /nuevos ingresos/i.test(es(c.name)));
        for (const pe of pes) {
          try {
            if (!simular) {
              const info = await tn("GET", `/products/${pe}?fields=id,categories,tags`);
              const tags = String(info.tags || "").split(",").map((t: string) => t.trim()).filter((t: string) => t && t.toLowerCase() !== "nuevos-ingresos").join(", ");
              await tn("PUT", `/products/${pe}`, { categories: (info.categories || []).map((c: any) => c.id).filter((id: number) => !nuevos || id !== nuevos.id), tags });
              await admin.from("canal_items").update({ nuevo_hasta: null }).eq("conexion_id", cx.id).eq("producto_ext", pe);
            }
            res.nuevos_vencidos.push(pe);
          } catch (err) { if (String(err).includes(" 404")) await admin.from("canal_items").update({ nuevo_hasta: null }).eq("conexion_id", cx.id).eq("producto_ext", pe); }
        }
      }
      if (body.vencer_nuevos) { resumen.push(res); continue; }
    }

    // a mano (13/11, Diego): fotos REPETIDAS en las publicaciones (mismo archivo subido dos veces). Se queda la que
    // Percha tiene anotada (o la primera); las opciones que usaban la copia pasan a la que queda. {deduplicar_fotos: true | [publicaciones]}
    if (body.deduplicar_fotos) {
      let pes: string[] = Array.isArray(body.deduplicar_fotos) ? body.deduplicar_fotos.map(String) : [];
      const { data: fw } = await admin.from("producto_fotos").select("producto_id,web").eq("empresa_id", e).not("web", "is", null);
      const anotadas = new Set<string>(), pidsDe = new Map<string, Set<string>>();
      (fw || []).forEach((f: any) => Object.entries(f.web || {}).forEach(([pe, id]) => { anotadas.add(String(id)); if (!pidsDe.has(pe)) pidsDe.set(pe, new Set()); pidsDe.get(pe)!.add(f.producto_id); }));
      if (!pes.length) pes = [...pidsDe.keys()];
      res.duplicadas = []; const tocadas: any[] = [];
      for (const pe of pes) {
        let pr: any;
        try { pr = await tn("GET", `/products/${pe}?fields=id,name,published,images,variants`); } catch (err) { res.duplicadas.push({ publicacion: pe, error: String(err).slice(0, 120) }); continue; }
        const grupos = new Map<string, any[]>();
        for (const im of pr.images || []) { const k = archivoBase(im.src) + "|" + im.width + "x" + im.height; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k)!.push(im); }
        const borrar: any[] = [];
        for (const [, ims] of grupos) {
          if (ims.length < 2) continue;
          const queda = ims.find((im: any) => anotadas.has(String(im.id))) || ims.slice().sort((a: any, b: any) => a.id - b.id)[0];
          for (const im of ims) if (im !== queda) borrar.push({ im, queda });
        }
        if (!borrar.length) { tocadas.push(pr); continue; }   // igual se revisa en Percha (copias traídas de vuelta)
        res.duplicadas.push({ publicacion: pe, nombre: es(pr.name), fotos: (pr.images || []).length, copias: borrar.length });
        if (simular) continue;
        for (const { im, queda } of borrar) {
          for (const v of (pr.variants || []).filter((v: any) => String(v.image_id) === String(im.id))) { try { await tn("PUT", `/products/${pe}/variants/${v.id}`, { image_id: queda.id }); } catch (_) { /* sigue */ } }
          try { await tn("DELETE", `/products/${pe}/images/${im.id}`); } catch (err) { if (!String(err).includes(" 404")) res.duplicadas.push({ publicacion: pe, imagen: im.id, error: String(err).slice(0, 120) }); }
        }
        tocadas.push({ ...(await tn("GET", `/products/${pe}?fields=id,published,images,variants`)) });
      }
      // y en Percha: las copias que la sincronización había traído como «de la web» se van
      if (tocadas.length && !simular) res.fotos = await fotosDesdeLaWeb(admin, cx, tocadas);
      resumen.push(res); continue;
    }

    // a mano (13/11, Diego): que TODOS los colores de estas prendas se vean en la web (opciones visibles, publicación
    // publicada). {mostrar_colores: [producto_id…]} → informa; con aplicar: true, los muestra.
    if (Array.isArray(body.mostrar_colores)) {
      const { data: cr } = await admin.from("canal_items").select("producto_ext,variante_ext,variante_id,variantes!inner(producto_id,color_id,activa)")
        .eq("conexion_id", cx.id).in("variantes.producto_id", body.mostrar_colores);
      const cids = [...new Set((cr || []).map((c: any) => c.variantes?.color_id).filter(Boolean))];
      const { data: cols } = cids.length ? await admin.from("atributos").select("id,nombre").in("id", cids) : { data: [] };
      const colorDe = new Map((cols || []).map((x: any) => [x.id, x.nombre]));
      const porPub = new Map<string, any[]>(); (cr || []).forEach((c: any) => { const pe = String(c.producto_ext); if (!porPub.has(pe)) porPub.set(pe, []); porPub.get(pe)!.push(c); });
      res.colores = [];
      for (const [pe, lista] of porPub) {
        let pr: any;
        try { pr = await tn("GET", `/products/${pe}?fields=id,name,published,variants`); } catch (err) { res.colores.push({ publicacion: pe, error: String(err).slice(0, 120) }); continue; }
        const vext = new Set(lista.map((c: any) => String(c.variante_ext)));
        const ocultas = (pr.variants || []).filter((v: any) => vext.has(String(v.id)) && v.visible === false);
        const sinCruce = lista.filter((c: any) => !(pr.variants || []).some((v: any) => String(v.id) === String(c.variante_ext)));
        const fila = { publicacion: pe, nombre: es(pr.name), publicada: pr.published !== false, opciones: (pr.variants || []).length,
          ocultas: ocultas.map((v: any) => (v.values || []).map(es).join(" ")), no_estan: sinCruce.map((c: any) => colorDe.get(c.variantes?.color_id) || "?") };
        res.colores.push(fila);
        if (!body.aplicar || simular) continue;
        for (const v of ocultas) { try { await tn("PUT", `/products/${pe}/variants/${v.id}`, { visible: true }); } catch (err) { (fila as any).error = String(err).slice(0, 120); } }
        if (pr.published === false) { try { await tn("PUT", `/products/${pe}`, { published: true }); } catch (err) { (fila as any).error = String(err).slice(0, 120); } }
      }
      resumen.push(res); continue;
    }

    async function publicarProducto(q: any) {
      const { data: p } = await admin.from("productos").select("id,codigo,nombre,precio,tipo,activo,es_generico,publicar_web,categoria_id").eq("id", q.producto_id).single();
      if (!p) return { omitido: "el producto no existe" };
      if (!p.activo || p.es_generico || !p.publicar_web || !["prenda", "varios"].includes(p.tipo)) return { omitido: "no va a la web (inactivo, genérico, kit o marcado solo local)" };
      const { data: vs } = await admin.from("v_variantes").select("id,producto_id,sku,talle,talle_nombre,talle_orden,color,color_nombre,precio,stock_web,activa").eq("producto_id", p.id).eq("activa", true);
      const variantes = (vs || []).filter((v: any) => !/-SD$/i.test(v.sku || "")).sort((a: any, b: any) => String(a.color_nombre || "").localeCompare(String(b.color_nombre || "")) || (a.talle_orden ?? 999) - (b.talle_orden ?? 999));
      if (!variantes.length) return { omitido: "no tiene variantes activas" };
      const { data: cruces } = await admin.from("canal_items").select("variante_id,producto_ext,variante_ext").eq("conexion_id", cx.id).in("variante_id", variantes.map((v: any) => v.id));
      const cruzadas = new Set((cruces || []).map((c: any) => c.variante_id));
      let nuevas = variantes.filter((v: any) => !cruzadas.has(v.id));
      if (Array.isArray(q.variantes) && q.variantes.length) nuevas = nuevas.filter((v: any) => q.variantes.includes(v.id));   // solo las que se crearon (no las que alguien dejó afuera de la web a propósito)
      if (!nuevas.length) return { omitido: "ya está todo en la web" };
      // el precio de la lista de la web y su oferta (la misma cuenta que tn-precios: la web sale con su precio tachado)
      await cargarPrecios();
      const op = { canal: "tiendanube", categoria_id: p.categoria_id, tipo: p.tipo };
      const precioN = (v: any) => calcular({ ...v, precio: +v.precio || +p.precio || 0 }, listaTN, ctxPrecios, { ...op, sinRebajas: true }).precio;
      const promoN = (v: any) => { const c = calcular({ ...v, precio: +v.precio || +p.precio || 0 }, listaTN, ctxPrecios, op); return c.rebaja && c.precio < precioN(v) ? c.precio : null; };
      const precioDe = (v: any) => (+precioN(v) || 0).toFixed(2);
      const variante = (v: any, attrs: string[], visible: boolean, vivos: any[] = []) => ({
        values: attrs.map((a, i) => ({ es: esColor(a) ? v.color_nombre : esTalle(a) ? (vivos.map((x: any) => es((x.values || [])[i])).find((t: string) => talleClave(t) === talleClave(v.talle_nombre)) || v.talle_nombre || "Único") : "" })),
        price: precioDe(v), ...(promoN(v) ? { promotional_price: (+promoN(v)).toFixed(2) } : {}), stock: Math.max(0, Math.floor(+v.stock_web || 0)), sku: p.codigo, mpn: p.codigo, ...MEDIDAS, ...(visible ? {} : { visible: false }) });
      const attrsPara = (vs2: any[]) => [...(vs2.some((v) => v.color) ? ["Color"] : []), ...(vs2.some((v) => v.talle) ? ["Talle"] : [])];
      const avisos: string[] = [], creadas: any[] = [], publicaciones: any[] = [], completadas: any[] = [];
      // guardar el cruce de lo que se creó (stock y precios siguen solos desde acá)
      const cruzar = async (prodTN: any, varTN: any, v: any, dePercha = false) => {
        creadas.push({ variante: [v.color_nombre, v.talle_nombre].filter(Boolean).join(" ") || "única", publicacion: String(prodTN.id), variante_ext: String(varTN.id), visible: varTN.visible !== false });
        if (simular) return;
        await admin.from("canal_items").upsert({ empresa_id: e, conexion_id: cx.id, producto_ext: String(prodTN.id), variante_ext: String(varTN.id), nombre: es(prodTN.name), valores: (varTN.values || []).map(es).join(" / "),
          sku: p.codigo, mpn: p.codigo, talle_canal: v.talle_nombre || null, color_canal: v.color_nombre || null, precio: +precioDe(v), precio_promo: promoN(v), stock: Math.max(0, Math.floor(+v.stock_web || 0)),
          publicado: prodTN.published !== false, variante_id: v.id, cruce: "manual", actualizado: new Date().toISOString(), ...(dePercha ? { de_percha: true } : {}) }, { onConflict: "conexion_id,variante_ext" });
      };
      const emparejar = (varsTN: any[], attrs: string[], v: any) => varsTN.find((x: any) => attrs.every((a, i) => esTalle(a) ? talleClave(es((x.values || [])[i])) === talleClave(v.talle_nombre) : norm(es((x.values || [])[i])) === norm(esColor(a) ? v.color_nombre : "")));
      // una publicación nueva, oculta
      const crearPublicacion = async (nombre: string, vs2: any[]) => {
        const attrs = attrsPara(vs2);
        const cuerpo = { name: { es: nombre }, published: !cfg.nuevos_ocultos, ...(attrs.length ? { attributes: attrs.map((a) => ({ es: a })) } : {}), variants: vs2.map((v) => variante(v, attrs, true)) };
        publicaciones.push({ nueva: true, nombre, oculta: !!cfg.nuevos_ocultos, variantes: vs2.length });
        if (simular) { vs2.forEach((v) => creadas.push({ variante: [v.color_nombre, v.talle_nombre].filter(Boolean).join(" ") || "única", publicacion: "(nueva)" })); return; }
        // si un intento anterior ya la creó (y falló después), se usa esa: nunca dos publicaciones iguales
        const previa = (q.detalle?.creadas_tn || []).find((c: any) => c.nombre === nombre);
        const prod = previa ? await tn("GET", `/products/${previa.id}?fields=id,name,published,attributes,variants`) : await tn("POST", "/products", cuerpo);
        if (!previa && q.id) await admin.from("canal_publicar").update({ detalle: { ...(q.detalle || {}), creadas_tn: [...(q.detalle?.creadas_tn || []), { id: prod.id, nombre }] } }).eq("id", q.id);
        if (!previa) q.detalle = { ...(q.detalle || {}), creadas_tn: [...(q.detalle?.creadas_tn || []), { id: prod.id, nombre }] };
        for (const v of vs2) { const x = emparejar(prod.variants || [], attrs, v); if (x) await cruzar(prod, x, v, true); else avisos.push(`No encontré en la web ${[v.color_nombre, v.talle_nombre].filter(Boolean).join(" ")}`); }
        try { completadas.push(await completarPublicacion(String(prod.id), p)); } catch (err) { avisos.push("No se pudieron cargar las categorías: " + String(err).slice(0, 120)); }
      };

      if (!(cruces || []).length) {
        // nunca estuvo en la web: una publicación con todos sus colores y talles
        await crearPublicacion(p.nombre, nuevas);
      } else {
        // ya está en la web: qué publicaciones tiene y qué colores lleva cada una
        const varPorId = new Map(variantes.map((v: any) => [v.id, v]));
        const pubs = new Map<string, { colores: Set<string>; info?: any }>();
        for (const c of cruces || []) { const v: any = varPorId.get(c.variante_id); if (!pubs.has(c.producto_ext)) pubs.set(c.producto_ext, { colores: new Set() }); if (v?.color) pubs.get(c.producto_ext)!.colores.add(v.color); }
        for (const [pe, x] of pubs) { try { x.info = await tn("GET", `/products/${pe}?fields=id,name,published,attributes,variants`); } catch (_) { /* publicación borrada en la web */ } }
        const vivas = [...pubs.entries()].filter(([, x]) => x.info);
        const porColor = new Map<string, any[]>(); nuevas.forEach((v: any) => { const k = v.color || ""; if (!porColor.has(k)) porColor.set(k, []); porColor.get(k)!.push(v); });
        const unaPorColor = vivas.length > 1 && vivas.every(([, x]) => x.colores.size <= 1);
        for (const [color, grupo] of porColor) {
          // el talle nuevo de un color que ya está publicado: a su publicación (ya tiene fotos: visible)
          let destino = vivas.find(([, x]) => color && x.colores.has(color)) || (!color && vivas.length === 1 ? vivas[0] : null);
          let visible = !!destino;
          // un color nuevo: a la publicación que tiene "Color" (oculto), salvo que la prenda tenga una publicación por color
          if (!destino && color && !unaPorColor) { destino = vivas.find(([, x]) => (x.info.attributes || []).some((a: any) => esColor(es(a)))) || null; visible = !cfg.nuevos_ocultos; }
          if (destino) {
            const [pe, x] = destino, attrs: string[] = (x.info.attributes || []).map(es);
            const falta = grupo.find((v: any) => attrs.some((a) => !esColor(a) && !esTalle(a)) || (v.talle && !attrs.some(esTalle)) || (v.color && !attrs.some(esColor) && !x.colores.has(v.color)));
            if (!falta) {
              publicaciones.push({ nueva: false, publicacion: pe, nombre: es(x.info.name), oculta_la_variante: !visible, variantes: grupo.length });
              for (const v of grupo) {
                if (simular) { creadas.push({ variante: [v.color_nombre, v.talle_nombre].filter(Boolean).join(" ") || "única", publicacion: pe, visible }); continue; }
                const ya = emparejar(x.info.variants || [], attrs, v);   // ya existe en la web (sin cruzar): se cruza, no se repite
                const varTN = ya || await tn("POST", `/products/${pe}/variants`, variante(v, attrs, visible, x.info.variants || []));
                if (!visible && varTN.visible !== false) avisos.push(`${v.color_nombre} ${v.talle_nombre || ""}: Tienda Nube no dejó ocultar la variante (quedó visible)`);
                await cruzar(x.info, varTN, v);
              }
              continue;
            }
          }
          // una publicación nueva para este color (la prenda va una publicación por color)
          await crearPublicacion(color ? `${p.nombre} ${String(grupo[0].color_nombre || "").toUpperCase()}` : p.nombre, grupo);
        }
      }
      return { publicaciones, creadas: creadas.length, detalle: creadas, avisos, completadas };
    }


    // ================= 3) fotos de Percha a la web (si la conexión lo permite: Conexiones › «Fotos desde Percha») =================
    // Una foto cargada en Percha (origen manual, web = null) se sube a las publicaciones de su prenda: a las que creó Percha
    // y a las visibles (las ocultas viejas son publicaciones de antes, no se tocan). Por color: a la publicación que tiene
    // ese color y, si esas opciones no tenían foto, queda como su foto (y si estaban ocultas, se muestran).
    // producto_fotos.web = {publicación: id de la imagen} mientras se sube; apenas la web la tiene, la lectura de fotos
    // la pasa a «foto de la web» (una sola, atada a su imagen) y retira la de Percha. {} = revisada, no va a ninguna.
    // Candado: una sola vuelta sube a la vez (subir tarda; dos vueltas juntas duplicaban). Antes de subir se mira si ese
    // archivo ya está en la publicación (entonces se anota, no se sube de nuevo).
    // Borrar en Percha una foto de la web (borrar_web) la borra también en Tienda Nube.
    let candado = false;
    const tocadasWeb = new Set<string>();   // publicaciones a releer enseguida (sus fotos cambiaron)
    if ((!body.producto_id || body.fotos_percha) && !simular && cfg.fotos_desde_percha) {
      const ahoraC = new Date();
      const { data: tomado } = await admin.from("conexiones").update({ fotos_subiendo_hasta: new Date(ahoraC.getTime() + 5 * 60000).toISOString() })
        .eq("id", cx.id).or(`fotos_subiendo_hasta.is.null,fotos_subiendo_hasta.lt.${ahoraC.toISOString()}`).select("id");
      candado = !!(tomado && tomado.length);
      if (!candado) res.fotos_a_la_web = { omitido: "otra vuelta está subiendo fotos" };
    }
    if ((!body.producto_id || body.fotos_percha) && cfg.fotos_desde_percha && (candado || simular)) try {
      const subidas: any[] = []; let n = 0;
      // --- borradas en Percha → se borran en la web ---
      const { data: aBorrar } = await admin.from("producto_fotos").select("id,producto_ext,imagen_ext,web").eq("empresa_id", e).eq("borrar_web", true).limit(MAX_FOTOS);
      for (const f of aBorrar || []) {
        // la foto de la web, o una de Percha que ya se había subido (a una o varias publicaciones)
        const destinos: [string, string][] = f.imagen_ext && f.producto_ext ? [[String(f.producto_ext), String(f.imagen_ext)]] : Object.entries(f.web || {}).filter(([, id]) => id && id !== "borrada").map(([pe, id]) => [pe, String(id)]);
        if (simular) { subidas.push({ borrar: destinos }); continue; }
        let fallo = false;
        for (const [pe, img] of destinos) {
          try { await tn("DELETE", `/products/${pe}/images/${img}`); } catch (err) { if (!String(err).includes(" 404")) { fallo = true; subidas.push({ publicacion: pe, borrar: img, error: String(err).slice(0, 150) }); } }
          tocadasWeb.add(pe);
        }
        if (fallo) continue;   // se reintenta en la próxima vuelta
        await admin.from("producto_fotos").delete().eq("id", f.id); n++;
        subidas.push({ borrada: destinos.map(([, i]) => i).join(",") || "(solo en Percha)" });
      }
      const enLaWeb = new Map<string, Map<string, string>>();   // publicación → (nombre de archivo → id de imagen)
      const imagenesDe = async (pe: string) => {
        if (!enLaWeb.has(pe)) {
          const m = new Map<string, string>();
          try { for (const im of (await tn("GET", `/products/${pe}/images?fields=id,src`)) || []) { const k = archivoBase(im.src); if (k && !m.has(k)) m.set(k, String(im.id)); } } catch (_) { /* si no se puede leer, se sube igual */ }
          enLaWeb.set(pe, m);
        }
        return enLaWeb.get(pe)!;
      };
      const fotoDelColor = async (pe: string, ids: string[], imgId: string) => {
        try {
          const vs = await tn("GET", `/products/${pe}/variants?fields=id,image_id,visible`);
          for (const v of (vs || []).filter((v: any) => ids.includes(String(v.id)) && (!v.image_id || v.visible === false)))
            await tn("PUT", `/products/${pe}/variants/${v.id}`, { ...(!v.image_id ? { image_id: +imgId } : {}), visible: true });
        } catch (_) { /* la foto ya está; la asignación a la opción queda para hacer a mano */ }
      };
      const { data: pend } = await admin.from("producto_fotos").select("id,producto_id,color_id,url,orden,creado,web")
        .eq("empresa_id", e).eq("origen", "manual").eq("borrar_web", false).is("web", null).order("creado").limit(400);   // web null = todavía no se revisó
      const porProd = new Map<string, any[]>(); (pend || []).forEach((f: any) => { if (!porProd.has(f.producto_id)) porProd.set(f.producto_id, []); porProd.get(f.producto_id)!.push(f); });
      for (const [pid, fotos] of porProd) {
        if (n >= MAX_FOTOS) break;
        const { data: cr } = await admin.from("canal_items").select("producto_ext,variante_ext,publicado,de_percha,variantes!inner(producto_id,color_id,activa)").eq("conexion_id", cx.id).eq("variantes.producto_id", pid);
        const pubs = new Map<string, { dePercha: boolean; publicado: boolean; colores: Map<string, string[]> }>();
        (cr || []).forEach((c: any) => { const pe = String(c.producto_ext); if (!pubs.has(pe)) pubs.set(pe, { dePercha: false, publicado: false, colores: new Map() }); const x = pubs.get(pe)!; x.dePercha ||= !!c.de_percha; x.publicado ||= !!c.publicado; const col = c.variantes?.color_id || ""; if (!x.colores.has(col)) x.colores.set(col, []); x.colores.get(col)!.push(String(c.variante_ext)); });
        if (!pubs.size) continue;   // la prenda todavía no está en la web: cuando se publique, sus fotos van
        for (const f of fotos.sort((a: any, b: any) => (a.color_id ? 1 : 0) - (b.color_id ? 1 : 0) || a.orden - b.orden)) {
          if (n >= MAX_FOTOS) break;
          const web = { ...(f.web || {}) }; let cambio = false;
          for (const [pe, x] of pubs) {
            if (web[pe]) continue;
            if (!x.dePercha && !x.publicado) continue;                              // las ocultas viejas no
            if (f.color_id && !x.colores.has(f.color_id)) continue;                  // foto de un color que esa publicación no tiene
            const ya = (await imagenesDe(pe)).get(archivoBase(f.url));
            if (ya) { web[pe] = ya; cambio = true; tocadasWeb.add(pe); subidas.push({ publicacion: pe, foto: f.id, ya_estaba: ya }); if (f.color_id && !simular) await fotoDelColor(pe, x.colores.get(f.color_id)!, ya); continue; }   // ya está: se anota, no se duplica
            if (simular) { subidas.push({ publicacion: pe, foto: f.id, color: !!f.color_id }); continue; }
            let img: any;
            try { img = await tn("POST", `/products/${pe}/images`, { src: f.url }); }
            catch (err) { subidas.push({ publicacion: pe, foto: f.id, error: String(err).slice(0, 150) }); if (String(err).includes(" 404")) web[pe] = "borrada"; cambio = true; continue; }
            web[pe] = String(img.id); cambio = true; n++; tocadasWeb.add(pe); (await imagenesDe(pe)).set(archivoBase(f.url), String(img.id));
            if (f.color_id) await fotoDelColor(pe, x.colores.get(f.color_id)!, String(img.id));
            subidas.push({ publicacion: pe, foto: f.id, imagen: String(img.id) });
          }
          // {} = revisada, no va a ninguna. La foto de un color que todavía no está en la web queda pendiente (va cuando el color llegue)
          const colorEsperando = !!f.color_id && ![...pubs.values()].some((x) => x.colores.has(f.color_id));
          if (!simular && (cambio || (!f.web && !colorEsperando))) await admin.from("producto_fotos").update({ web }).eq("id", f.id);
        }
      }
      res.fotos_a_la_web = { subidas: subidas.filter((s) => s.imagen).length, ya_estaban: subidas.filter((s) => s.ya_estaba).length, borradas: subidas.filter((s) => s.borrada).length, errores: subidas.filter((s) => s.error).length, detalle: subidas.slice(0, 30) };
    } finally {
      if (candado) await admin.from("conexiones").update({ fotos_subiendo_hasta: null }).eq("id", cx.id);
    }
    // lo que se subió o borró recién se relee en esta misma vuelta (Percha muestra ya la foto de la web, sin esperar)
    if (!simular && tocadasWeb.size) await admin.from("canal_cambios_web").upsert([...tocadasWeb].map((pe) => ({ conexion_id: cx.id, producto_ext: pe, evento: "percha", recibido: new Date().toISOString() })));

    // ================= 2) fotos y visibilidad: de la web a Percha =================
    // a) avisos al instante (la web avisó que el producto cambió, o Percha le subió/borró fotos): de a 30 publicaciones
    if (!body.producto_id) {
      const { data: avisos } = await admin.from("canal_cambios_web").select("producto_ext,recibido").eq("conexion_id", cx.id).order("recibido").limit(MAX_AVISOS);
      if ((avisos || []).length) {
        const leidos: any[] = [], hechos: any[] = [];
        for (const a of avisos || []) {
          try { leidos.push(await tn("GET", `/products/${a.producto_ext}?fields=id,published,images,variants`)); hechos.push(a); }
          catch (err) { if (String(err).includes(" 404")) hechos.push(a); }   // borrada en la web: la lectura completa la saca del cruce
        }
        try {
          res.fotos_avisos = await fotosDesdeLaWeb(admin, cx, leidos, { simular });
          // solo se borra el aviso si no llegó otro mientras tanto
          if (!simular) for (const a of hechos) await admin.from("canal_cambios_web").delete().eq("conexion_id", cx.id).eq("producto_ext", a.producto_ext).lte("recibido", a.recibido);
        } catch (err) { res.fotos_avisos = { error: String((err as Error)?.message || err).slice(0, 200) }; }
      }
    }
    // b) por si se perdió algún aviso: cada 5 min, los productos que cambiaron en la web (la lectura completa cada 30 min limpia el resto)
    const ahora = Date.now(), ult = cx.ultima_sync_fotos ? new Date(cx.ultima_sync_fotos).getTime() : 0;
    if (body.fotos || (!body.producto_id && ahora - ult > CADA_FOTOS_MIN * 60000)) {
      const desde = new Date((body.fotos_desde ? new Date(body.fotos_desde).getTime() : ult || ahora - 60 * 60000) - 2 * 60000).toISOString();
      const cambios: any[] = []; let completo = true;
      for (let page = 1; page <= 30; page++) {
        let lote: any[];
        try { lote = await tn("GET", `/products?updated_at_min=${encodeURIComponent(desde)}&per_page=200&page=${page}&fields=id,published,images,variants`); }
        catch (err) { if (String(err).includes(" 404")) break; completo = false; res.fotos_error = String(err); break; }
        if (!Array.isArray(lote) || !lote.length) break; cambios.push(...lote); if (lote.length < 200) break;
      }
      res.fotos = await fotosDesdeLaWeb(admin, cx, cambios, { simular });
      if (completo && !simular) await admin.from("conexiones").update({ ultima_sync_fotos: new Date(ahora).toISOString() }).eq("id", cx.id);
    }

    resumen.push(res);
  }
  return json({ ok: true, simular, resumen });
});
