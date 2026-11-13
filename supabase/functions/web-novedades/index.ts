// web-novedades · pública (la lee www.augustaintimates.com): qué publicaciones de la web son NOVEDAD y desde cuándo,
// para mostrarlas primero en las categorías y en el armador de packs (12/11, Diego). Ver sql/145.
// GET → { ok, novedades: [{ id: <id de la publicación en Tienda Nube>, desde: <fecha> }] } (lo más nuevo primero).
// Solo ids de publicación y fechas: nada interno. Se guarda 5 minutos en el navegador / CDN.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const TIENDA = "1142221";   // Augusta en Tienda Nube
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const { data: cx } = await db.from("conexiones").select("id").eq("canal", "tiendanube").eq("externo_id", TIENDA).eq("estado", "activa").maybeSingle();
    if (!cx) return new Response(JSON.stringify({ ok: true, novedades: [] }), { headers: { ...CORS, "Content-Type": "application/json" } });
    const { data, error } = await db.rpc("web_novedades", { p_conexion: cx.id, p_dias: 30 });
    if (error) throw error;
    const novedades = (data || []).map((r: any) => ({ id: Number(r.publicacion), desde: r.desde }));
    return new Response(JSON.stringify({ ok: true, novedades }), { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
  } catch (_) {
    return new Response(JSON.stringify({ ok: false, novedades: [] }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
