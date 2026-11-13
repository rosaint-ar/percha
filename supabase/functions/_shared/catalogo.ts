// Leer el catálogo de Tienda Nube y cruzarlo con Percha (13/11/2026: una sola lógica para el botón «Sincronizar» de
// Conexiones —tn-sync— y la lectura automática cada 30 min —tn-sincronizar—; antes eran dos copias y el botón usaba la vieja).
// Cruce: el SKU/MPN de Tienda Nube es el código del producto en Percha; dentro del producto, el talle y el color se
// emparejan por nombre (sin acentos, mayúsculas ni signos). Lo que no cruza queda marcado para resolver a mano.
// También: categorías de la web (sql/144) y las FOTOS de todas las publicaciones (la web manda, _shared/fotos.ts).
import { clienteTN, es, norm, talleClave, primeraImagen } from "./tn.ts";
import { fotosDesdeLaWeb } from "./fotos.ts";

export async function sincronizarCatalogo(admin: any, cx: any, token: string): Promise<any> {
  // ---- catálogo de Percha para cruzar ----
  const e = cx.empresa_id;
  const pag = async (tabla: string, sel: string, filtro: (q: any) => any) => { let desde = 0, todo: any[] = []; while (true) { const { data, error } = await filtro(admin.from(tabla).select(sel)).range(desde, desde + 999); if (error) throw error; todo = todo.concat(data || []); if (!data || data.length < 1000) break; desde += 1000; } return todo; };
  const productos = await pag("productos", "id,codigo,nombre,tiene_variantes,es_generico,activo", (q: any) => q.eq("empresa_id", e));
  // los modelos por nombre: para no cruzar con un código general (BOMBIS «VARIAS», MEDIAS VARIAS) lo que ya existe como modelo
  const porNombre = new Map(productos.filter((p: any) => !p.es_generico && p.activo).map((p: any) => [norm(p.nombre), p]));
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
  // Un BOX/COMBO/PACK del canal nunca se cruza solo con un producto suelto de Percha (comparten SKU pero no son lo mismo)
  const esCombo = (nombre: string) => /\b(box|combo|pack|kit|set)\b/i.test(nombre || "");
  // (el nombre NO se compara: en el canal los nombres son comerciales y cambian; manda el SKU, y lo que no corresponda se corrige a mano)
  const nombresProd = new Map(productos.map((p: any) => [p.id, p.nombre]));

  // ---- traer todo el catálogo del canal ----
  const { headers, base } = clienteTN(cx.externo_id, token);
  const crudos: any[] = [];   // lo leído de la web (para las fotos)
  const items: any[] = []; let page = 1, totalCanal = 0;
  const catsDe = new Map<string, { pub: boolean; ids: number[] }>();   // categorías de cada publicación (sql/144)
  while (page <= 50) {
    const r = await fetch(`${base}/products?per_page=200&page=${page}&fields=id,name,handle,published,attributes,variants,images,canonical_url,categories`, { headers });
    if (r.status === 404) break;
    // solo un acceso rechazado apaga la conexión; un error pasajero (429, 5xx) no frena el stock, los pedidos ni los precios
    if (!r.ok) { const t = await r.text(); await admin.from("conexiones").update({ ultimo_error: `Tienda Nube ${r.status}: ${t.slice(0, 200)}`, ...(r.status === 401 || r.status === 403 ? { estado: "error" } : {}) }).eq("id", cx.id); return { error: `Tienda Nube respondió ${r.status}`, status: 502 }; }
    const prods = await r.json(); if (!Array.isArray(prods) || !prods.length) break;
    totalCanal += prods.length; crudos.push(...prods.map((p: any) => ({ id: p.id, published: p.published, images: p.images, variants: (p.variants || []).map((v: any) => ({ id: v.id, image_id: v.image_id })) })));
    for (const p of prods) {
      catsDe.set(String(p.id), { pub: !!p.published, ids: (p.categories || []).map((c: any) => Number(c.id)) });
      const attrs: string[] = (p.attributes || []).map((a: any) => es(a));
      const img = primeraImagen(p);   // la primera según el orden de la web
      const prodPercha = porCodigo.get(norm((p.variants?.[0]?.sku || p.variants?.[0]?.mpn || "")));
      for (const v of p.variants || []) {
        const vals: string[] = (v.values || []).map((x: any) => es(x));
        const valoresPorAttr: Record<string, string> = {}; attrs.forEach((a, i) => { valoresPorAttr[norm(a)] = vals[i] || ""; });
        const talleTN = valoresPorAttr["talle"] ?? valoresPorAttr["talla"] ?? valoresPorAttr["tamano"] ?? "";
        const colorTN = valoresPorAttr["color"] ?? valoresPorAttr["estampa"] ?? "";
        // cruce
        let variante_id: string | null = null, cruce = "ninguno";
        const codigoV = norm(v.sku || v.mpn || "");
        let prodV = porCodigo.get(codigoV) || prodPercha;
        // el SKU es el de un código general (Emi carga muchos modelos con el mismo código): si el modelo existe en Percha
        // con el mismo nombre, se cruza con el modelo; si no, queda en el código general (y al venderse pide elegir el modelo)
        if (prodV && prodV.es_generico) prodV = porNombre.get(norm(es(p.name))) || prodV;
        if (prodV && esCombo(es(p.name)) !== esCombo(nombresProd.get(prodV.id) || "")) prodV = null;
        if (v.barcode && porEan.has(norm(v.barcode))) { variante_id = porEan.get(norm(v.barcode)).id; cruce = "barcode"; }
        else if (prodV) {
          const vs = varsPorProducto.get(prodV.id) || [];
          if (vs.length === 1 && !vs[0].talle_id && !vs[0].color_id) { variante_id = vs[0].id; cruce = "sku"; }
          else {
            // en Tienda Nube el color suele ir en el nombre del producto ("CONJUNTO «ALEXA» LAVANDA"), no en la variante
            const colorBuscado = colorTN || colorDelNombre(es(p.name));
            const puntuados = vs.map((x: any) => {
              const t = x.talle_id ? attr.get(x.talle_id) : null, c = x.color_id ? attr.get(x.color_id) : null;
              // «Único» solo = sin talle; «Único (S al 2XL)» es un talle (antes «Único…» nunca cruzaba solo)
              const pt = talleClave(talleTN) ? (t && talleClave(t.nombre) === talleClave(talleTN) ? 3 : puntaje(t, talleTN)) : (!t || !talleClave(t.nombre) ? 3 : 0);   // «Único» en la web = sin talle o el talle «Único» de Percha
              const pc = colorBuscado ? puntaje(c, colorBuscado) : (c ? 0 : 3);
              return { x, p: pt && pc ? pt + pc : 0 };
            }).filter((s) => s.p > 0).sort((a, b) => b.p - a.p);
            if (puntuados.length && (puntuados.length === 1 || puntuados[0].p > puntuados[1].p)) { variante_id = puntuados[0].x.id; cruce = "sku"; }
          }
        }
        items.push({ empresa_id: e, conexion_id: cx.id, producto_ext: String(p.id), variante_ext: String(v.id), nombre: es(p.name), valores: vals.join(" / "), sku: v.sku || null, barcode: v.barcode || null, mpn: v.mpn || null,
          talle_canal: talleTN || null, color_canal: colorTN || colorDelNombre(es(p.name)) || null,
          precio: v.price != null ? +v.price : null, precio_promo: v.promotional_price != null ? +v.promotional_price : null, stock: v.stock_management === false ? null : (v.stock != null ? +v.stock : null),
          publicado: !!p.published, url: p.canonical_url || null, imagen: img, variante_id, cruce, actualizado: new Date().toISOString() });
      }
    }
    if (prods.length < 200) break; page++;
  }
  // los cruces manuales previos se respetan
  const inicioSync = new Date(Date.now() - 60000).toISOString();
  const manuales = await pag("canal_items", "variante_ext,variante_id", (q: any) => q.eq("conexion_id", cx.id).eq("cruce", "manual"));   // de a 1000 (eran más de 1000)
  const man = new Map((manuales || []).map((m: any) => [m.variante_ext, m.variante_id]));
  items.forEach((it) => { if (man.has(it.variante_ext)) { it.variante_id = man.get(it.variante_ext); it.cruce = "manual"; } });
  // las que estaban ocultas y ahora se ven: que reciban el stock de Percha (antes se perdía si esta lectura llegaba primero)
  const antes = await pag("canal_items", "variante_ext,publicado", (q: any) => q.eq("conexion_id", cx.id).eq("publicado", false));
  const ocultasAntes = new Set(antes.map((a: any) => String(a.variante_ext)));
  const aMostrar = items.filter((it) => it.publicado && it.variante_id && ocultasAntes.has(String(it.variante_ext)));
  // guardar en tandas
  for (let i = 0; i < items.length; i += 500) {
    const { error } = await admin.from("canal_items").upsert(items.slice(i, i + 500), { onConflict: "conexion_id,variante_ext" });
    if (error) return { error: "No se pudo guardar: " + error.message, status: 500 };
  }
  // borrar lo que ya no está en el canal
  const vivos = items.map((i) => i.variante_ext);
  // todas (no solo las primeras 1000) y solo las que no se tocaron durante esta lectura (las recién publicadas no se borran)
  if (vivos.length) { const setVivos = new Set(vivos); const todos = await pag("canal_items", "id,variante_ext,actualizado", (q: any) => q.eq("conexion_id", cx.id).order("id")); const muertos = todos.filter((t: any) => !setVivos.has(t.variante_ext) && (!t.actualizado || t.actualizado < inicioSync)).map((t: any) => t.id); for (let i = 0; i < muertos.length; i += 300) await admin.from("canal_items").delete().in("id", muertos.slice(i, i + 300)); }
  // ---- categorías de la web (sql/144): el árbol de la tienda y las de cada prenda ----
  let categorias_actualizadas = 0;
  try {
    const arbol: any[] = [];
    for (let pg = 1; pg <= 5; pg++) { const r = await fetch(`${base}/categories?fields=id,name,parent&per_page=200&page=${pg}`, { headers }); if (!r.ok) break; const l = await r.json(); if (!Array.isArray(l) || !l.length) break; arbol.push(...l); if (l.length < 200) break; }
    if (arbol.length) {
      const porId = new Map(arbol.map((c: any) => [Number(c.id), c]));
      const ruta = (c: any): string => { const p = c.parent ? porId.get(Number(c.parent)) : null; return (p ? ruta(p) + " › " : "") + es(c.name).trim(); };
      await admin.from("canal_categorias").upsert(arbol.map((c: any, i: number) => ({ conexion_id: cx.id, empresa_id: e, ext_id: Number(c.id), nombre: es(c.name).trim(), padre: c.parent ? Number(c.parent) : null, orden: i, ruta: ruta(c), actualizado: new Date().toISOString() })), { onConflict: "conexion_id,ext_id" });
      const ids = arbol.map((c: any) => Number(c.id));
      await admin.from("canal_categorias").delete().eq("conexion_id", cx.id).not("ext_id", "in", `(${ids.join(",")})`);
      // «Nuevos Ingresos» la maneja Percha sola (30 días): no es una categoría de la prenda
      const nuevos = new Set(arbol.filter((c: any) => /nuevos ingresos/i.test(es(c.name))).map((c: any) => Number(c.id)));
      const prodDeVar = new Map(variantes.map((v: any) => [v.id, v.producto_id]));
      const genericos = new Set(productos.filter((p: any) => p.es_generico).map((p: any) => p.id));
      const pubsDe = new Map<string, Set<string>>();
      items.forEach((it) => { const pid = it.variante_id && prodDeVar.get(it.variante_id); if (!pid || genericos.has(pid)) return; if (!pubsDe.has(pid)) pubsDe.set(pid, new Set()); pubsDe.get(pid)!.add(it.producto_ext); });
      const lote: any[] = [];
      for (const [pid, pes] of pubsDe) {
        const info = [...pes].map((pe) => catsDe.get(pe)).filter(Boolean) as { pub: boolean; ids: number[] }[];
        const usar = info.some((x) => x.pub) ? info.filter((x) => x.pub) : info;   // las visibles mandan (las ocultas viejas no)
        const cats = [...new Set(usar.flatMap((x) => x.ids).filter((id) => !nuevos.has(id)))].sort((a, b) => a - b);
        lote.push({ producto_id: pid, cats });
      }
      for (let i = 0; i < lote.length; i += 300) { const { data } = await admin.rpc("canal_categorias_a_percha", { p: lote.slice(i, i + 300) }); categorias_actualizadas += Number(data) || 0; }
    }
  } catch (_) { /* las categorías no frenan la sincronización */ }
  for (const it of aMostrar) await admin.rpc("encolar_canal", { e, v: it.variante_id });
  // ---- fotos: la web manda (todas las publicaciones: también limpia lo que ya no corresponde) ----
  let fotos: any = null;
  try { fotos = await fotosDesdeLaWeb(admin, cx, crudos, { completo: true, visibilidad: false }); await admin.from("conexiones").update({ ultima_sync_fotos: new Date().toISOString() }).eq("id", cx.id); }
  catch (err) { fotos = { error: String((err as Error)?.message || err).slice(0, 200) }; }
  await admin.from("conexiones").update({ ultima_sync: new Date().toISOString(), ultimo_error: null, estado: "activa" }).eq("id", cx.id);
  const cruzados = items.filter((i) => i.variante_id).length;
  return { ok: true, productos: totalCanal, variantes: items.length, cruzados, sin_cruzar: items.length - cruzados, mostradas: aMostrar.length, categorias_actualizadas, fotos };
}
