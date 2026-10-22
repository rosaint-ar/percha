// tn-sync · trae el catálogo de Tienda Nube de una conexión y lo cruza con las variantes de Percha.
// POST { conexion_id }  (sesión de un admin de la empresa)
// Cruce: el SKU/MPN de Tienda Nube es el código del producto en Percha; dentro del producto, el talle y el color
// se emparejan por nombre (sin acentos, mayúsculas ni signos). Lo que no cruza queda marcado para resolver a mano.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UA = "Percha (rosaint.ar@gmail.com)";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const es = (v: unknown) => (v && typeof v === "object" ? ((v as Record<string, string>).es ?? Object.values(v as Record<string, string>)[0] ?? "") : String(v ?? ""));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Usá POST" }, 405);
  const auth = req.headers.get("Authorization") || "";
  const comoUsuario = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await comoUsuario.auth.getUser();
  if (!user) return json({ error: "Sesión inválida" }, 401);
  let body: { conexion_id?: string }; try { body = await req.json(); } catch { body = {}; }
  if (!body.conexion_id) return json({ error: "Falta conexion_id" }, 400);

  const admin = createClient(URL, SERVICE);
  const { data: cx } = await admin.from("conexiones").select("*").eq("id", body.conexion_id).maybeSingle();
  if (!cx) return json({ error: "Conexión inexistente" }, 404);
  const { data: esAdmin } = await comoUsuario.rpc("es_admin", { e: cx.empresa_id });
  if (!esAdmin) return json({ error: "No administrás esta empresa" }, 403);
  if (cx.canal !== "tiendanube") return json({ error: "Por ahora solo Tienda Nube" }, 400);
  const { data: sec } = await admin.from("conexion_secretos").select("access_token").eq("conexion_id", cx.id).maybeSingle();
  if (!sec) return json({ error: "La conexión no tiene token: volvé a conectar" }, 400);

  // ---- catálogo de Percha para cruzar ----
  const e = cx.empresa_id;
  const pag = async (tabla: string, sel: string, filtro: (q: any) => any) => { let desde = 0, todo: any[] = []; while (true) { const { data, error } = await filtro(admin.from(tabla).select(sel)).range(desde, desde + 999); if (error) throw error; todo = todo.concat(data || []); if (!data || data.length < 1000) break; desde += 1000; } return todo; };
  const productos = await pag("productos", "id,codigo,tiene_variantes", (q: any) => q.eq("empresa_id", e));
  const variantes = await pag("variantes", "id,producto_id,sku,ean,talle_id,color_id", (q: any) => q.eq("empresa_id", e).eq("activa", true));
  const atributos = await pag("atributos", "id,tipo,codigo,nombre", (q: any) => q.eq("empresa_id", e));
  const porCodigo = new Map(productos.map((p: any) => [norm(p.codigo), p]));
  const attr = new Map(atributos.map((a: any) => [a.id, a]));
  const varsPorProducto = new Map<string, any[]>(); variantes.forEach((v: any) => { const l = varsPorProducto.get(v.producto_id) || []; l.push(v); varsPorProducto.set(v.producto_id, l); });
  const porEan = new Map(variantes.filter((v: any) => v.ean).map((v: any) => [norm(v.ean), v]));
  // puntaje de coincidencia entre un valor del canal y un atributo de Percha: exacto > exacto por código > contiene
  const puntaje = (a: any, valor: string) => {
    if (!a) return 0; const v = norm(valor); if (!v) return 0;
    const n = norm(a.nombre), c = norm(a.codigo);
    if (n === v || c === v) return 3;
    const sinParen = norm(String(valor).replace(/\(.*?\)/g, "")); if (sinParen && (n === sinParen || c === sinParen)) return 2;
    if (n.length >= 2 && (n.includes(v) || v.includes(n))) return 1;
    return 0;
  };
  const colorDelNombre = (nombre: string) => { const m = /»\s*(.+)$/.exec(nombre || ""); return m ? m[1].trim() : ""; };

  // ---- traer todo el catálogo del canal ----
  const headers = { Authentication: `bearer ${sec.access_token}`, "User-Agent": UA, "Content-Type": "application/json" };
  const base = `https://api.tiendanube.com/2025-03/${cx.externo_id}`;
  const items: any[] = []; let page = 1, totalCanal = 0;
  while (page <= 50) {
    const r = await fetch(`${base}/products?per_page=200&page=${page}&fields=id,name,handle,published,attributes,variants,images,canonical_url`, { headers });
    if (r.status === 404) break;
    if (!r.ok) { const t = await r.text(); await admin.from("conexiones").update({ ultimo_error: `Tienda Nube ${r.status}: ${t.slice(0, 200)}`, estado: "error" }).eq("id", cx.id); return json({ error: `Tienda Nube respondió ${r.status}` }, 502); }
    const prods = await r.json(); if (!Array.isArray(prods) || !prods.length) break;
    totalCanal += prods.length;
    for (const p of prods) {
      const attrs: string[] = (p.attributes || []).map((a: any) => es(a));
      const img = (p.images || [])[0]?.src ?? null;
      const prodPercha = porCodigo.get(norm((p.variants?.[0]?.sku || p.variants?.[0]?.mpn || "")));
      for (const v of p.variants || []) {
        const vals: string[] = (v.values || []).map((x: any) => es(x));
        const valoresPorAttr: Record<string, string> = {}; attrs.forEach((a, i) => { valoresPorAttr[norm(a)] = vals[i] || ""; });
        const talleTN = valoresPorAttr["talle"] ?? valoresPorAttr["talla"] ?? valoresPorAttr["tamano"] ?? "";
        const colorTN = valoresPorAttr["color"] ?? valoresPorAttr["estampa"] ?? "";
        // cruce
        let variante_id: string | null = null, cruce = "ninguno";
        const codigoV = norm(v.sku || v.mpn || "");
        const prodV = porCodigo.get(codigoV) || prodPercha;
        if (v.barcode && porEan.has(norm(v.barcode))) { variante_id = porEan.get(norm(v.barcode)).id; cruce = "barcode"; }
        else if (prodV) {
          const vs = varsPorProducto.get(prodV.id) || [];
          if (vs.length === 1 && !vs[0].talle_id && !vs[0].color_id) { variante_id = vs[0].id; cruce = "sku"; }
          else {
            // en Tienda Nube el color suele ir en el nombre del producto ("CONJUNTO «ALEXA» LAVANDA"), no en la variante
            const colorBuscado = colorTN || colorDelNombre(es(p.name));
            const puntuados = vs.map((x: any) => {
              const t = x.talle_id ? attr.get(x.talle_id) : null, c = x.color_id ? attr.get(x.color_id) : null;
              const pt = talleTN ? puntaje(t, talleTN) : (t ? 0 : 3);
              const pc = colorBuscado ? puntaje(c, colorBuscado) : (c ? 0 : 3);
              return { x, p: pt && pc ? pt + pc : 0 };
            }).filter((s) => s.p > 0).sort((a, b) => b.p - a.p);
            if (puntuados.length && (puntuados.length === 1 || puntuados[0].p > puntuados[1].p)) { variante_id = puntuados[0].x.id; cruce = "sku"; }
          }
        }
        items.push({ empresa_id: e, conexion_id: cx.id, producto_ext: String(p.id), variante_ext: String(v.id), nombre: es(p.name), valores: vals.join(" / "), sku: v.sku || null, barcode: v.barcode || null, mpn: v.mpn || null,
          precio: v.price != null ? +v.price : null, precio_promo: v.promotional_price != null ? +v.promotional_price : null, stock: v.stock_management === false ? null : (v.stock != null ? +v.stock : null),
          publicado: !!p.published, url: p.canonical_url || null, imagen: img, variante_id, cruce, actualizado: new Date().toISOString() });
      }
    }
    if (prods.length < 200) break; page++;
  }
  // los cruces manuales previos se respetan
  const { data: manuales } = await admin.from("canal_items").select("variante_ext,variante_id").eq("conexion_id", cx.id).eq("cruce", "manual");
  const man = new Map((manuales || []).map((m: any) => [m.variante_ext, m.variante_id]));
  items.forEach((it) => { if (man.has(it.variante_ext)) { it.variante_id = man.get(it.variante_ext); it.cruce = "manual"; } });
  // guardar en tandas
  for (let i = 0; i < items.length; i += 500) {
    const { error } = await admin.from("canal_items").upsert(items.slice(i, i + 500), { onConflict: "conexion_id,variante_ext" });
    if (error) return json({ error: "No se pudo guardar: " + error.message }, 500);
  }
  // borrar lo que ya no está en el canal
  const vivos = items.map((i) => i.variante_ext);
  if (vivos.length) { const { data: todos } = await admin.from("canal_items").select("id,variante_ext").eq("conexion_id", cx.id); const muertos = (todos || []).filter((t: any) => !vivos.includes(t.variante_ext)).map((t: any) => t.id); if (muertos.length) await admin.from("canal_items").delete().in("id", muertos); }
  await admin.from("conexiones").update({ ultima_sync: new Date().toISOString(), ultimo_error: null, estado: "activa" }).eq("id", cx.id);
  const cruzados = items.filter((i) => i.variante_id).length;
  return json({ ok: true, productos: totalCanal, variantes: items.length, cruzados, sin_cruzar: items.length - cruzados });
});
