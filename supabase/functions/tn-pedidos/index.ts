// tn-pedidos · trae los pedidos de Tienda Nube y los registra como ventas en Percha (origen "tiendanube").
// Descuenta stock (prendas y kits) por el mismo camino que la caja. Los pedidos cancelados anulan la venta.
// Auth: sesión de un miembro de la empresa ({conexion_id}) o header x-cron-key (todas las conexiones).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const SB_URL = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UA = "Percha (rosaint.ar@gmail.com)";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const r2 = (n: number) => Math.round((+n || 0) * 100) / 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(SB_URL, SERVICE);
  const body = await req.json().catch(() => ({}));
  const { data: ck } = await admin.from("app_config").select("valor").eq("clave", "cron_key").maybeSingle();
  let conexiones: any[] = [];
  if (req.headers.get("x-cron-key") && ck?.valor && req.headers.get("x-cron-key") === ck.valor) {
    conexiones = (await admin.from("conexiones").select("*").eq("estado", "activa").eq("canal", "tiendanube")).data || [];
  } else {
    const comoUsuario = createClient(SB_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await comoUsuario.auth.getUser();
    if (!user) return json({ error: "Sesión inválida" }, 401);
    const { data: cx } = await admin.from("conexiones").select("*").eq("id", body.conexion_id).maybeSingle();
    if (!cx) return json({ error: "Conexión inexistente" }, 404);
    const { data: ok } = await comoUsuario.rpc("es_miembro", { e: cx.empresa_id });
    if (!ok) return json({ error: "No pertenecés a esta empresa" }, 403);
    conexiones = [cx];
  }
  const resumen: any[] = [];
  for (const cx of conexiones) {
    const e = cx.empresa_id;
    const { data: sec } = await admin.from("conexion_secretos").select("access_token").eq("conexion_id", cx.id).maybeSingle();
    if (!sec) continue;
    const headers = { Authentication: `bearer ${sec.access_token}`, "User-Agent": UA, "Content-Type": "application/json" };
    const base = `https://api.tiendanube.com/2025-03/${cx.externo_id}`;
    // desde la última vez (con margen de 2 h); la primera vez, solo desde que se activó la conexión (no importa el pasado)
    const desde = new Date(new Date(cx.ultima_sync_pedidos || cx.creada).getTime() - 2 * 3600 * 1000).toISOString();
    const ahora = new Date().toISOString();
    let pedidos: any[] = [], page = 1;
    while (page <= 20) {
      const r = await fetch(`${base}/orders?per_page=100&page=${page}&updated_at_min=${encodeURIComponent(desde)}`, { headers });
      if (r.status === 404) break;
      if (!r.ok) { await admin.from("conexiones").update({ ultimo_error: `Pedidos TN ${r.status}` }).eq("id", cx.id); break; }
      const lote = await r.json(); if (!Array.isArray(lote) || !lote.length) break;
      pedidos = pedidos.concat(lote); if (lote.length < 100) break; page++;
    }
    // catálogos de apoyo
    const { data: items } = await admin.from("canal_items").select("variante_ext,variante_id,producto_ext").eq("conexion_id", cx.id);
    const porExt = new Map((items || []).map((i: any) => [i.variante_ext, i]));
    const { data: formas } = await admin.from("formas_pago").select("id,nombre,tipo").eq("empresa_id", e).eq("activa", true);
    const { data: listas } = await admin.from("listas_precios").select("id,predeterminada").eq("empresa_id", e).eq("activa", true);
    const listaBase = (listas || []).find((l: any) => l.predeterminada)?.id || (listas || [])[0]?.id || null;
    const formaPara = async (gateway: string) => {
      const g = (gateway || "").toLowerCase();
      let f = (formas || []).find((x: any) => x.nombre.toLowerCase().includes("online") && (g.includes("mercado") ? x.nombre.toLowerCase().includes("mercado") : g.includes("pago nube") || g.includes("nuvem") ? x.nombre.toLowerCase().includes("nube") : g.includes("transfer") ? x.nombre.toLowerCase().includes("transfer") : false));
      if (!f) f = (formas || []).find((x: any) => x.nombre.toLowerCase() === "online");
      if (!f) { const ins = await admin.from("formas_pago").insert({ empresa_id: e, nombre: "Online", tipo: "online", orden: 50 }).select().single(); f = ins.data; (formas || []).push(f); }
      return f.id;
    };
    let nuevos = 0, anulados = 0, conProblema = 0;
    // solo_ver: devuelve lo que importaría, sin escribir nada
    if (body.solo_ver) {
      const vista: any[] = [];
      for (const o of pedidos) {
        const { data: ya } = await admin.from("canal_pedidos").select("venta_id").eq("conexion_id", cx.id).eq("pedido_ext", String(o.id)).maybeSingle();
        vista.push({ numero: o.number, fecha: o.created_at, estado: o.status, pago: o.payment_status, total: o.total, cliente: o.customer?.name, ya_importado: !!(ya && ya.venta_id),
          lineas: (o.products || []).map((pr: any) => ({ nombre: pr.name, sku: pr.sku, cantidad: pr.quantity, precio: pr.price, cruzado: !!porExt.get(String(pr.variant_id))?.variante_id })) });
      }
      resumen.push({ conexion: cx.id, desde, pedidos: vista }); continue;
    }
    for (const o of pedidos) {
      const pedidoExt = String(o.id);
      const { data: ya } = await admin.from("canal_pedidos").select("*").eq("conexion_id", cx.id).eq("pedido_ext", pedidoExt).maybeSingle();
      const pagado = o.payment_status === "paid", cancelado = o.status === "cancelled" || o.payment_status === "refunded" || o.payment_status === "voided";
      const datosPedido = { empresa_id: e, conexion_id: cx.id, pedido_ext: pedidoExt, numero_ext: String(o.number ?? ""), estado_ext: o.status, pago_ext: o.payment_status, total: +o.total || 0, fecha: o.created_at, cliente: o.customer?.name || o.contact_name || null, datos: { gateway: o.gateway_name || o.gateway, products: o.products, shipping: o.shipping_cost_customer, discount: o.discount }, actualizado: ahora };
      if (ya && ya.venta_id) {
        if (cancelado) { const { data: v } = await admin.from("ventas").select("estado").eq("id", ya.venta_id).single(); if (v && v.estado !== "anulada") { await admin.rpc("caja_anular_venta", { p_venta: ya.venta_id, p_motivo: "Pedido cancelado en Tienda Nube" }); anulados++; } }
        await admin.from("canal_pedidos").update({ estado_ext: o.status, pago_ext: o.payment_status, actualizado: ahora }).eq("id", ya.id);
        continue;
      }
      if (!pagado || cancelado) { await admin.from("canal_pedidos").upsert(datosPedido, { onConflict: "conexion_id,pedido_ext" }); continue; }
      // armar la venta
      const lineas: any[] = []; const problemas: string[] = [];
      for (const pr of o.products || []) {
        const it = porExt.get(String(pr.variant_id));
        const cant = +pr.quantity || 1, precio = r2(+pr.price || 0);
        let costo = 0, producto_id: string | null = null;
        if (it?.variante_id) { const { data: v } = await admin.from("v_variantes").select("costo,producto_id").eq("id", it.variante_id).single(); costo = +v?.costo || 0; producto_id = v?.producto_id || null; }
        else problemas.push(`${pr.name} (${pr.sku || "sin sku"}) no está cruzado: no descontó stock`);
        lineas.push({ variante_id: it?.variante_id || null, producto_id, descripcion: pr.name, talle: pr.variant_values?.[0] || null, color: pr.variant_values?.[1] || null, cantidad: cant, precio_lista: precio, precio_unit: precio, descuento_pct: 0, total: r2(precio * cant), costo_unit: costo });
      }
      const envio = +o.shipping_cost_customer || 0;
      if (envio > 0) lineas.push({ variante_id: null, producto_id: null, descripcion: "Envío", cantidad: 1, precio_lista: envio, precio_unit: envio, descuento_pct: 0, total: envio, costo_unit: 0 });
      const subtotal = r2(lineas.reduce((s, l) => s + l.total, 0)), descuento = r2(+o.discount || 0);
      const total = r2(subtotal - descuento);
      const ajuste = r2((+o.total || total) - total);   // redondeos del canal
      const payload = { empresa_id: e, offline_id: crypto.randomUUID(), tipo: "venta", estado: "completada", caja_id: null, turno_id: null, cliente_id: null, vendedora_id: null, lista_id: listaBase,
        descuento_pct: 0, descuento, recargo: ajuste, nota: `Tienda Nube #${o.number}` + (o.note ? " · " + o.note : ""), origen: "tiendanube", referencia: String(o.number ?? o.id),
        lineas, pagos: [{ forma_pago_id: await formaPara(o.gateway_name || o.gateway), credito_id: null, monto: r2(total + ajuste), cuotas: +o.payment_details?.installments || 1, recargo_pct: 0, referencia: o.gateway_name || null }], creditos_a_emitir: [] };
      // clienta
      if (o.customer?.email || o.customer?.name) {
        const { data: cl } = o.customer?.email ? await admin.from("clientes").select("id").eq("empresa_id", e).eq("email", o.customer.email).maybeSingle() : { data: null };
        if (cl) payload.cliente_id = cl.id; else { const ins = await admin.from("clientes").insert({ empresa_id: e, nombre: o.customer?.name || "Clienta Tienda Nube", email: o.customer?.email || null, telefono: o.customer?.phone || null, documento: o.customer?.identification || null }).select().single(); if (ins.data) payload.cliente_id = ins.data.id; }
      }
      const { data: venta, error } = await admin.rpc("caja_registrar_venta", { p: payload });
      if (error) { problemas.push("No se pudo registrar: " + error.message); conProblema++; await admin.from("canal_pedidos").upsert({ ...datosPedido, problema: problemas.join(" · ") }, { onConflict: "conexion_id,pedido_ext" }); continue; }
      nuevos++; if (problemas.length) conProblema++;
      await admin.from("canal_pedidos").upsert({ ...datosPedido, venta_id: venta.id, problema: problemas.length ? problemas.join(" · ") : null }, { onConflict: "conexion_id,pedido_ext" });
    }
    await admin.from("conexiones").update({ ultima_sync_pedidos: ahora }).eq("id", cx.id);
    resumen.push({ conexion: cx.id, pedidos_leidos: pedidos.length, nuevos, anulados, con_problema: conProblema });
  }
  return json({ ok: true, resumen });
});
