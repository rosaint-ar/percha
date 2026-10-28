// tn-precios · manda a Tienda Nube los precios de la lista de la conexión (precio normal + precio promocional).
// Precio normal = la lista del canal SIN rebajas; promocional = con las rebajas que valen en el canal (o vacío si no hay).
// La cuenta es la misma que shared/precios.js (la caja): fijo de la lista > rebaja (si la lista la toma) × % (excepción
// de producto > de familia > de la lista) → redondeo. Si se cambia una, cambiar la otra.
// No toca: lo oculto en la web (salvo conexiones.incluir_ocultos), genéricos, prendas con varias publicaciones que no
//   coinciden en precio u oferta, y las que en la web tienen la oferta igual o mayor al precio (así las dejó la tienda).
// body: { empresa_id, accion: 'revisar' | 'aplicar', limite? }  ·  cron (x-cron-key): aplica en las conexiones con empujar_precios.
// 'revisar' lee los precios de la web en vivo y devuelve las diferencias sin escribir nada.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const SB_URL = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, CRON_KEY = Deno.env.get("CRON_KEY") || "";
const UA = "Percha (rosaint.ar@gmail.com)";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- la cuenta de precios (copia de shared/precios.js) ----------
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
  const { data: ck } = await admin.from("app_config").select("valor").eq("clave", "cron_key").maybeSingle();
  const claveCron = CRON_KEY || ck?.valor || "";
  const esCron = !!(req.headers.get("x-cron-key") && claveCron && req.headers.get("x-cron-key") === claveCron);
  let userId: string | null = null, filtroEmpresa: string | null = body.empresa_id || null;
  if (!esCron) {
    const comoUsuario = createClient(SB_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await comoUsuario.auth.getUser();
    if (!user) return json({ error: "Sesión inválida" }, 401);
    if (!body.empresa_id) return json({ error: "Falta empresa_id" }, 400);
    const { data: ok } = await comoUsuario.rpc("es_admin", { e: body.empresa_id });
    if (!ok) return json({ error: "Solo administración maneja los precios de la web" }, 403);
    userId = user.id;
  }
  const accion = esCron && !body.accion ? "aplicar" : (body.accion || "revisar");
  if (!["revisar", "aplicar"].includes(accion)) return json({ error: "Acción inválida" }, 400);
  const limite = Math.min(+body.limite || 120, 300);   // escrituras por llamada (Tienda Nube: ~2 por segundo)

  let qc = admin.from("conexiones").select("id,empresa_id,externo_id,canal,incluir_ocultos,empujar_precios").eq("estado", "activa").eq("canal", "tiendanube");
  if (filtroEmpresa) qc = qc.eq("empresa_id", filtroEmpresa);
  if (esCron && !body.accion) qc = qc.eq("empujar_precios", true);
  const { data: conexiones } = await qc;
  const pag = async (q: () => any) => { let todo: any[] = []; for (let d = 0; ; d += 1000) { const { data, error } = await q().range(d, d + 999); if (error) throw error; todo = todo.concat(data || []); if (!data || data.length < 1000) break; } return todo; };
  const resultados: any[] = [];

  for (const cx of conexiones || []) {
    const e = cx.empresa_id;
    const { data: lista } = await admin.from("listas_precios").select("*").eq("empresa_id", e).eq("canal", "tiendanube").eq("activa", true).maybeSingle();
    if (!lista) { resultados.push({ conexion: cx.id, error: "La conexión no tiene lista de precios" }); continue; }
    const { data: sec } = await admin.from("conexion_secretos").select("access_token").eq("conexion_id", cx.id).maybeSingle();
    if (!sec) { resultados.push({ conexion: cx.id, error: "Sin acceso a la tienda" }); continue; }
    const headers = { Authentication: `bearer ${sec.access_token}`, "User-Agent": UA, "Content-Type": "application/json" };
    const base = `https://api.tiendanube.com/2025-03/${cx.externo_id}`;

    // reglas y rebajas
    const [listas, excep, fijos, rebajas, rp] = await Promise.all([
      pag(() => admin.from("listas_precios").select("*").eq("empresa_id", e).eq("activa", true).order("orden")),
      pag(() => admin.from("lista_excepciones").select("lista_id,categoria_id,producto_id,porcentaje").eq("empresa_id", e)),
      pag(() => admin.from("precios").select("lista_id,producto_id,variante_id,precio").eq("empresa_id", e)),
      pag(() => admin.from("promociones").select("*").eq("empresa_id", e).eq("activa", true).eq("tipo", "rebaja")),
      pag(() => admin.from("rebaja_precios").select("promocion_id,producto_id,variante_id,precio").eq("empresa_id", e))]);
    const ctx = armar({ listas, excep, fijos, rebajas, rp });

    // los precios de la web AHORA (en el panel de Tienda Nube también los cambian a mano)
    const web = new Map<string, { pub: boolean; precio: number | null; promo: number | null; pid: string }>(); let completo = true;
    for (let page = 1; page <= 60; page++) {
      const r = await fetch(`${base}/products?per_page=200&page=${page}&fields=id,published,variants`, { headers });
      if (r.status === 404) break; if (!r.ok) { completo = false; break; }
      const lote = await r.json(); if (!Array.isArray(lote) || !lote.length) break;
      for (const pr of lote) for (const v of pr.variants || []) web.set(String(v.id), { pub: pr.published !== false, precio: v.price != null ? +v.price : null, promo: v.promotional_price != null && +v.promotional_price > 0 ? +v.promotional_price : null, pid: String(pr.id) });
      if (lote.length < 200) break;
    }
    if (!completo || !web.size) { resultados.push({ conexion: cx.id, error: "No se pudieron leer los precios de la web" }); continue; }

    // lo cruzado, con el precio y la familia de cada prenda en Percha
    const items = await pag(() => admin.from("canal_items").select("id,variante_id,producto_ext,variante_ext,nombre,valores").eq("conexion_id", cx.id).not("variante_id", "is", null));
    const vids = [...new Set(items.map((i: any) => i.variante_id))];
    const vars = new Map<string, any>();
    for (let i = 0; i < vids.length; i += 300) {
      const { data } = await admin.from("v_variantes").select("id,producto_id,producto_nombre,talle_nombre,color_nombre,precio").in("id", vids.slice(i, i + 300));
      for (const v of data || []) vars.set(v.id, v);
    }
    const pids = [...new Set([...vars.values()].map((v: any) => v.producto_id))], prods = new Map<string, any>();
    for (let i = 0; i < pids.length; i += 300) {
      const { data } = await admin.from("productos").select("id,categoria_id,tipo,es_generico,activo").in("id", pids.slice(i, i + 300));
      for (const p of data || []) prods.set(p.id, p);
    }

    const cambios: any[] = [], sinTocar: any[] = [];
    const porVar = new Map<string, any[]>();
    for (const it of items) { const w = web.get(String(it.variante_ext)); if (!w) continue; if (!w.pub && !cx.incluir_ocultos) continue; it.w = w; (porVar.get(it.variante_id) || porVar.set(it.variante_id, []).get(it.variante_id)!).push(it); }
    for (const [vid, its] of porVar) {
      const v = vars.get(vid), p = v && prods.get(v.producto_id);
      if (!v || !p || !p.activo) continue;
      if (p.es_generico) continue;
      if (!(+v.precio > 0)) { sinTocar.push({ producto: v.producto_nombre, por: "sin precio en Percha" }); continue; }
      const nomV = [v.talle_nombre, v.color_nombre].filter(Boolean).join(" · ");
      if (new Set(its.map((i: any) => i.w.precio)).size > 1 || new Set(its.map((i: any) => i.w.promo ?? 0)).size > 1) { sinTocar.push({ producto: v.producto_nombre, variante: nomV, por: "varias publicaciones con distinto precio u oferta" }); continue; }
      if (its.some((i: any) => i.w.promo != null && i.w.promo >= i.w.precio)) { sinTocar.push({ producto: v.producto_nombre, variante: nomV, por: "en la web la oferta es igual o mayor al precio: se deja como está" }); continue; }
      const op = { canal: "tiendanube", categoria_id: p.categoria_id, tipo: p.tipo };
      const normal = calcular(v, lista, ctx, { ...op, sinRebajas: true }).precio;
      const conReb = calcular(v, lista, ctx, op);
      const promo = conReb.rebaja && conReb.precio < normal ? conReb.precio : null;
      for (const it of its) {
        if (it.w.precio === normal && (it.w.promo ?? null) === promo) continue;
        cambios.push({ item: it.id, variante_id: vid, producto_ext: it.producto_ext, variante_ext: it.variante_ext, producto: v.producto_nombre, variante: [v.talle_nombre, v.color_nombre].filter(Boolean).join(" · "),
          precio_antes: it.w.precio, promo_antes: it.w.promo, precio: normal, promo, rebaja: conReb.rebaja ? conReb.rebaja.nombre : null });
      }
    }

    if (accion === "revisar") { resultados.push({ conexion: cx.id, lista: { nombre: lista.nombre, porcentaje: lista.porcentaje }, revisadas: porVar.size, cambios, sin_tocar: sinTocar.slice(0, 200), n_sin_tocar: sinTocar.length }); continue; }

    // aplicar: de a una variante, frenando si Tienda Nube pide esperar
    let hechos = 0, errores = 0; const errs: string[] = [];
    for (const c of cambios.slice(0, limite)) {
      const r = await fetch(`${base}/products/${c.producto_ext}/variants/${c.variante_ext}`, { method: "PUT", headers, body: JSON.stringify({ price: c.precio, promotional_price: c.promo }) });
      if (r.status === 429) { await espera(2000); break; }
      const ok = r.ok; const err = ok ? null : `${r.status} ${(await r.text()).slice(0, 200)}`;
      await admin.from("canal_precio_envios").insert({ empresa_id: e, conexion_id: cx.id, variante_id: c.variante_id, producto_ext: c.producto_ext, variante_ext: c.variante_ext, precio_antes: c.precio_antes, precio_despues: c.precio, promo_antes: c.promo_antes, promo_despues: c.promo, user_id: userId, error: err });
      if (ok) { hechos++; await admin.from("canal_items").update({ precio: c.precio, precio_promo: c.promo, actualizado: new Date().toISOString() }).eq("id", c.item); }
      else { errores++; if (errs.length < 5) errs.push(`${c.producto} ${c.variante}: ${err}`); }
      await espera(350);
    }
    await admin.from("conexiones").update({ ultimo_envio_precios: new Date().toISOString() }).eq("id", cx.id);
    resultados.push({ conexion: cx.id, hechos, errores, errs, faltan: Math.max(0, cambios.length - hechos - errores) });
  }
  return json({ ok: true, resultados });
});
