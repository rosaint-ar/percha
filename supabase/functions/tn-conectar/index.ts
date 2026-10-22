// tn-conectar · arma el link para instalar la app de Percha en la Tienda Nube de la empresa (OAuth).
// POST { empresa_id, volver }  → { url }
// Necesita en app_config: tn_app_id (id numérico de la app en partners.tiendanube.com).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const URL = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization") || "";
  const comoUsuario = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await comoUsuario.auth.getUser();
  if (!user) return json({ error: "Sesión inválida" }, 401);
  const body = await req.json().catch(() => ({}));
  if (!body.empresa_id) return json({ error: "Falta empresa_id" }, 400);
  const { data: esAdmin } = await comoUsuario.rpc("es_admin", { e: body.empresa_id });
  if (!esAdmin) return json({ error: "No administrás esta empresa" }, 403);
  const admin = createClient(URL, SERVICE);
  const { data: cfg } = await admin.from("app_config").select("clave,valor").in("clave", ["tn_app_id"]);
  const appId = (cfg || []).find((c: any) => c.clave === "tn_app_id")?.valor;
  if (!appId) return json({ error: "Falta configurar la app de Tienda Nube de Percha (tn_app_id). Pedíselo a quien administra Percha." }, 400);
  const estado = crypto.randomUUID();
  await admin.from("oauth_estados").insert({ estado, empresa_id: body.empresa_id, canal: "tiendanube", user_id: user.id });
  // la URL de vuelta queda guardada en el estado; la redirect_uri está configurada en la app
  await admin.from("app_config").upsert({ clave: "tn_volver_" + estado, valor: body.volver || "" });
  return json({ url: `https://www.tiendanube.com/apps/${appId}/authorize?state=${estado}` });
});
