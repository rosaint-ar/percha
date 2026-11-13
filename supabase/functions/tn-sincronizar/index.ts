// tn-sincronizar · la lectura AUTOMÁTICA del catálogo de Tienda Nube (cron cada 30 min, x-cron-key): lo que se cambia en la
// web (publicaciones, talles y colores nuevos, nombres, SKU, categorías y FOTOS) llega solo a Percha y se cruza.
// La lógica es la misma del botón «Sincronizar» (tn-sync): _shared/catalogo.ts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sincronizarCatalogo } from "../_shared/catalogo.ts";
const URL = Deno.env.get("SUPABASE_URL")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Usá POST" }, 405);
  const admin = createClient(URL, SERVICE);
  let body: { conexion_id?: string }; try { body = await req.json(); } catch { body = {}; }
  const { data: ck } = await admin.from("app_config").select("valor").eq("clave", "cron_key").maybeSingle();
  if (!(req.headers.get("x-cron-key") && ck?.valor && req.headers.get("x-cron-key") === ck.valor)) return json({ error: "Solo el cron" }, 401);
  if (!body.conexion_id) {   // una vuelta por cada conexión activa (cada una en su propia llamada: no se suman los tiempos)
    const { data: cxs } = await admin.from("conexiones").select("id").eq("estado", "activa").eq("canal", "tiendanube");
    const res: any[] = [];
    for (const c of cxs || []) { const r = await fetch(`${URL}/functions/v1/tn-sincronizar`, { method: "POST", headers: { "Content-Type": "application/json", "x-cron-key": ck.valor }, body: JSON.stringify({ conexion_id: c.id }) }); res.push(await r.json().catch(() => ({ error: r.status }))); }
    return json({ ok: true, res });
  }
  const { data: cx } = await admin.from("conexiones").select("*").eq("id", body.conexion_id).maybeSingle();
  if (!cx) return json({ error: "Conexión inexistente" }, 404);
  if (cx.canal !== "tiendanube") return json({ error: "Por ahora solo Tienda Nube" }, 400);
  const { data: sec } = await admin.from("conexion_secretos").select("access_token").eq("conexion_id", cx.id).maybeSingle();
  if (!sec) return json({ error: "La conexión no tiene token: volvé a conectar" }, 400);
  const r = await sincronizarCatalogo(admin, cx, sec.access_token);
  return json(r, r.error ? (r.status || 500) : 200);
});
