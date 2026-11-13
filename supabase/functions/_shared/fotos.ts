// FOTOS: Tienda Nube manda (13/11/2026, Diego: «las imágenes las manejamos en Tienda Nube; lo que se suba allí tiene que
// sincronizar con Percha, todas, y mantenerse actualizado»).
// Cada foto de la web queda en Percha atada a SU imagen (producto_fotos.imagen_ext + producto_ext): se agrega, se borra,
// se reordena y se reemplaza igual que en la web. Las fotos de Percha que ya se subieron a la web pasan a ser fotos de la
// web (la de Percha se retira: nunca dos de la misma). Las fotos que solo están en Percha (prenda que no está en la web)
// no se tocan. El color: el de las opciones que usan esa foto; si la publicación es de un solo color, ese; si no, el que
// ya tenía (o el que se eligió a mano en Percha: color_fijo).
// completo = true: la lectura trajo TODAS las publicaciones (tn-sincronizar): además se limpian las fotos de
// publicaciones que ya no son de la prenda y las viejas sin número de imagen.
import { archivoBase, porPosicion } from "./tn.ts";

export async function fotosDesdeLaWeb(admin: any, cx: any, prods: any[], op: { simular?: boolean; completo?: boolean; visibilidad?: boolean } = {}) {
  const simular = !!op.simular, completo = !!op.completo;
  const out = { revisadas: prods.length, nuevas: 0, cambiadas: 0, quitadas: 0, de_percha_pasadas: 0, portadas: 0, mostradas: 0, ocultadas: 0, cambios: [] as any[] };
  if (!prods.length) return out;
  // la base devuelve de a 1000 filas como máximo: todo se lee por páginas (si no, faltaban fotos y se querían crear de nuevo)
  const todas = async (q: () => any) => { let r: any[] = []; for (let d = 0; ; d += 1000) { const { data, error } = await q().range(d, d + 999); if (error) throw new Error(error.message); r = r.concat(data || []); if (!data || data.length < 1000) break; } return r; };
  const prodPorId = new Map(prods.map((p: any) => [String(p.id), p]));
  const enLote = new Set(prodPorId.keys());
  const pes = [...enLote];
  const items: any[] = [];
  for (let i = 0; i < pes.length; i += 150) items.push(...await todas(() => admin.from("canal_items").select("id,empresa_id,producto_ext,variante_ext,variante_id,publicado,imagen").eq("conexion_id", cx.id).in("producto_ext", pes.slice(i, i + 150)).order("id")));

  // visible / oculto e imagen de la publicación (al mostrarla, recibe el stock de Percha). La lectura completa ya lo hace.
  if (op.visibilidad !== false) for (const c of items) {
    const pr: any = prodPorId.get(String(c.producto_ext)); if (!pr) continue;
    const pub = pr.published !== false, img0 = porPosicion(pr.images)[0]?.src || null;
    if (c.publicado === pub && (c.imagen || null) === img0) continue;
    if (!simular) await admin.from("canal_items").update({ publicado: pub, imagen: img0, actualizado: new Date().toISOString() }).eq("id", c.id);
    if (c.publicado !== pub) { if (pub) out.mostradas++; else out.ocultadas++; if (pub && c.variante_id && !simular) await admin.rpc("encolar_canal", { e: c.empresa_id, v: c.variante_id }); }
  }

  const vids = [...new Set(items.filter((c) => c.variante_id).map((c) => c.variante_id))];
  const vinfo = new Map<string, any>();
  for (let i = 0; i < vids.length; i += 300) { const { data } = await admin.from("variantes").select("id,producto_id,color_id").in("id", vids.slice(i, i + 300)); (data || []).forEach((v: any) => vinfo.set(v.id, v)); }
  const pids = [...new Set([...vinfo.values()].map((v: any) => v.producto_id))];
  // todas las publicaciones de cada prenda (no solo las de este lote)
  const pubsDe = new Map<string, Set<string>>();
  for (let i = 0; i < pids.length; i += 100) {
    const data = await todas(() => admin.from("canal_items").select("id,producto_ext,variantes!inner(producto_id)").eq("conexion_id", cx.id).in("variantes.producto_id", pids.slice(i, i + 100)).order("id"));
    data.forEach((c: any) => { const pid = c.variantes?.producto_id; if (!pid) return; if (!pubsDe.has(pid)) pubsDe.set(pid, new Set()); pubsDe.get(pid)!.add(String(c.producto_ext)); });
  }
  const fotosDe = new Map<string, any[]>();
  for (let i = 0; i < pids.length; i += 100) { const data = await todas(() => admin.from("producto_fotos").select("id,empresa_id,producto_id,color_id,url,orden,origen,web,imagen_ext,producto_ext,conexion_id,color_fijo,borrar_web").in("producto_id", pids.slice(i, i + 100)).order("id")); data.forEach((f: any) => { if (!fotosDe.has(f.producto_id)) fotosDe.set(f.producto_id, []); fotosDe.get(f.producto_id)!.push(f); }); }
  const prodsP = new Map<string, any>();
  for (let i = 0; i < pids.length; i += 200) { const { data } = await admin.from("productos").select("id,empresa_id,imagen_url,es_generico").in("id", pids.slice(i, i + 200)); (data || []).forEach((p: any) => prodsP.set(p.id, p)); }

  const guardar: any[] = [], borrar: string[] = [], portadas: { id: string; url: string | null }[] = [];
  for (const pid of pids) {
    if (prodsP.get(pid)?.es_generico) continue;   // BOMBIS «VARIAS» y otros códigos generales: cruzan cientos de publicaciones, no juntan sus fotos
    const filas = fotosDe.get(pid) || [], emp = prodsP.get(pid)?.empresa_id || cx.empresa_id;
    const todas = pubsDe.get(pid) || new Set<string>();
    // las publicaciones de esta prenda que vinieron en el lote; las visibles primero y por número (siempre el mismo orden:
    // si la misma foto está en dos publicaciones, queda siempre la misma)
    const suyas = [...new Set(items.filter((c) => vinfo.get(c.variante_id)?.producto_id === pid).map((c) => String(c.producto_ext)))]
      .sort((a, b) => ((prodPorId.get(b) as any)?.published !== false ? 1 : 0) - ((prodPorId.get(a) as any)?.published !== false ? 1 : 0) || +a - +b);
    const todasEnLote = [...todas].every((pe) => enLote.has(pe));
    // fotos de Percha ya subidas: {publicación: imagen}. Se pasan a «de la web» cuando se sabe qué pasó en TODAS sus publicaciones
    const manuales = filas.filter((f) => f.origen === "manual" && f.web && Object.keys(f.web).length && !f.borrar_web);
    const manualDe = new Map<string, any>();
    const resuelta = (m: any) => Object.entries(m.web).every(([pe, id]) => id === "borrada" || enLote.has(pe) || !todas.has(pe));
    manuales.forEach((m) => Object.entries(m.web).forEach(([, id]) => manualDe.set(String(id), m)));
    const usadas = new Set<string>(), vistos = new Set<string>();
    // lo de otras publicaciones de la prenda que no vinieron en el lote queda como está
    for (const f of filas) if (f.origen === "tiendanube" && f.producto_ext && !enLote.has(f.producto_ext) && todas.has(f.producto_ext)) { usadas.add(f.id); vistos.add(archivoBase(f.url) + "|" + (f.color_id || "")); }
    const finales: any[] = [];
    for (const pe of suyas) {
      const pr: any = prodPorId.get(pe);
      const mias = items.filter((c) => String(c.producto_ext) === pe && vinfo.get(c.variante_id)?.producto_id === pid);
      const colores = new Set(mias.map((c) => vinfo.get(c.variante_id)?.color_id).filter(Boolean));
      const varPorExt = new Map((pr.variants || []).map((x: any) => [String(x.id), x]));
      porPosicion(pr.images).forEach((im: any, i: number) => {
        const imgId = String(im.id);
        let r = filas.find((f) => f.imagen_ext === imgId && f.origen === "tiendanube");
        if (r?.borrar_web) { usadas.add(r.id); return; }   // se está borrando desde Percha
        const man = manualDe.get(imgId);
        if (man && !resuelta(man)) return;                  // subida desde Percha a varias publicaciones: falta saber de las otras
        if (!r) r = filas.find((f) => !usadas.has(f.id) && f.origen === "tiendanube" && !f.imagen_ext && f.url === im.src)   // de antes, sin número
          || filas.find((f) => !usadas.has(f.id) && !f.borrar_web && f.url === im.src && !(f.origen === "manual" && f.web && Object.keys(f.web).length));   // misma dirección
        const usan = new Set(mias.filter((c) => String((varPorExt.get(String(c.variante_ext)) as any)?.image_id) === imgId).map((c) => vinfo.get(c.variante_id)?.color_id).filter(Boolean));
        const derivado = usan.size === 1 ? [...usan][0] : colores.size === 1 ? [...colores][0] : undefined;
        const fijo = !!(r?.color_fijo || (man && man.color_id));
        const color = r?.color_fijo ? r.color_id : man && man.color_id ? man.color_id : derivado !== undefined ? derivado : (r ? r.color_id : null);
        const clave = archivoBase(im.src) + "|" + (color || "");
        if (vistos.has(clave)) return;   // la misma foto en otra publicación de la prenda: una sola en Percha
        vistos.add(clave); if (r) usadas.add(r.id);
        finales.push({ id: r?.id || crypto.randomUUID(), empresa_id: emp, producto_id: pid, color_id: color || null, url: im.src, orden: im.position ?? i + 1, origen: "tiendanube",
          imagen_ext: imgId, producto_ext: pe, conexion_id: cx.id, color_fijo: fijo, borrar_web: false, web: null, _antes: r || null });
      });
    }
    // lo que se va: fotos de la web que ya no están en su publicación, las de publicaciones que ya no son de la prenda,
    // las viejas sin número que no aparecieron, y las de Percha que ya pasaron a ser de la web
    const seVan = filas.filter((f) => !usadas.has(f.id) && (
      (f.origen === "tiendanube" && f.producto_ext && enLote.has(f.producto_ext)) ||
      (f.origen === "tiendanube" && !f.producto_ext && todasEnLote && suyas.length > 0) ||
      (f.origen === "tiendanube" && f.producto_ext && !todas.has(f.producto_ext) && completo) ||
      (f.origen === "manual" && manuales.includes(f) && resuelta(f))));
    for (const f of seVan) { borrar.push(f.id); if (f.origen === "manual") out.de_percha_pasadas++; else out.quitadas++; }
    const cambiadas = finales.filter((x) => { const a = x._antes; return !a || a.color_id !== x.color_id || a.url !== x.url || a.orden !== x.orden || a.origen !== x.origen || a.imagen_ext !== x.imagen_ext || a.producto_ext !== x.producto_ext || a.conexion_id !== x.conexion_id || !!a.color_fijo !== x.color_fijo; });
    const nuevas = cambiadas.filter((x) => !x._antes).length;
    out.nuevas += nuevas; out.cambiadas += cambiadas.length - nuevas;
    if (cambiadas.length || seVan.length) out.cambios.push({ producto_id: pid, nuevas, cambiadas: cambiadas.length - nuevas, quitadas: seVan.length });
    guardar.push(...cambiadas);
    // portada: si no tiene, o la que tenía ya no está, la primera general (o la primera) de la web
    const pp = prodsP.get(pid);
    const quedan = new Set([...filas.filter((f) => !seVan.includes(f) && !f.borrar_web).map((f) => f.url), ...finales.map((x) => x.url)]);
    if (pp && (!pp.imagen_url || !quedan.has(pp.imagen_url)) && (finales.length || !pp.imagen_url)) {
      const orden = (a: any, b: any) => a.orden - b.orden;
      const nueva = finales.filter((x) => !x.color_id).sort(orden)[0]?.url || finales.slice().sort(orden)[0]?.url || [...quedan][0] || null;
      if (nueva !== pp.imagen_url) { portadas.push({ id: pid, url: nueva }); out.portadas++; }
    }
  }
  if (simular) return out;
  for (let i = 0; i < borrar.length; i += 200) await admin.from("producto_fotos").delete().in("id", borrar.slice(i, i + 200));
  const filasGuardar = guardar.map(({ _antes, ...x }) => x);
  const errores: string[] = [];
  for (let i = 0; i < filasGuardar.length; i += 400) {
    const tanda = filasGuardar.slice(i, i + 400);
    const { error } = await admin.from("producto_fotos").upsert(tanda, { onConflict: "id" });
    if (!error) continue;
    // una fila que choca (misma foto y color repetidos de antes) no frena a las demás
    for (const x of tanda) { const { error: e1 } = await admin.from("producto_fotos").upsert(x, { onConflict: "id" }); if (e1 && errores.length < 10) errores.push(e1.message.slice(0, 120)); }
  }
  if (errores.length) (out as any).errores = errores;
  for (const p of portadas) await admin.from("productos").update({ imagen_url: p.url }).eq("id", p.id);
  return out;
}
