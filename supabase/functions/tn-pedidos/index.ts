// tn-pedidos · trae los pedidos de Tienda Nube y los registra como ventas en Percha (origen "tiendanube").
// Descuenta stock (prendas y kits) por el mismo camino que la caja. Los pedidos cancelados anulan la venta.
// Auth: sesión de un miembro de la empresa ({conexion_id}) o header x-cron-key (todas las conexiones).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const SB_URL = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UA = "Percha (rosaint.ar@gmail.com)";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const r2 = (n: number) => Math.round((+n || 0) * 100) / 100;
// la entrega del pedido (medio, costo, dirección, estado y seguimiento) → campos envio_* de la venta, para la lista de Envíos
const RANGO: Record<string, number> = { pendiente: 0, preparado: 1, enviado: 2, entregado: 3 };
function envioDe(o: any) {
  // API 2025-03: el medio y el seguimiento vienen en fulfillments[]; el estado general en shipping_status
  const a = o.shipping_address || {}, fu = (o.fulfillments || [])[0] || {}, sh = fu.shipping || {};
  const retiro = sh.type === "pickup" || o.shipping_pickup_type === "pickup";
  const st = (String(o.shipping_status || "") + " " + String(fu.status || "")).toLowerCase();
  const estado = /deliver/.test(st) ? "entregado" : /ship|dispatch|fulfill/.test(st) ? "enviado" : /pack|ready/.test(st) ? "preparado" : "pendiente";
  const dir = retiro ? null : [[a.address, a.number].map((x: any) => String(x || "").trim()).filter(Boolean).join(" "), a.floor, a.locality, a.city, a.province, a.zipcode].map((x: any) => String(x || "").trim()).filter(Boolean).join(", ") || null;
  return { envio_metodo: (sh.option?.name || sh.carrier?.name || o.shipping_option || (retiro ? "Retiro" : "Envío")) + (retiro && fu.assigned_location?.name ? " · " + fu.assigned_location.name : ""),
    envio_costo: o.shipping_cost_customer != null ? +o.shipping_cost_customer : null,
    envio_direccion: dir, envio_contacto: [a.name, a.phone || o.contact_phone].map((x: any) => String(x || "").trim()).filter(Boolean).join(" · ") || null,
    envio_seguimiento: fu.tracking_info?.code || o.shipping_tracking_number || null, envio_estado: estado };
}

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
    const desde = body.desde ? new Date(body.desde).toISOString() : new Date(new Date(cx.ultima_sync_pedidos || cx.creada).getTime() - 2 * 3600 * 1000).toISOString();
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
    // todas las variantes del canal (PostgREST corta en 1000: se pagina)
    let items: any[] = []; for (let d = 0; ; d += 1000) { const { data } = await admin.from("canal_items").select("variante_ext,variante_id,producto_ext").eq("conexion_id", cx.id).range(d, d + 999); items = items.concat(data || []); if (!data || data.length < 1000) break; }
    const porExt = new Map(items.map((i: any) => [i.variante_ext, i]));
    const { data: formas } = await admin.from("formas_pago").select("id,nombre,tipo").eq("empresa_id", e).eq("activa", true);
    const { data: listas } = await admin.from("listas_precios").select("id,predeterminada").eq("empresa_id", e).eq("activa", true);
    const listaBase = (listas || []).find((l: any) => l.predeterminada)?.id || (listas || [])[0]?.id || null;
    // cada medio de pago del canal tiene su forma de pago propia en Percha: "Tienda Nube · Pago Nube", "Tienda Nube · Transferencia bancaria"…
    const formaPara = async (gateway: string) => {
      const nombre = `Tienda Nube · ${(gateway || "Otro").trim()}`;
      let f = (formas || []).find((x: any) => x.nombre.toLowerCase() === nombre.toLowerCase());
      if (!f) { const ins = await admin.from("formas_pago").insert({ empresa_id: e, nombre, tipo: "online", orden: 60 }).select().single(); f = ins.data; (formas || []).push(f); }
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
      if (body.solo_pedido && String(o.number) !== String(body.solo_pedido)) continue;   // importar uno solo (pruebas / reintentos)
      const pedidoExt = String(o.id);
      const { data: ya } = await admin.from("canal_pedidos").select("*").eq("conexion_id", cx.id).eq("pedido_ext", pedidoExt).maybeSingle();
      const pagado = o.payment_status === "paid", cancelado = o.status === "cancelled" || o.payment_status === "refunded" || o.payment_status === "voided";
      const datosPedido = { empresa_id: e, conexion_id: cx.id, pedido_ext: pedidoExt, numero_ext: String(o.number ?? ""), estado_ext: o.status, pago_ext: o.payment_status, total: +o.total || 0, fecha: o.created_at, cliente: o.customer?.name || o.contact_name || null, datos: { gateway: o.gateway_name || o.gateway, products: o.products, shipping: o.shipping_cost_customer, discount: o.discount }, actualizado: ahora };
      if (ya && ya.venta_id) {
        if (cancelado) { const { data: v } = await admin.from("ventas").select("estado").eq("id", ya.venta_id).single(); if (v && v.estado !== "anulada") { await admin.rpc("caja_anular_venta", { p_venta: ya.venta_id, p_motivo: "Pedido cancelado en Tienda Nube" }); anulados++; } }
        await admin.from("canal_pedidos").update({ estado_ext: o.status, pago_ext: o.payment_status, actualizado: ahora }).eq("id", ya.id);
        // la entrega: se completa si falta y el estado solo avanza (si en Percha ya lo marcaron más adelante, se respeta)
        if (!cancelado && o.has_shippable_products !== false) {
          const { data: vv } = await admin.from("ventas").select("envio_estado,envio_metodo").eq("id", ya.venta_id).single();
          const en = envioDe(o), upd: any = {};
          if (!vv?.envio_metodo) { Object.assign(upd, en); if (upd.envio_costo == null) { const { data: le } = await admin.from("venta_lineas").select("total").eq("venta_id", ya.venta_id).is("variante_id", null).ilike("descripcion", "env%").limit(1).maybeSingle(); upd.envio_costo = le ? +le.total : null; } } else { if (RANGO[en.envio_estado] > RANGO[vv.envio_estado || "pendiente"]) upd.envio_estado = en.envio_estado; if (en.envio_seguimiento) upd.envio_seguimiento = en.envio_seguimiento; }
          if (Object.keys(upd).length) await admin.from("ventas").update({ ...upd, envio_actualizado: ahora }).eq("id", ya.venta_id);
        }
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
        const linea: any = { variante_id: it?.variante_id || null, producto_id, descripcion: pr.name, talle: pr.variant_values?.[0] || null, color: pr.variant_values?.[1] || null, cantidad: cant, precio_lista: precio, precio_unit: precio, descuento_pct: 0, total: r2(precio * cant), costo_unit: costo };
        // kit (box/pack): los componentes "por producto" se resuelven con el talle/color que eligió la clienta en el canal;
        // los que no se pueden resolver van a la variante "sin definir" (el Conteo los acomoda después)
        if (producto_id) {
          const { data: prod } = await admin.from("productos").select("tipo").eq("id", producto_id).single();
          if (prod?.tipo === "kit") {
            const { data: comps } = await admin.from("v_componentes").select("variante_id,comp_producto_id,filtro,cantidad").eq("producto_id", producto_id);
            const vals: string[] = (pr.variant_values || []).map((x: any) => String(x).trim().toLowerCase());
            const componentes: any[] = [];
            for (const c of comps || []) {
              let vid: string | null = c.variante_id;
              if (!vid && c.comp_producto_id && !c.filtro) {
                const { data: cand } = await admin.from("v_variantes").select("id,talle_nombre,color_nombre").eq("producto_id", c.comp_producto_id).eq("activa", true);
                const n = (s: any) => String(s || "").trim().toLowerCase();
                const exacta = (cand || []).find((v: any) => vals.includes(n(v.talle_nombre)) && vals.includes(n(v.color_nombre)))
                  || (cand || []).find((v: any) => v.talle_nombre && vals.includes(n(v.talle_nombre)) && !v.color_nombre)
                  || ((cand || []).filter((v: any) => v.talle_nombre && vals.includes(n(v.talle_nombre))).length === 1 ? (cand || []).find((v: any) => v.talle_nombre && vals.includes(n(v.talle_nombre))) : null);
                vid = exacta?.id || null;
                if (!vid) { const { data: ind } = await admin.rpc("variante_indefinida", { p_producto: c.comp_producto_id }); vid = ind || null; }
              }
              if (!vid && c.filtro?.defecto_producto_id) { const { data: ind } = await admin.rpc("variante_indefinida", { p_producto: c.filtro.defecto_producto_id }); vid = ind || null; }
              if (vid) componentes.push({ variante_id: vid, cantidad: r2(cant * (+c.cantidad || 1)) });
            }
            if (componentes.length) linea.componentes = componentes;
          }
        }
        lineas.push(linea);
      }
      // el envío que pagó la clienta = total − (subtotal − descuento); la API de pedidos no lo trae como campo aparte
      const descuento = r2(+o.discount || 0);
      const prendas = r2(lineas.reduce((s, l) => s + l.total, 0));
      const envio = r2(Math.max(0, (+o.total || 0) - (prendas - descuento)));
      if (envio > 0) lineas.push({ variante_id: null, producto_id: null, descripcion: "Envío", talle: null, color: null, cantidad: 1, precio_lista: envio, precio_unit: envio, descuento_pct: 0, total: envio, costo_unit: 0 });
      const subtotal = r2(prendas + envio);
      const total = r2(subtotal - descuento);
      const ajuste = r2((+o.total || total) - total);   // redondeos del canal (normalmente 0)
      // el descuento del canal (p.ej. 20% por transferencia) se guarda como porcentaje sobre las prendas, con su motivo en la nota
      const descPct = prendas > 0 && descuento > 0 ? Math.round(10000 * descuento / prendas) / 100 : 0;
      const motivoDesc = descuento > 0 ? ` · descuento ${descPct}%${/transfer/i.test(o.gateway_name || o.gateway || "") ? " por transferencia" : ""}` : "";
      const payload = { empresa_id: e, offline_id: crypto.randomUUID(), tipo: "venta", estado: "completada", caja_id: null, turno_id: null, cliente_id: null, vendedora_id: null, lista_id: listaBase,
        descuento_pct: descPct, descuento, recargo: ajuste, nota: `Tienda Nube #${o.number}${motivoDesc}` + (o.note ? " · " + o.note : ""), origen: "tiendanube", referencia: String(o.number ?? o.id),
        lineas, pagos: [{ forma_pago_id: await formaPara(o.gateway_name || o.gateway), credito_id: null, monto: r2(total + ajuste), cuotas: +o.payment_details?.installments || 1, recargo_pct: 0, referencia: o.gateway_name || null }], creditos_a_emitir: [] };
      // clienta
      if (o.customer?.email || o.customer?.name) {
        const { data: cl } = o.customer?.email ? await admin.from("clientes").select("id").eq("empresa_id", e).eq("email", o.customer.email).maybeSingle() : { data: null };
        if (cl) payload.cliente_id = cl.id; else { const ins = await admin.from("clientes").insert({ empresa_id: e, nombre: o.customer?.name || "Clienta Tienda Nube", email: o.customer?.email || null, telefono: o.customer?.phone || null, documento: o.customer?.identification || null }).select().single(); if (ins.data) payload.cliente_id = ins.data.id; }
      }
      const { data: venta, error } = await admin.rpc("caja_registrar_venta", { p: payload });
      if (error) { problemas.push("No se pudo registrar: " + error.message); conProblema++; await admin.from("canal_pedidos").upsert({ ...datosPedido, problema: problemas.join(" · ") }, { onConflict: "conexion_id,pedido_ext" }); continue; }
      nuevos++; if (problemas.length) conProblema++;
      // gift card usada en la web: el cupón tiene el mismo código que la gift card de Percha → se le descuenta el saldo (tn-cupon)
      for (const cu of (o.coupon || [])) {
        const code = String(cu?.code || '').toUpperCase().replace(/\s+/g, ''); if (!code) continue;
        const { data: gc } = await admin.from('creditos').select('id,saldo,nota').eq('empresa_id', e).eq('tipo', 'gift_card').eq('codigo', code).maybeSingle();
        if (!gc || +gc.saldo <= 0) continue;
        const usado = Math.min(+gc.saldo, +(o.discount_coupon ?? cu.value ?? 0) || +gc.saldo), queda = Math.max(0, r2(+gc.saldo - usado));
        await admin.from('creditos').update({ saldo: queda, estado: queda <= 0 ? 'usado' : 'vigente', nota: [gc.nota, 'Usada en la web: pedido #' + o.number + ' (' + usado + ')'].filter(Boolean).join(' · ') }).eq('id', gc.id);
      }
      if (o.has_shippable_products !== false) { const en = envioDe(o); if (en.envio_costo == null) en.envio_costo = envio || null; await admin.from("ventas").update({ ...en, envio_actualizado: ahora }).eq("id", venta.id); }
      await admin.from("canal_pedidos").upsert({ ...datosPedido, venta_id: venta.id, problema: problemas.length ? problemas.join(" · ") : null }, { onConflict: "conexion_id,pedido_ext" });
    }
    if (!body.solo_pedido && !body.desde) await admin.from("conexiones").update({ ultima_sync_pedidos: ahora }).eq("id", cx.id);
    resumen.push({ conexion: cx.id, pedidos_leidos: pedidos.length, nuevos, anulados, con_problema: conProblema });
  }
  return json({ ok: true, resumen });
});
