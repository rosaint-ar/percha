// usuarios-admin · alta y gestión de usuarios de una empresa.
// Solo puede llamarla un usuario con sesión que sea dueño/admin de esa empresa.
// Acciones: { accion: 'crear', empresa_id, email, nombre, rol, password? }  → crea (o encuentra) el usuario y lo vincula
//           { accion: 'resetear', empresa_id, user_id, password }           → cambia la contraseña de un miembro
//           { accion: 'email', empresa_id, user_id, email }                 → cambia el correo con el que entra
//           { accion: 'listar', empresa_id }                                → { correos: { user_id: email } }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createRemoteJWKSet, jwtVerify } from "https://esm.sh/jose@5.9.6";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// quién llama: se valida la firma del token con las llaves públicas del proyecto (ES256); si no, se le pregunta a Auth
const JWKS = createRemoteJWKSet(new globalThis.URL(`${URL}/auth/v1/.well-known/jwks.json`));
async function usuarioDe(auth: string): Promise<{ id: string } | string> {
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || token === auth) return "Sin sesión";
  try { const { payload } = await jwtVerify(token, JWKS); if (payload.sub && payload.role === "authenticated") return { id: String(payload.sub) }; } catch (_) { /* sigue */ }
  const { data, error } = await createClient(URL, SERVICE).auth.getUser(token);
  return data?.user ? { id: data.user.id } : (error?.message || "Sesión inválida");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Usá POST" }, 405);
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sin sesión" }, 401);

  // Quién llama (con su propio token) y si administra la empresa
  const comoUsuario = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
  const quien = await usuarioDe(auth);
  if (typeof quien === "string") return json({ error: "Sesión inválida: " + quien }, 401);

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

  const esMiembro = async (uid: string) => {
    const { data: m } = await admin.from("empresa_usuarios").select("user_id").eq("empresa_id", empresa_id).eq("user_id", uid).maybeSingle();
    return !!m;
  };

  if (accion === "resetear") {
    const { user_id } = body; const password = body.password || genPass();
    if (password.length < 8) return json({ error: "La contraseña tiene que tener al menos 8 caracteres" }, 400);
    if (!(await esMiembro(user_id))) return json({ error: "Ese usuario no pertenece a la empresa" }, 404);
    const { error } = await admin.auth.admin.updateUserById(user_id, { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, password });
  }

  // cambiar el correo con el que entra (queda confirmado; la contraseña no cambia)
  if (accion === "email") {
    const { user_id } = body; const email = (body.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Ese correo no parece válido" }, 400);
    if (!(await esMiembro(user_id))) return json({ error: "Ese usuario no pertenece a la empresa" }, 404);
    const { error } = await admin.auth.admin.updateUserById(user_id, { email, email_confirm: true });
    if (error) return json({ error: /already|registered|exists/i.test(error.message) ? "Ese correo ya lo usa otro usuario" : error.message }, 400);
    return json({ ok: true });
  }

  // los correos de los miembros de la empresa (para mostrarlos en el panel)
  if (accion === "listar") {
    const { data: ms } = await admin.from("empresa_usuarios").select("user_id").eq("empresa_id", empresa_id);
    const correos: Record<string, string> = {};
    for (const m of ms || []) { const { data } = await admin.auth.admin.getUserById(m.user_id); if (data?.user?.email) correos[m.user_id] = data.user.email; }
    return json({ ok: true, correos });
  }
  return json({ error: "Acción desconocida" }, 400);
});
