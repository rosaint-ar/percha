// tn-sync · el botón «Sincronizar catálogo» de Conexiones (sesión de un admin de la empresa). POST { conexion_id }
// Misma lógica que la lectura automática (tn-sincronizar): _shared/catalogo.ts — cruce, categorías y fotos.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sincronizarCatalogo } from "../_shared/catalogo.ts";
const URL = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Usá POST" }, 405);
  const comoUsuario = createClient(URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
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
  const r = await sincronizarCatalogo(admin, cx, sec.access_token);
  return json(r, r.error ? (r.status || 500) : 200);
});
