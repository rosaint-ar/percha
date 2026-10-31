// tn-cupon · el cupón de Tienda Nube de una gift card de Percha (31/10/2026, pedido de Emi: "que me pregunte cuál es el código y
// que me genere el cupón en la web por el monto, por tiempo indeterminado").
// La gift card vive en creditos (monto a precio de lista); en la web es un cupón de descuento con el MISMO código:
//   tipo monto fijo, 1 uso, sin vencimiento, combinable (como los que Emi cargaba a mano, ej. #AVEBLANCO).
// body: { empresa_id, credito_id, accion: 'crear' | 'sincronizar' }
//   crear:       crea el cupón con el saldo de la gift card y guarda su id en creditos.cupon_web.
//   sincronizar: si se usó en el local, el cupón pasa al saldo que queda; si no queda saldo (o se anuló), se apaga.
// Auth: sesión de alguien que vende en esa empresa. Sin Tienda Nube conectada responde { sin_web: true }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const SB_URL = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UA = "Percha (rosaint.ar@gmail.com)";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(SB_URL, SERVICE);
  const body = await req.json().catch(() => ({}));
  const comoUsuario = createClient(SB_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
  const { data: { user } } = await comoUsuario.auth.getUser();
  if (!user) return json({ error: "Sesión inválida" }, 401);
  const e = body.empresa_id;
  if (!e || (!body.credito_id && body.accion !== 'probar')) return json({ error: "Faltan datos" }, 400);
  const { data: ok } = await comoUsuario.rpc("puede", { e, k: "vender" });
  if (!ok) return json({ error: "Sin permiso" }, 403);
  const accion = body.accion || "crear";
  // probar: ¿la app puede leer los cupones de la tienda? (no toca nada)
  if (accion === "probar") {
    const { data: cx0 } = await admin.from("conexiones").select("id,externo_id").eq("empresa_id", e).eq("estado", "activa").eq("canal", "tiendanube").maybeSingle();
    if (!cx0) return json({ ok: true, sin_web: true });
    const { data: s0 } = await admin.from("conexion_secretos").select("access_token,scope").eq("conexion_id", cx0.id).maybeSingle();
    const r = await fetch(`https://api.tiendanube.com/2025-03/${cx0.externo_id}/coupons?per_page=1`, { headers: { Authentication: `bearer ${s0?.access_token}`, "User-Agent": UA } });
    return json({ ok: r.ok, status: r.status, scope: s0?.scope || null });
  }

  const { data: cr } = await admin.from("creditos").select("*").eq("id", body.credito_id).eq("empresa_id", e).maybeSingle();
  if (!cr) return json({ error: "No existe esa gift card" }, 404);
  if (cr.tipo !== "gift_card") return json({ error: "Solo las gift cards tienen cupón en la web" }, 400);
  const { data: cx } = await admin.from("conexiones").select("id,externo_id").eq("empresa_id", e).eq("estado", "activa").eq("canal", "tiendanube").maybeSingle();
  if (!cx) return json({ ok: true, sin_web: true });
  const { data: sec } = await admin.from("conexion_secretos").select("access_token").eq("conexion_id", cx.id).maybeSingle();
  if (!sec) return json({ error: "Sin acceso a la tienda" }, 400);
  const headers = { Authentication: `bearer ${sec.access_token}`, "User-Agent": UA, "Content-Type": "application/json" };
  const base = `https://api.tiendanube.com/2025-03/${cx.externo_id}`;
  const saldo = Math.max(0, +cr.saldo || 0), vale = cr.estado === "vigente" && saldo > 0;
  const guardar = (cw: any) => admin.from("creditos").update({ cupon_web: cw }).eq("id", cr.id);
  const error = async (r: Response) => { const t = await r.text(); let m = t; try { const j = JSON.parse(t); m = j.description || j.message || JSON.stringify(j); } catch (_) {} return `Tienda Nube (${r.status}): ${m}`.slice(0, 400); };

  if (accion === "crear") {
    if (cr.cupon_web?.id) return json({ ok: true, ya: true, cupon: cr.cupon_web });
    if (!vale) return json({ error: "La gift card no tiene saldo" }, 400);
    const r = await fetch(`${base}/coupons`, { method: "POST", headers, body: JSON.stringify({ code: cr.codigo, type: "absolute", value: saldo.toFixed(2), valid: true, max_uses: 1, combines_with_other_discounts: true, includes_shipping: false }) });
    if (!r.ok) { const m = await error(r); await guardar({ error: m, intento: new Date().toISOString() }); return json({ error: r.status === 403 || r.status === 401 ? "La app de Percha no tiene permiso para crear cupones en Tienda Nube (hay que habilitar «cupones» y volver a conectar)" : /code|exist|taken|already/i.test(m) ? `Ya hay un cupón "${cr.codigo}" en la web: elegí otro código` : m }, 400); }
    const c = await r.json();
    const cw = { id: c.id, codigo: c.code, conexion_id: cx.id, valido: true, valor: +c.value, creado: new Date().toISOString() };
    await guardar(cw);
    return json({ ok: true, cupon: cw });
  }
  if (accion === "sincronizar") {
    if (!cr.cupon_web?.id) return json({ ok: true, sin_cupon: true });
    const cambio = vale ? { value: saldo.toFixed(2), valid: true } : { valid: false };
    const r = await fetch(`${base}/coupons/${cr.cupon_web.id}`, { method: "PUT", headers, body: JSON.stringify(cambio) });
    if (!r.ok) { const m = await error(r); await guardar({ ...cr.cupon_web, error: m }); return json({ error: m }, 400); }
    const cw = { ...cr.cupon_web, valido: vale, valor: vale ? saldo : 0, error: undefined, actualizado: new Date().toISOString() };
    await guardar(cw);
    return json({ ok: true, cupon: cw });
  }
  return json({ error: "Acción inválida" }, 400);
});
