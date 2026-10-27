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
  let qc = admin.from("conexiones").select("id,empresa_id,externo_id,canal,empujar_stock,ultima_sync_pedidos,creada").eq("estado", "activa");
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

    const items = await pag(() => admin.from("canal_items").select("id,variante_id,producto_ext,variante_ext,stock,talle_canal,color_canal").eq("conexion_id", cx.id).in("variante_id", variantes));
    const stocks: any[] = [];
    for (let i = 0; i < variantes.length; i += 300) { const { data } = await admin.from("v_variantes").select("id,producto_id,producto_tipo,stock,fallas,producto_nombre,talle_nombre,color_nombre").in("id", variantes.slice(i, i + 300)); stocks.push(...(data || [])); }
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
    const enWeb = new Map<string, number | null>();
    if (simular) {
      const prods = [...new Set(items.map((d: any) => String(d.producto_ext)))];
      if (body.todo) {
        for (let page = 1; page <= 50; page++) {
          const r = await fetch(`${base}/products?per_page=200&page=${page}&fields=id,variants`, { headers });
          if (!r.ok) break; const lote = await r.json(); if (!Array.isArray(lote) || !lote.length) break;
          for (const p of lote) for (const v of p.variants || []) enWeb.set(String(v.id), v.stock == null ? null : +v.stock);
          if (lote.length < 200) break;
        }
      } else {
        for (const pid of prods) { const r = await fetch(`${base}/products/${pid}?fields=id,variants`, { headers }); if (r.ok) { const p = await r.json(); for (const v of p.variants || []) enWeb.set(String(v.id), v.stock == null ? null : +v.stock); } }
      }
    }

    let ok = 0, err = 0, frenado = false; const detalle: string[] = []; const diferencias: any[] = [];
    const porVariante = new Map<string, any[]>();
    for (const d of items) { if (!porVariante.has(d.variante_id)) porVariante.set(d.variante_id, []); porVariante.get(d.variante_id)!.push(d); }
    for (const vid of variantes) {
      if (frenado) break;
      const destinos = porVariante.get(vid) || []; if (!destinos.length) continue;
      const v = infoVar.get(vid); const esKit = v?.producto_tipo === "kit";
      let fallo: string | null = null; const anterior = +destinos[0].stock;
      let enviado = 0;
      for (let k = 0; k < destinos.length; k++) {
        const d = destinos[k];
        // varias variantes del canal apuntando a la misma de Percha (sin kit): el stock va a la primera y el resto en 0
        const base_ = esKit ? stockPara(d) : (k === 0 ? stockPara(d) : 0);
        const res = reservado.get(String(d.variante_ext)) || 0;
        const valor = Math.max(0, base_ - res);
        if (k === 0) enviado = valor;
        if (simular) {
          const web = enWeb.has(String(d.variante_ext)) ? enWeb.get(String(d.variante_ext)) : undefined;
          if (web === undefined || web !== valor) diferencias.push({ producto: v?.producto_nombre, talle: d.talle_canal || v?.talle_nombre, color: d.color_canal || v?.color_nombre, web: web === undefined ? "no está en la web" : web === null ? "sin límite" : web, percha: base_, reservado: res, mandaria: valor });
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
    if (simular) { resumen.push({ conexion: cx.id, revisadas: variantes.length, pedidos_sin_cargar: pedidosReservando, diferencias }); continue; }
    resumen.push({ conexion: cx.id, actualizadas: ok, errores: err, cambios: detalle, pedidos_sin_cargar: pedidosReservando });
  }
  return json({ ok: true, resumen });
});
