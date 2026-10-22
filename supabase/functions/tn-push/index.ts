// tn-push · empuja a Tienda Nube el stock de Percha de lo que quedó en la cola (canal_cola).
// Lo llama el navegador después de vender/ajustar (fire-and-forget) y el cron cada minuto.
// Auth: sesión de un miembro de la empresa  o  header x-cron-key = secreto CRON_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const SB_URL = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, CRON_KEY = Deno.env.get("CRON_KEY") || "";
const UA = "Percha (rosaint.ar@gmail.com)";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(SB_URL, SERVICE);
  const body = await req.json().catch(() => ({}));
  let filtroEmpresa: string | null = null;
  // la clave del cron vive en app_config (tabla sin acceso desde el navegador); el env CRON_KEY es opcional
  const { data: ck } = await admin.from("app_config").select("valor").eq("clave", "cron_key").maybeSingle();
  const claveCron = CRON_KEY || ck?.valor || "";
  if (req.headers.get("x-cron-key") && claveCron && req.headers.get("x-cron-key") === claveCron) { /* cron: todas las empresas */ }
  else {
    const comoUsuario = createClient(SB_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await comoUsuario.auth.getUser();
    if (!user) return json({ error: "Sesión inválida" }, 401);
    if (!body.empresa_id) return json({ error: "Falta empresa_id" }, 400);
    const { data: ok } = await comoUsuario.rpc("es_miembro", { e: body.empresa_id });
    if (!ok) return json({ error: "No pertenecés a esta empresa" }, 403);
    filtroEmpresa = body.empresa_id;
  }
  // conexiones activas con empuje habilitado
  let qc = admin.from("conexiones").select("id,empresa_id,externo_id,canal,empujar_stock").eq("estado", "activa").eq("empujar_stock", true);
  if (filtroEmpresa) qc = qc.eq("empresa_id", filtroEmpresa);
  const { data: conexiones } = await qc;
  const resumen: Record<string, unknown>[] = [];
  for (const cx of conexiones || []) {
    if (cx.canal !== "tiendanube") continue;
    const { data: sec } = await admin.from("conexion_secretos").select("access_token").eq("conexion_id", cx.id).maybeSingle();
    if (!sec) continue;
    const { data: cola } = await admin.from("canal_cola").select("id,variante_id").eq("conexion_id", cx.id).eq("estado", "pendiente").lt("intentos", 5).order("id").limit(200);
    if (!cola || !cola.length) continue;
    const ids = [...new Set(cola.map((c: any) => c.variante_id))];
    const [{ data: stocks }, { data: items }] = await Promise.all([
      admin.from("v_variantes").select("id,stock").in("id", ids),
      admin.from("canal_items").select("id,variante_id,producto_ext,variante_ext,stock").eq("conexion_id", cx.id).in("variante_id", ids)
    ]);
    const stockDe = new Map((stocks || []).map((s: any) => [s.id, Math.max(0, Math.floor(+s.stock || 0))]));
    const headers = { Authentication: `bearer ${sec.access_token}`, "User-Agent": UA, "Content-Type": "application/json" };
    let ok = 0, err = 0;
    for (const fila of cola) {
      const destinos = (items || []).filter((i: any) => i.variante_id === fila.variante_id);
      const nuevo = stockDe.get(fila.variante_id) ?? 0;
      let fallo: string | null = null;
      // si varias variantes del canal apuntan a la misma de Percha (Boob Tape antes de dividir), el stock va a la primera y el resto en 0
      for (let k = 0; k < destinos.length; k++) {
        const d = destinos[k]; const valor = k === 0 ? nuevo : 0;
        if (+d.stock === valor) continue;
        const r = await fetch(`https://api.tiendanube.com/2025-03/${cx.externo_id}/products/${d.producto_ext}/variants/${d.variante_ext}`, { method: "PUT", headers, body: JSON.stringify({ stock: valor }) });
        if (!r.ok) { fallo = `${r.status} ${(await r.text()).slice(0, 200)}`; break; }
        await admin.from("canal_items").update({ stock: valor, actualizado: new Date().toISOString() }).eq("id", d.id);
      }
      if (fallo) { err++; await admin.from("canal_cola").update({ intentos: (fila as any).intentos + 1 || 1, error: fallo, estado: ((fila as any).intentos || 0) + 1 >= 5 ? "error" : "pendiente" }).eq("id", fila.id); }
      else { ok++; await admin.from("canal_cola").update({ estado: "hecho", hecho: new Date().toISOString(), error: null }).eq("id", fila.id); }
    }
    resumen.push({ conexion: cx.id, actualizadas: ok, errores: err });
  }
  return json({ ok: true, resumen });
});
