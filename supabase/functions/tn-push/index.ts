// tn-push · empuja a Tienda Nube el stock de Percha de lo que quedó en la cola (canal_cola).
// Lo llama el navegador después de vender/ajustar (fire-and-forget) y el cron cada minuto.
// Auth: sesión de un miembro de la empresa  o  header x-cron-key = secreto CRON_KEY.
// Kits (box/pack): cada variante del box en TN (L / Celeste) recibe el stock del componente en ese talle/color
//   = mín( stock de cada componente resuelto por talle/color ÷ cantidad ); los filtros cuentan todo lo que cumple el filtro.
// Prendas con falla (variantes.fallas): son solo del local, no se mandan a la web (stock web = stock − fallas).
// body.solo_productos = ["500123", …]: empuja solo esos productos (y sus kits), aunque la conexión tenga el empuje apagado.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const SB_URL = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, CRON_KEY = Deno.env.get("CRON_KEY") || "";
const UA = "Percha (rosaint.ar@gmail.com)";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const n = (s: unknown) => String(s ?? "").trim().toLowerCase();

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
  const soloProductos: string[] = Array.isArray(body.solo_productos) ? body.solo_productos.map(String) : [];
  let qc = admin.from("conexiones").select("id,empresa_id,externo_id,canal,empujar_stock").eq("estado", "activa");
  if (!soloProductos.length) qc = qc.eq("empujar_stock", true);
  if (filtroEmpresa) qc = qc.eq("empresa_id", filtroEmpresa);
  const { data: conexiones } = await qc;
  const resumen: Record<string, unknown>[] = [];
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
    } else {
      const { data: cola } = await admin.from("canal_cola").select("id,variante_id,intentos").eq("conexion_id", cx.id).eq("estado", "pendiente").lt("intentos", 5).order("id").limit(200);
      filas = cola || []; variantes = [...new Set(filas.map((c: any) => c.variante_id))];
    }
    if (!variantes.length) { resumen.push({ conexion: cx.id, actualizadas: 0, errores: 0 }); continue; }

    const { data: items } = await admin.from("canal_items").select("id,variante_id,producto_ext,variante_ext,stock,talle_canal,color_canal").eq("conexion_id", cx.id).in("variante_id", variantes);
    const { data: stocks } = await admin.from("v_variantes").select("id,producto_id,producto_tipo,stock,fallas").in("id", variantes);
    const infoVar = new Map((stocks || []).map((s: any) => [s.id, s]));
    // kits: componentes y variantes de los productos componentes (para resolver talle/color)
    const kitsIds = [...new Set((stocks || []).filter((s: any) => s.producto_tipo === "kit").map((s: any) => s.producto_id))];
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
    // stock que corresponde a un ítem del canal
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

    let ok = 0, err = 0; const detalle: string[] = [];
    const porVariante = new Map<string, any[]>();
    for (const d of items || []) { if (!porVariante.has(d.variante_id)) porVariante.set(d.variante_id, []); porVariante.get(d.variante_id)!.push(d); }
    for (const vid of variantes) {
      const destinos = porVariante.get(vid) || []; if (!destinos.length) continue;
      const v = infoVar.get(vid); const esKit = v?.producto_tipo === "kit";
      let fallo: string | null = null; const anterior = +destinos[0].stock;
      let enviado = 0;
      for (let k = 0; k < destinos.length; k++) {
        const d = destinos[k];
        // varias variantes del canal apuntando a la misma de Percha (sin kit): el stock va a la primera y el resto en 0
        const valor = esKit ? stockPara(d) : (k === 0 ? stockPara(d) : 0);
        if (k === 0) enviado = valor;
        if (+d.stock === valor) continue;
        const r = await fetch(`${base}/products/${d.producto_ext}/variants/${d.variante_ext}`, { method: "PUT", headers, body: JSON.stringify({ stock: valor }) });
        if (!r.ok) { fallo = `${r.status} ${(await r.text()).slice(0, 200)}`; break; }
        await admin.from("canal_items").update({ stock: valor, actualizado: new Date().toISOString() }).eq("id", d.id);
        detalle.push(`${d.producto_ext}/${d.variante_ext} ${d.talle_canal || ""} ${d.color_canal || ""}: ${d.stock} → ${valor}`);
      }
      const fila = filas.find((f: any) => f.variante_id === vid);
      if (fallo) { err++; if (fila) await admin.from("canal_cola").update({ intentos: (fila.intentos || 0) + 1, error: fallo, estado: (fila.intentos || 0) + 1 >= 5 ? "error" : "pendiente" }).eq("id", fila.id); }
      else { ok++; if (fila) await admin.from("canal_cola").update({ estado: "hecho", hecho: new Date().toISOString(), error: null, stock_anterior: anterior, stock_enviado: enviado }).eq("id", fila.id);
             else await admin.from("canal_cola").update({ estado: "hecho", hecho: new Date().toISOString(), error: "enviado a pedido" }).eq("conexion_id", cx.id).eq("variante_id", vid).eq("estado", "pendiente"); }
    }
    resumen.push({ conexion: cx.id, actualizadas: ok, errores: err, cambios: detalle });
  }
  return json({ ok: true, resumen });
});
