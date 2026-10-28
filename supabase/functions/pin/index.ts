// pin · entrar con un PIN de 4 números en un equipo ya autorizado.
// La primera vez se entra con correo y contraseña y se activa el PIN: el equipo recibe una llave propia (larga, al azar)
// que guarda en el navegador. Para entrar con PIN hacen falta las dos cosas: la llave de ESE equipo y el PIN.
// 5 PIN mal seguidos → el PIN de ese equipo se apaga y hay que volver a entrar con la contraseña.
// Acciones: { accion: 'activar', pin, equipo?, reemplazar? }  (con sesión)  → { id, llave }
//           { accion: 'entrar', id, llave, pin }                (sin sesión)  → { token_hash } para sb.auth.verifyOtp
//           { accion: 'quitar', id, llave }                     (sin sesión)  → apaga el PIN de ese equipo
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
const MAX_INTENTOS = 5;

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const azar = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function pbkdf2(pin: string, sal: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(sal), iterations: 100000 }, k, 256));
}
// comparación que tarda lo mismo acierte o no
const igual = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Usá POST" }, 405);
  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: "Cuerpo inválido" }, 400); }
  const admin = createClient(URL, SERVICE);
  const { accion } = body;

  if (accion === "activar") {
    const auth = req.headers.get("Authorization") || "";
    const quien = await usuarioDe(auth);
    if (typeof quien === "string") return json({ error: "Primero entrá con tu contraseña (" + quien + ")" }, 401);
    const user = quien;
    const pin = String(body.pin || "");
    if (!/^\d{4}$/.test(pin)) return json({ error: "El PIN tiene que ser de 4 números" }, 400);
    // si este equipo ya tenía un PIN de esta persona, se reemplaza
    if (body.reemplazar) await admin.from("pin_equipos").update({ activo: false }).eq("id", body.reemplazar).eq("user_id", user.id);
    const llave = azar(32), sal = azar(16);
    const { data, error } = await admin.from("pin_equipos").insert({ user_id: user.id, llave_hash: await sha256(llave), pin_hash: await pbkdf2(pin, sal), pin_sal: sal, equipo: String(body.equipo || "").slice(0, 80) || null }).select("id").single();
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, id: data.id, llave });
  }

  if (accion === "entrar" || accion === "quitar") {
    const { id, llave } = body;
    if (!id || !llave || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Este equipo no tiene PIN" }, 400);
    const { data: r } = await admin.from("pin_equipos").select("*").eq("id", id).maybeSingle();
    if (!r || !igual(r.llave_hash, await sha256(String(llave)))) return json({ error: "Este equipo no tiene PIN. Entrá con tu contraseña.", sin_pin: true }, 403);
    if (accion === "quitar") { await admin.from("pin_equipos").update({ activo: false }).eq("id", id); return json({ ok: true }); }
    if (!r.activo) return json({ error: "El PIN de este equipo está apagado. Entrá con tu contraseña.", sin_pin: true }, 403);
    if (!igual(r.pin_hash, await pbkdf2(String(body.pin || ""), r.pin_sal))) {
      const n = r.intentos + 1;
      await admin.from("pin_equipos").update({ intentos: n, activo: n < MAX_INTENTOS }).eq("id", id);
      if (n >= MAX_INTENTOS) return json({ error: "PIN incorrecto 5 veces. Por seguridad, entrá con tu contraseña.", sin_pin: true }, 403);
      return json({ error: `PIN incorrecto. Te quedan ${MAX_INTENTOS - n} intento${MAX_INTENTOS - n === 1 ? "" : "s"}.` }, 403);
    }
    // la persona tiene que seguir activa en alguna empresa
    const { data: m } = await admin.from("empresa_usuarios").select("user_id").eq("user_id", r.user_id).eq("activo", true).limit(1);
    if (!m?.length) return json({ error: "Tu usuario está desactivado." }, 403);
    const { data: u } = await admin.auth.admin.getUserById(r.user_id);
    if (!u?.user?.email) return json({ error: "No encuentro tu usuario." }, 404);
    const { data: link, error: el } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
    if (el || !link?.properties?.hashed_token) return json({ error: el?.message || "No se pudo entrar" }, 400);
    await admin.from("pin_equipos").update({ intentos: 0, ultimo_uso: new Date().toISOString() }).eq("id", id);
    return json({ ok: true, token_hash: link.properties.hashed_token });
  }

  return json({ error: "Acción desconocida" }, 400);
});
