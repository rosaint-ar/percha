// tn-callback · Tienda Nube vuelve acá después de que la dueña autoriza la app (GET ?code=…&state=…).
// Canjea el código por el token permanente, guarda la conexión y vuelve a Percha.
// Necesita en app_config: tn_app_id, tn_client_secret. Desplegar con --no-verify-jwt (lo llama Tienda Nube, sin sesión).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const SB_URL = Deno.env.get("SUPABASE_URL")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UA = "Percha (rosaint.ar@gmail.com)";
const volverA = (base: string, q: string) => new Response(null, { status: 302, headers: { Location: (base || "https://rosaint-ar.github.io/percha/conexiones/conexiones.html") + "?" + q } });

Deno.serve(async (req) => {
  try { return await manejar(req); } catch (err) { return new Response("Error en tn-callback: " + (err as Error).message, { status: 500 }); }
});
async function manejar(req: Request): Promise<Response> {
  const u = new URL(req.url); const code = u.searchParams.get("code"), estado = u.searchParams.get("state");
  const admin = createClient(SB_URL, SERVICE);
  const { data: volverRow } = estado ? await admin.from("app_config").select("valor").eq("clave", "tn_volver_" + estado).maybeSingle() : { data: null };
  const volver = volverRow?.valor || "";
  if (!code || !estado) return volverA(volver, "tn=error&detalle=" + encodeURIComponent("faltan datos de Tienda Nube"));
  const { data: st } = await admin.from("oauth_estados").select("*").eq("estado", estado).maybeSingle();
  if (!st) return volverA(volver, "tn=error&detalle=" + encodeURIComponent("el pedido de conexión venció; probá de nuevo"));
  const { data: cfg } = await admin.from("app_config").select("clave,valor").in("clave", ["tn_app_id", "tn_client_secret"]);
  const appId = (cfg || []).find((c: any) => c.clave === "tn_app_id")?.valor, secret = (cfg || []).find((c: any) => c.clave === "tn_client_secret")?.valor;
  if (!appId || !secret) return volverA(volver, "tn=error&detalle=" + encodeURIComponent("falta configurar la app de Percha"));
  const r = await fetch("https://www.tiendanube.com/apps/authorize/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA }, body: new URLSearchParams({ client_id: appId, client_secret: secret, grant_type: "authorization_code", code }) });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok || !tok.access_token) return volverA(volver, "tn=error&detalle=" + encodeURIComponent("Tienda Nube no entregó el acceso"));
  const storeId = String(tok.user_id);
  const s = await fetch(`https://api.tiendanube.com/2025-03/${storeId}/store`, { headers: { Authentication: `bearer ${tok.access_token}`, "User-Agent": UA } }).then((x) => x.json()).catch(() => ({}));
  const nombre = s?.name?.es || s?.name?.[Object.keys(s?.name || {})[0]] || `Tienda ${storeId}`;
  const { data: cx, error } = await admin.from("conexiones").upsert({ empresa_id: st.empresa_id, canal: "tiendanube", externo_id: storeId, nombre, url: s?.url_with_protocol || null, estado: "activa", ultimo_error: null }, { onConflict: "empresa_id,canal,externo_id" }).select().single();
  if (error || !cx) return volverA(volver, "tn=error&detalle=" + encodeURIComponent("no se pudo guardar la conexión"));
  await admin.from("conexion_secretos").upsert({ conexion_id: cx.id, access_token: tok.access_token, scope: tok.scope || null, actualizado: new Date().toISOString() });
  await admin.from("oauth_estados").delete().eq("estado", estado);
  await admin.from("app_config").delete().eq("clave", "tn_volver_" + estado);
  return volverA(volver, "tn=ok");
}
