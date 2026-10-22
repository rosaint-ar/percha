// usuarios-admin · alta y gestión de usuarios de una empresa.
// Solo puede llamarla un usuario con sesión que sea dueño/admin de esa empresa.
// Acciones: { accion: 'crear', empresa_id, email, nombre, rol, password? }  → crea (o encuentra) el usuario y lo vincula
//           { accion: 'resetear', empresa_id, user_id, password }           → cambia la contraseña de un miembro
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Usá POST" }, 405);
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sin sesión" }, 401);

  // Quién llama (con su propio token) y si administra la empresa
  const comoUsuario = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error: eu } = await comoUsuario.auth.getUser();
  if (eu || !user) return json({ error: "Sesión inválida" }, 401);

  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: "Cuerpo inválido" }, 400); }
  const { accion, empresa_id } = body;
  if (!empresa_id) return json({ error: "Falta empresa_id" }, 400);
  const { data: esAdmin } = await comoUsuario.rpc("es_admin", { e: empresa_id });
  if (!esAdmin) return json({ error: "No administrás esta empresa" }, 403);

  const admin = createClient(URL, SERVICE);
  const genPass = () => Math.random().toString(36).slice(2, 6) + "-" + Math.floor(1000 + Math.random() * 9000) + "-" + Math.random().toString(36).slice(2, 6);

  if (accion === "crear") {
    const email = (body.email || "").trim().toLowerCase(), nombre = (body.nombre || "").trim(), rol = body.rol || "vendedora";
    if (!email || !nombre) return json({ error: "Faltan correo o nombre" }, 400);
    if (!["duenio", "admin", "vendedora", "visor"].includes(rol)) return json({ error: "Rol inválido" }, 400);
    // ¿ya existe?
    let userId: string | null = null, password: string | null = null;
    const { data: lista } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existente = lista?.users.find((u) => (u.email || "").toLowerCase() === email);
    if (existente) userId = existente.id;
    else {
      password = body.password || genPass();
      const { data: nuevo, error: en } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nombre } });
      if (en || !nuevo.user) return json({ error: en?.message || "No se pudo crear" }, 400);
      userId = nuevo.user.id;
    }
    const { error: em } = await admin.from("empresa_usuarios").upsert({ empresa_id, user_id: userId, nombre, rol, activo: true });
    if (em) return json({ error: em.message }, 400);
    return json({ ok: true, user_id: userId, existia: !!existente, password });
  }

  if (accion === "resetear") {
    const { user_id } = body; const password = body.password || genPass();
    const { data: m } = await admin.from("empresa_usuarios").select("user_id").eq("empresa_id", empresa_id).eq("user_id", user_id).maybeSingle();
    if (!m) return json({ error: "Ese usuario no pertenece a la empresa" }, 404);
    const { error } = await admin.auth.admin.updateUserById(user_id, { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, password });
  }
  return json({ error: "Acción desconocida" }, 400);
});
