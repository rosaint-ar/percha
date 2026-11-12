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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const SB_URL = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UA = "Percha (rosaint.ar@gmail.com)";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
// talles: XXL = 2XL, XXXL = 3XL (Percha usa 2XL/3XL desde el 12/11; la web puede seguir diciendo XXL)
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/xxxxl/g, "4xl").replace(/xxxl/g, "3xl").replace(/xxl/g, "2xl");
// el talle de la web como lo nombra Percha (sql/139): «Único» solo = sin talle; «Único (35 - 41)» = «Único (35 al 41)»; «S a XL» = «S al XL»
const talleClave = (s: unknown) => { const x = String(s ?? "").trim(); if (/^([uú]nic[oa]|talle [uú]nico)$/i.test(x)) return ""; return norm(x.replace(/\s*-\s*/g, " al ").replace(/\s+a\s+/gi, " al ")); };
const es = (v: unknown) => (v && typeof v === "object" ? ((v as Record<string, string>).es ?? Object.values(v as Record<string, string>)[0] ?? "") : String(v ?? ""));
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ESPERA_MIN = 10, CADA_FOTOS_MIN = 5;   // 10 min sin cambios: con 2 se publicaba mientras todavía se estaba corrigiendo la prenda
const MEDIDAS = { weight: "0.010", width: "4.00", height: "4.00", depth: "4.00" };   // Augusta: todo en 10 g y 4×4×4 (piso del Correo)
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
  let qc = admin.from("conexiones").select("id,empresa_id,externo_id,canal,empujar_stock,ultima_sync_fotos").eq("estado", "activa").eq("canal", "tiendanube");
  if (filtroEmpresa) qc = qc.eq("empresa_id", filtroEmpresa);
  const { data: conexiones } = await qc;
  const resumen: any[] = [];

  for (const cx of conexiones || []) {
    if (!cx.empujar_stock && !simular) continue;   // la web todavía no la maneja Percha
    const { data: sec } = await admin.from("conexion_secretos").select("access_token").eq("conexion_id", cx.id).maybeSingle();
    if (!sec) continue;
    const headers = { Authentication: `bearer ${sec.access_token}`, "User-Agent": UA, "Content-Type": "application/json" };
    const base = `https://api.tiendanube.com/2025-03/${cx.externo_id}`;
    const tn = async (metodo: string, ruta: string, cuerpo?: unknown) => {
      for (let i = 0; i < 4; i++) {
        const r = await fetch(base + ruta, { method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
        if (r.status === 429) { await dormir(1500 * (i + 1)); continue; }
        const t = await r.text(); let d: any = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
        if (!r.ok) throw new Error(`Tienda Nube ${r.status}: ${typeof d === "string" ? d.slice(0, 200) : JSON.stringify(d).slice(0, 300)}`);
        return d;
      }
      throw new Error("Tienda Nube: demasiados pedidos seguidos");
    };
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
    else {
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
      const avisos: string[] = [], creadas: any[] = [], publicaciones: any[] = [];
      // guardar el cruce de lo que se creó (stock y precios siguen solos desde acá)
      const cruzar = async (prodTN: any, varTN: any, v: any) => {
        creadas.push({ variante: [v.color_nombre, v.talle_nombre].filter(Boolean).join(" ") || "única", publicacion: String(prodTN.id), variante_ext: String(varTN.id), visible: varTN.visible !== false });
        if (simular) return;
        await admin.from("canal_items").upsert({ empresa_id: e, conexion_id: cx.id, producto_ext: String(prodTN.id), variante_ext: String(varTN.id), nombre: es(prodTN.name), valores: (varTN.values || []).map(es).join(" / "),
          sku: p.codigo, mpn: p.codigo, talle_canal: v.talle_nombre || null, color_canal: v.color_nombre || null, precio: +precioDe(v), precio_promo: promoN(v), stock: Math.max(0, Math.floor(+v.stock_web || 0)),
          publicado: prodTN.published !== false, variante_id: v.id, cruce: "manual", actualizado: new Date().toISOString() }, { onConflict: "conexion_id,variante_ext" });
      };
      const emparejar = (varsTN: any[], attrs: string[], v: any) => varsTN.find((x: any) => attrs.every((a, i) => esTalle(a) ? talleClave(es((x.values || [])[i])) === talleClave(v.talle_nombre) : norm(es((x.values || [])[i])) === norm(esColor(a) ? v.color_nombre : "")));
      // una publicación nueva, oculta
      const crearPublicacion = async (nombre: string, vs2: any[]) => {
        const attrs = attrsPara(vs2);
        const cuerpo = { name: { es: nombre }, published: false, ...(attrs.length ? { attributes: attrs.map((a) => ({ es: a })) } : {}), variants: vs2.map((v) => variante(v, attrs, true)) };
        publicaciones.push({ nueva: true, nombre, oculta: true, variantes: vs2.length });
        if (simular) { vs2.forEach((v) => creadas.push({ variante: [v.color_nombre, v.talle_nombre].filter(Boolean).join(" ") || "única", publicacion: "(nueva)" })); return; }
        // si un intento anterior ya la creó (y falló después), se usa esa: nunca dos publicaciones iguales
        const previa = (q.detalle?.creadas_tn || []).find((c: any) => c.nombre === nombre);
        const prod = previa ? await tn("GET", `/products/${previa.id}?fields=id,name,published,attributes,variants`) : await tn("POST", "/products", cuerpo);
        if (!previa && q.id) await admin.from("canal_publicar").update({ detalle: { ...(q.detalle || {}), creadas_tn: [...(q.detalle?.creadas_tn || []), { id: prod.id, nombre }] } }).eq("id", q.id);
        if (!previa) q.detalle = { ...(q.detalle || {}), creadas_tn: [...(q.detalle?.creadas_tn || []), { id: prod.id, nombre }] };
        for (const v of vs2) { const x = emparejar(prod.variants || [], attrs, v); if (x) await cruzar(prod, x, v); else avisos.push(`No encontré en la web ${[v.color_nombre, v.talle_nombre].filter(Boolean).join(" ")}`); }
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
          if (!destino && color && !unaPorColor) { destino = vivas.find(([, x]) => (x.info.attributes || []).some((a: any) => esColor(es(a)))) || null; visible = false; }
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
      return { publicaciones, creadas: creadas.length, detalle: creadas, avisos };
    }

    // ================= 2) fotos y visibilidad: de la web a Percha =================
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
      res.fotos = await sincronizarFotos(cambios);
      if (completo && !simular) await admin.from("conexiones").update({ ultima_sync_fotos: new Date(ahora).toISOString() }).eq("id", cx.id);
    }

    async function sincronizarFotos(prods: any[]) {
      const out = { revisadas: prods.length, fotos_nuevas: 0, fotos_quitadas: 0, mostradas: 0, ocultadas: 0, cambios: [] as any[] };
      if (!prods.length) return out;
      const pes = prods.map((x: any) => String(x.id));
      const items: any[] = [];
      for (let i = 0; i < pes.length; i += 150) { const { data } = await admin.from("canal_items").select("id,producto_ext,variante_ext,variante_id,publicado,imagen").eq("conexion_id", cx.id).in("producto_ext", pes.slice(i, i + 150)); items.push(...(data || [])); }
      const vids = [...new Set(items.filter((c) => c.variante_id).map((c) => c.variante_id))];
      const vinfo = new Map<string, any>();
      for (let i = 0; i < vids.length; i += 300) { const { data } = await admin.from("variantes").select("id,producto_id,color_id").in("id", vids.slice(i, i + 300)); (data || []).forEach((v: any) => vinfo.set(v.id, v)); }
      // cuántas publicaciones tiene cada producto de Percha (si es una sola, sus fotos "generales" también son de esa)
      const pids = [...new Set([...vinfo.values()].map((v: any) => v.producto_id))];
      const pubsDe = new Map<string, Set<string>>();
      for (let i = 0; i < pids.length; i += 100) {
        const { data } = await admin.from("canal_items").select("producto_ext,variante_id,variantes!inner(producto_id)").eq("conexion_id", cx.id).in("variantes.producto_id", pids.slice(i, i + 100));
        (data || []).forEach((c: any) => { const pid = c.variantes?.producto_id; if (!pid) return; if (!pubsDe.has(pid)) pubsDe.set(pid, new Set()); pubsDe.get(pid)!.add(String(c.producto_ext)); });
      }
      const fotosDe = new Map<string, any[]>();
      for (let i = 0; i < pids.length; i += 100) { const { data } = await admin.from("producto_fotos").select("id,producto_id,color_id,url,orden,origen").in("producto_id", pids.slice(i, i + 100)); (data || []).forEach((f: any) => { if (!fotosDe.has(f.producto_id)) fotosDe.set(f.producto_id, []); fotosDe.get(f.producto_id)!.push(f); }); }
      const { data: prodsP } = pids.length ? await admin.from("productos").select("id,imagen_url,empresa_id").in("id", pids) : { data: [] };
      const imagenDe = new Map((prodsP || []).map((x: any) => [x.id, x]));

      for (const pr of prods) {
        const suyos = items.filter((c) => c.producto_ext === String(pr.id)); if (!suyos.length) continue;
        const pub = pr.published !== false, img0 = (pr.images || []).sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))[0]?.src || null;
        // visible / oculto (al mostrarla, que reciba el stock de Percha)
        for (const c of suyos) {
          if (c.publicado === pub && (c.imagen || null) === img0) continue;
          if (!simular) await admin.from("canal_items").update({ publicado: pub, imagen: img0, actualizado: new Date().toISOString() }).eq("id", c.id);
          if (c.publicado !== pub) { if (pub) out.mostradas++; else out.ocultadas++; if (pub && c.variante_id && !simular) await admin.rpc("encolar_canal", { e, v: c.variante_id }); }
        }
        // fotos, por producto de Percha
        const porProd = new Map<string, any[]>(); suyos.forEach((c) => { const v = vinfo.get(c.variante_id); if (!v) return; if (!porProd.has(v.producto_id)) porProd.set(v.producto_id, []); porProd.get(v.producto_id)!.push({ c, v }); });
        const varPorExt = new Map((pr.variants || []).map((x: any) => [String(x.id), x]));
        for (const [pid, lista] of porProd) {
          const colores = new Set(lista.map((x: any) => x.v.color_id).filter(Boolean));
          const sola = (pubsDe.get(pid)?.size || 1) <= 1;
          const deseadas: { color_id: string | null; url: string; orden: number }[] = [];
          for (const im of (pr.images || []).sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))) {
            // de qué color es: el de las variantes que la usan; si la publicación es de un solo color, ese; si no, general
            const usan = new Set(lista.filter((x: any) => String((varPorExt.get(String(x.c.variante_ext)) as any)?.image_id) === String(im.id)).map((x: any) => x.v.color_id).filter(Boolean));
            const color = usan.size === 1 ? [...usan][0] as string : colores.size === 1 ? [...colores][0] as string : null;
            if (!deseadas.some((d) => d.url === im.src && d.color_id === color)) deseadas.push({ color_id: color, url: im.src, orden: 100 + (im.position ?? deseadas.length) });
          }
          // las de la web que había de esta publicación (las cargadas a mano en Percha no se tocan)
          const actuales = (fotosDe.get(pid) || []).filter((f: any) => f.origen === "tiendanube" && (sola || (f.color_id && colores.has(f.color_id))));
          const nuevas = deseadas.filter((d) => !actuales.some((f: any) => f.url === d.url && (f.color_id || null) === d.color_id));
          const quitar = actuales.filter((f: any) => !deseadas.some((d) => d.url === f.url && d.color_id === (f.color_id || null)));
          if (!nuevas.length && !quitar.length) continue;
          out.fotos_nuevas += nuevas.length; out.fotos_quitadas += quitar.length; out.cambios.push({ producto_id: pid, publicacion: String(pr.id), nuevas: nuevas.length, quitadas: quitar.length });
          if (simular) continue;
          const emp = (imagenDe.get(pid) as any)?.empresa_id || e;
          if (nuevas.length) await admin.from("producto_fotos").upsert(nuevas.map((d) => ({ empresa_id: emp, producto_id: pid, color_id: d.color_id, url: d.url, orden: d.orden, origen: "tiendanube" })), { onConflict: "producto_id,color_id,url", ignoreDuplicates: true });
          if (quitar.length) await admin.from("producto_fotos").delete().in("id", quitar.map((f: any) => f.id));
          const pp: any = imagenDe.get(pid); if (pp && !pp.imagen_url && deseadas[0]) { await admin.from("productos").update({ imagen_url: deseadas[0].url }).eq("id", pid); pp.imagen_url = deseadas[0].url; }
        }
      }
      return out;
    }
    resumen.push(res);
  }
  return json({ ok: true, simular, resumen });
});
