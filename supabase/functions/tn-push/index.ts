// tn-push · empuja a Tienda Nube el stock de Percha de lo que quedó en la cola (canal_cola).
// Lo llama el navegador después de vender/ajustar (fire-and-forget) y el cron cada minuto.
// Auth: sesión de un miembro de la empresa  o  header x-cron-key = secreto CRON_KEY.
// Kits (box/pack): cada variante del box en TN (L / Celeste) recibe el stock del componente en ese talle/color
//   = mín( stock de cada componente resuelto por talle/color ÷ cantidad ); los filtros cuentan todo lo que cumple el filtro.
// Prendas con falla (variantes.fallas): son solo del local, no se mandan a la web (stock web = stock − fallas).
// Sin doble descuento: Tienda Nube descuenta solo cuando entra un pedido. Mientras ese pedido no esté en Percha
//   (sin pagar, o pagado pero todavía no importado), sus unidades se restan de lo que se manda; si no, el envío
//   le devolvería a la web la unidad que ya descontó. Cuando el pedido entra a Percha, Percha ya lo descontó y no se resta más.
// body.solo_productos = ["500123", …]: empuja solo esos productos (y sus kits), aunque la conexión tenga el empuje apagado.
// body.simular = true: no escribe nada; compara con el stock que tiene hoy la web. Con body.todo = true revisa todo lo cruzado.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const SB_URL = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, CRON_KEY = Deno.env.get("CRON_KEY") || "";
const UA = "Percha (rosaint.ar@gmail.com)";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const n = (s: unknown) => String(s ?? "").trim().toLowerCase();
const cancelado = (o: any) => o.status === "cancelled" || o.payment_status === "refunded" || o.payment_status === "voided";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(SB_URL, SERVICE);
  const body = await req.json().catch(() => ({}));
  let filtroEmpresa: string | null = null;
  const { data: ck } = await admin.from("app_config").select("valor").eq("clave", "cron_key").maybeSingle();
  const claveCron = CRON_KEY || ck?.valor || "";
  const esCron = req.headers.get("x-cron-key") && claveCron && req.headers.get("x-cron-key") === claveCron;
  if (!esCron) {
    const comoUsuario = createClient(SB_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await comoUsuario.auth.getUser();
    if (!user) return json({ error: "Sesión inválida" }, 401);
    if (!body.empresa_id) return json({ error: "Falta empresa_id" }, 400);
    const { data: ok } = await comoUsuario.rpc("es_miembro", { e: body.empresa_id });
    if (!ok) return json({ error: "No pertenecés a esta empresa" }, 403);
    filtroEmpresa = body.empresa_id;
  }
  const simular = !!body.simular;
  const soloProductos: string[] = Array.isArray(body.solo_productos) ? body.solo_productos.map(String) : [];
  let qc = admin.from("conexiones").select("id,empresa_id,externo_id,canal,empujar_stock,ultima_sync_pedidos,creada,ultimo_refresco_web").eq("estado", "activa");
  if (!soloProductos.length && !simular) qc = qc.eq("empujar_stock", true);
  if (filtroEmpresa) qc = qc.eq("empresa_id", filtroEmpresa);
  const { data: conexiones } = await qc;
  const resumen: Record<string, unknown>[] = [];
  const pag = async (q: () => any) => { let todo: any[] = []; for (let d = 0; ; d += 1000) { const { data } = await q().range(d, d + 999); todo = todo.concat(data || []); if (!data || data.length < 1000) break; } return todo; };
  for (const cx of conexiones || []) {
    if (cx.canal !== "tiendanube") continue;
    const { data: sec } = await admin.from("conexion_secretos").select("access_token").eq("conexion_id", cx.id).maybeSingle();
    if (!sec) continue;
    const headers = { Authentication: `bearer ${sec.access_token}`, "User-Agent": UA, "Content-Type": "application/json" };
    const base = `https://api.tiendanube.com/2025-03/${cx.externo_id}`;

    // ---- una vez por hora: qué está visible en la web y con cuánto stock (en Tienda Nube también lo cambian a mano) ----
    if (!simular && (body.refrescar || !cx.ultimo_refresco_web || Date.now() - new Date(cx.ultimo_refresco_web).getTime() > 60 * 60 * 1000)) {
      const web = new Map<string, { pub: boolean; stock: number | null }>(); let completo = true;
      for (let page = 1; page <= 50; page++) {
        const r = await fetch(`${base}/products?per_page=200&page=${page}&fields=id,published,variants`, { headers });
        if (r.status === 404) break; if (!r.ok) { completo = false; break; }
        const lote = await r.json(); if (!Array.isArray(lote) || !lote.length) break;
        for (const pr of lote) for (const v of pr.variants || []) web.set(String(v.id), { pub: pr.published !== false, stock: v.stock_management === false ? null : (v.stock != null ? +v.stock : null) });
        if (lote.length < 200) break;
      }
      if (completo && web.size) {
        const cache = await pag(() => admin.from("canal_items").select("id,empresa_id,variante_id,variante_ext,stock,publicado").eq("conexion_id", cx.id));
        for (const c of cache) {
          const w = web.get(String(c.variante_ext)); if (!w) continue;
          const st = w.stock == null ? null : w.stock;
          if (c.publicado === w.pub && (c.stock == null ? null : +c.stock) === st) continue;
          await admin.from("canal_items").update({ publicado: w.pub, stock: st, actualizado: new Date().toISOString() }).eq("id", c.id);
          if (w.pub && c.publicado === false && c.variante_id) await admin.rpc("encolar_canal", { e: c.empresa_id, v: c.variante_id });   // la volvieron a mostrar: que reciba el stock de Percha
        }
        await admin.from("conexiones").update({ ultimo_refresco_web: new Date().toISOString() }).eq("id", cx.id);
      }
    }

    // ---- qué variantes de Percha hay que mandar ----
    let variantes: string[] = []; let filas: any[] = [];
    if (soloProductos.length) {
      const { data: prods } = await admin.from("productos").select("id,tipo").eq("empresa_id", cx.empresa_id).in("codigo", soloProductos);
      const pids = (prods || []).map((p: any) => p.id);
      // también los kits que usan esos productos
      const { data: kits } = await admin.from("producto_componentes").select("producto_id").in("componente_producto_id", pids);
      const todos = [...new Set([...pids, ...(kits || []).map((k: any) => k.producto_id)])];
      const { data: vs } = await admin.from("variantes").select("id").in("producto_id", todos);
      variantes = (vs || []).map((v: any) => v.id);
    } else if (simular && body.todo) {
      const cruzados = await pag(() => admin.from("canal_items").select("variante_id").eq("conexion_id", cx.id).not("variante_id", "is", null));
      variantes = [...new Set(cruzados.map((c: any) => c.variante_id))];
    } else {
      const { data: cola } = await admin.from("canal_cola").select("id,variante_id,intentos").eq("conexion_id", cx.id).eq("estado", "pendiente").lt("intentos", 5).order("id").limit(200);
      filas = cola || []; variantes = [...new Set(filas.map((c: any) => c.variante_id))];
    }
    if (!variantes.length) { resumen.push({ conexion: cx.id, actualizadas: 0, errores: 0 }); continue; }

    // ---- unidades que la web ya descontó y Percha todavía no (pedidos que no están en Percha) ----
    const reservado = new Map<string, number>();   // variante del canal → unidades
    const pedidosVistos = new Set<string>(); const pedidosReservando: string[] = [];
    const reservar = (pedido: string, numero: string, productos: any[]) => {
      if (pedidosVistos.has(pedido)) return; pedidosVistos.add(pedido);
      let algo = false;
      for (const pr of productos || []) { const k = String(pr.variant_id); reservado.set(k, (reservado.get(k) || 0) + (+pr.quantity || 0)); algo = true; }
      if (algo) pedidosReservando.push(numero);
    };
    // 1) los recientes, leídos de la web en este momento (puede haber pedidos que el importador todavía no vio)
    const enPercha = new Map<string, any>();
    const cps = await pag(() => admin.from("canal_pedidos").select("pedido_ext,numero_ext,venta_id,estado_ext,pago_ext,datos").eq("conexion_id", cx.id));
    for (const p of cps) enPercha.set(String(p.pedido_ext), p);
    const desde = new Date(new Date(cx.ultima_sync_pedidos || cx.creada).getTime() - 30 * 60 * 1000).toISOString();
    try {
      for (let page = 1; page <= 5; page++) {
        const r = await fetch(`${base}/orders?per_page=100&page=${page}&updated_at_min=${encodeURIComponent(desde)}&fields=id,number,status,payment_status,products`, { headers });
        if (!r.ok) break;
        const lote = await r.json(); if (!Array.isArray(lote) || !lote.length) break;
        for (const o of lote) {
          const ya = enPercha.get(String(o.id));
          if (cancelado(o)) { pedidosVistos.add(String(o.id)); continue; }
          if (ya?.venta_id) { pedidosVistos.add(String(o.id)); continue; }
          reservar(String(o.id), String(o.number), o.products);
        }
        if (lote.length < 100) break;
      }
    } catch (_) { /* si la web no responde, quedan los pedidos guardados */ }
    // 2) los guardados sin venta (sin pagar) que siguen abiertos
    for (const p of cps) {
      if (p.venta_id || p.estado_ext === "cancelled" || p.pago_ext === "refunded" || p.pago_ext === "voided") continue;
      reservar(String(p.pedido_ext), String(p.numero_ext), p.datos?.products || []);
    }

    const items: any[] = [];   // de a tandas: una lista larga de ids no entra en la dirección de la consulta
    for (let i = 0; i < variantes.length; i += 300) items.push(...await pag(() => admin.from("canal_items").select("id,variante_id,producto_ext,variante_ext,stock,talle_canal,color_canal,publicado").eq("conexion_id", cx.id).in("variante_id", variantes.slice(i, i + 300))));
    const stocks: any[] = [];
    for (let i = 0; i < variantes.length; i += 300) { const { data } = await admin.from("v_variantes").select("id,producto_id,producto_tipo,sku,stock,fallas,producto_nombre,talle_nombre,color_nombre").in("id", variantes.slice(i, i + 300)); stocks.push(...(data || [])); }
    const infoVar = new Map(stocks.map((s: any) => [s.id, s]));
    // kits: componentes y variantes de los productos componentes (para resolver talle/color)
    const kitsIds = [...new Set(stocks.filter((s: any) => s.producto_tipo === "kit").map((s: any) => s.producto_id))];
    const comps = new Map<string, any[]>(); const varsDe = new Map<string, any[]>();
    if (kitsIds.length) {
      const { data: cs } = await admin.from("v_componentes").select("producto_id,variante_id,comp_producto_id,filtro,cantidad,stock").in("producto_id", kitsIds);
      for (const c of cs || []) { if (!comps.has(c.producto_id)) comps.set(c.producto_id, []); comps.get(c.producto_id)!.push(c); }
      const compProds = [...new Set((cs || []).filter((c: any) => c.comp_producto_id && !c.variante_id && !c.filtro).map((c: any) => c.comp_producto_id))];
      if (compProds.length) {
        const { data: cv } = await admin.from("v_variantes").select("id,producto_id,talle_nombre,color_nombre,stock,fallas,activa").in("producto_id", compProds).eq("activa", true);
        for (const v of cv || []) { if (!varsDe.has(v.producto_id)) varsDe.set(v.producto_id, []); varsDe.get(v.producto_id)!.push(v); }
      }
    }
    // stock que corresponde a un ítem del canal (antes de restar lo reservado)
    const stockPara = (d: any): number => {
      const v = infoVar.get(d.variante_id); if (!v) return 0;
      if (v.producto_tipo !== "kit") return Math.max(0, Math.floor((+v.stock || 0) - (+v.fallas || 0)));   // las prendas con falla son solo del local
      const talle = n((d.talle_canal || "").split("/")[0]), color = n(d.color_canal);
      let minimo = Infinity;
      for (const c of comps.get(v.producto_id) || []) {
        let disp = 0;
        if (c.variante_id || c.filtro) disp = +c.stock || 0;
        else {
          const cands = varsDe.get(c.comp_producto_id) || [];
          const exacta = cands.find((x: any) => n(x.talle_nombre) === talle && n(x.color_nombre) === color)
            || cands.find((x: any) => n(x.talle_nombre) === talle && !x.color_nombre)
            || (!talle ? cands.find((x: any) => n(x.color_nombre) === color && !x.talle_nombre) : null);
          disp = exacta ? Math.max(0, (+exacta.stock || 0) - (+exacta.fallas || 0)) : 0;
        }
        minimo = Math.min(minimo, Math.floor(disp / (+c.cantidad || 1)));
      }
      return minimo === Infinity ? 0 : Math.max(0, minimo);
    };

    // simulación: stock que tiene hoy la web, producto por producto
    const enWeb = new Map<string, number | null>(); const visible = new Map<string, boolean>();
    if (simular) {
      const prods = [...new Set(items.map((d: any) => String(d.producto_ext)))];
      if (body.todo) {
        for (let page = 1; page <= 50; page++) {
          const r = await fetch(`${base}/products?per_page=200&page=${page}&fields=id,published,variants`, { headers });
          if (!r.ok) break; const lote = await r.json(); if (!Array.isArray(lote) || !lote.length) break;
          for (const p of lote) for (const v of p.variants || []) { enWeb.set(String(v.id), v.stock == null ? null : +v.stock); visible.set(String(v.id), p.published !== false); }
          if (lote.length < 200) break;
        }
      } else {
        for (const pid of prods) { const r = await fetch(`${base}/products/${pid}?fields=id,variants`, { headers }); if (r.ok) { const p = await r.json(); for (const v of p.variants || []) enWeb.set(String(v.id), v.stock == null ? null : +v.stock); } }
      }
    }

    // genéricos ("Bombis varias", bolsas sin definir): en la web son publicaciones sueltas que la web maneja sola; no se pisan
    const genericos = new Set<string>();
    const pidsVar = [...new Set(stocks.map((s: any) => s.producto_id))];
    for (let i = 0; i < pidsVar.length; i += 300) { const { data } = await admin.from("productos").select("id").eq("es_generico", true).in("id", pidsVar.slice(i, i + 300)); for (const p of data || []) genericos.add(p.id); }
    // un kit armado con genéricos ("Pack x3 bombis varias") tampoco: Percha no sabe cuántos se pueden armar
    const compsIds = [...new Set([...comps.values()].flat().map((c: any) => c.comp_producto_id).filter(Boolean))];
    const compGen = new Set<string>();
    if (compsIds.length) { const { data } = await admin.from("productos").select("id").eq("es_generico", true).in("id", compsIds); for (const p of data || []) compGen.add(p.id); }
    for (const [kit, cs] of comps) if (cs.some((c: any) => compGen.has(c.comp_producto_id))) genericos.add(kit);

    let ok = 0, err = 0, frenado = false; const detalle: string[] = []; const diferencias: any[] = []; const sinTocar: any[] = [];
    const porVariante = new Map<string, any[]>();
    for (const d of items) { if (!porVariante.has(d.variante_id)) porVariante.set(d.variante_id, []); porVariante.get(d.variante_id)!.push(d); }
    const webDe = (d: any) => simular ? (enWeb.has(String(d.variante_ext)) ? enWeb.get(String(d.variante_ext)) : undefined) : (d.stock == null ? null : +d.stock);
    for (const vid of variantes) {
      if (frenado) break;
      const todos = porVariante.get(vid) || []; if (!todos.length) continue;
      const v = infoVar.get(vid); const esKit = v?.producto_tipo === "kit";
      if (!v || genericos.has(v.producto_id) || /-SD$/i.test(v.sku || "")) { if (simular) sinTocar.push({ producto: v?.producto_nombre, por: "genérico: la web lo maneja sola" }); else if (filas.length) await admin.from("canal_cola").update({ estado: "hecho", hecho: new Date().toISOString(), error: "genérico: no se manda" }).eq("conexion_id", cx.id).eq("variante_id", vid).eq("estado", "pendiente"); continue; }
      // lo que está oculto en la web no se toca (publicaciones viejas o pausadas)
      const oculto = (d: any) => simular && body.todo ? visible.get(String(d.variante_ext)) === false : d.publicado === false;
      const ocultos = todos.filter(oculto);
      if (ocultos.length === todos.length) { if (simular) sinTocar.push({ producto: v.producto_nombre, por: "oculto en la web" }); else await admin.from("canal_cola").update({ estado: "hecho", hecho: new Date().toISOString(), error: "oculto en la web: no se manda" }).eq("conexion_id", cx.id).eq("variante_id", vid).eq("estado", "pendiente"); continue; }
      // las publicaciones sin límite de stock (gift cards, cajas sorpresa) no se tocan
      let destinos = todos.filter((d: any) => !oculto(d) && webDe(d) !== null);
      if (!destinos.length) { if (simular) sinTocar.push({ producto: v.producto_nombre, por: "sin límite de stock en la web" }); else await admin.from("canal_cola").update({ estado: "hecho", hecho: new Date().toISOString(), error: "sin límite en la web: no se manda" }).eq("conexion_id", cx.id).eq("variante_id", vid).eq("estado", "pendiente"); continue; }
      // varias publicaciones de la web para una sola prenda de Percha (la web separa talles que Percha tiene juntos):
      // el total de la web tiene que ser el de Percha; se respeta cómo lo reparte la web y solo se corrige la diferencia
      const bolsa = !esKit && destinos.length > 1;
      if (bolsa && !simular) {
        const r = await fetch(`${base}/products/${destinos[0].producto_ext}?fields=id,variants`, { headers });   // lo de la web ahora, no lo último que se mandó
        if (r.ok) { const p = await r.json(); const vivo = new Map((p.variants || []).map((x: any) => [String(x.id), x.stock == null ? null : +x.stock])); destinos = destinos.map((d: any) => vivo.has(String(d.variante_ext)) ? { ...d, stock: vivo.get(String(d.variante_ext)) } : d).filter((d: any) => d.stock !== null); }
        if (!destinos.length) continue;
      }
      const valores = new Map<number, number>();
      if (bolsa) {
        const res = destinos.reduce((s: number, d: any) => s + (reservado.get(String(d.variante_ext)) || 0), 0);
        const meta = Math.max(0, stockPara(destinos[0]) - res);
        const act = destinos.map((d: any) => Math.max(0, Math.floor(+(webDe(d) ?? 0) || 0)));
        let dif = meta - act.reduce((s: number, x: number) => s + x, 0);
        while (dif < 0) { const i = act.indexOf(Math.max(...act)); if (act[i] <= 0) break; act[i]--; dif++; }   // falta: se saca de donde la web tiene más
        if (dif > 0) { const i = act.indexOf(Math.max(...act)); act[i] += dif; }                                   // sobra: va a donde la web tiene más
        act.forEach((x: number, i: number) => valores.set(i, x));
      } else destinos.forEach((d: any, i: number) => valores.set(i, Math.max(0, stockPara(d) - (reservado.get(String(d.variante_ext)) || 0))));
      let fallo: string | null = null; const anterior = +destinos[0].stock;
      let enviado = 0;
      for (let k = 0; k < destinos.length; k++) {
        const d = destinos[k];
        const valor = valores.get(k)!; const res = reservado.get(String(d.variante_ext)) || 0;
        if (k === 0) enviado = valor;
        if (simular) {
          const web = webDe(d);
          if (web === undefined || web !== valor) diferencias.push({ producto: v.producto_nombre, talle: d.talle_canal || v.talle_nombre, color: d.color_canal || v.color_nombre, web: web === undefined ? "no está en la web" : web, percha: stockPara(d), reservado: res, mandaria: valor, bolsa });
          continue;
        }
        if (+d.stock === valor) continue;
        const r = await fetch(`${base}/products/${d.producto_ext}/variants/${d.variante_ext}`, { method: "PUT", headers, body: JSON.stringify({ stock: valor }) });
        if (r.status === 429) { frenado = true; fallo = "429"; break; }   // la web pide esperar: sigue en la próxima vuelta, sin contar intento
        if (!r.ok) { fallo = `${r.status} ${(await r.text()).slice(0, 200)}`; break; }
        await admin.from("canal_items").update({ stock: valor, actualizado: new Date().toISOString() }).eq("id", d.id);
        detalle.push(`${d.producto_ext}/${d.variante_ext} ${d.talle_canal || ""} ${d.color_canal || ""}: ${d.stock} → ${valor}${res ? ` (−${res} de pedidos sin cargar)` : ""}`);
      }
      if (simular) continue;
      const fila = filas.find((f: any) => f.variante_id === vid);
      if (fallo === "429") break;
      if (fallo) { err++; if (fila) await admin.from("canal_cola").update({ intentos: (fila.intentos || 0) + 1, error: fallo, estado: (fila.intentos || 0) + 1 >= 5 ? "error" : "pendiente" }).eq("id", fila.id); }
      else { ok++; if (fila) await admin.from("canal_cola").update({ estado: "hecho", hecho: new Date().toISOString(), error: null, stock_anterior: anterior, stock_enviado: enviado }).eq("conexion_id", cx.id).eq("variante_id", vid).eq("estado", "pendiente");
             else await admin.from("canal_cola").update({ estado: "hecho", hecho: new Date().toISOString(), error: "enviado a pedido" }).eq("conexion_id", cx.id).eq("variante_id", vid).eq("estado", "pendiente"); }
    }
    if (simular) { resumen.push({ conexion: cx.id, revisadas: variantes.length, items_canal: items.length, en_web: enWeb.size, pedidos_sin_cargar: pedidosReservando, diferencias, sin_tocar: sinTocar }); continue; }
    resumen.push({ conexion: cx.id, actualizadas: ok, errores: err, cambios: detalle, pedidos_sin_cargar: pedidosReservando });
  }
  return json({ ok: true, resumen });
});
