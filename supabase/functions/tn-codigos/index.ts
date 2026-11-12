// tn-codigos · PERCHA MANDA en los códigos: cada variante de Tienda Nube cruzada con una prenda de Percha lleva como
// SKU y MPN el código de esa prenda en Percha (12/11/2026, Diego: "percha manda, y modifica en tienda nube automáticamente").
// Mismo criterio que tn-publicar (sku = mpn = productos.codigo). Lo llama el cron cada 10 minutos (x-cron-key).
// Lee los códigos EN VIVO de la web (si alguien los cambia a mano en Tienda Nube, se vuelven a corregir).
// No toca: lo que no está cruzado, lo cruzado con un código general (BOMBIS «VARIAS», MEDIAS VARIAS) ni nada que no sea el código.
// body.simular = true: no escribe, devuelve lo que cambiaría. body.limite = N (máx. cambios por vuelta, 80 por defecto: así termina antes de que corte el cron).
// body.solo_ext = ["274965279", …]: solo esas publicaciones (para probar).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const SB_URL = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, CRON_KEY = Deno.env.get("CRON_KEY") || "";
const UA = "Percha (rosaint.ar@gmail.com)";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const inicio = Date.now();
  const admin = createClient(SB_URL, SERVICE);
  const body = await req.json().catch(() => ({}));
  let filtroEmpresa: string | null = null;
  const { data: ck } = await admin.from("app_config").select("valor").eq("clave", "cron_key").maybeSingle();
  const claveCron = CRON_KEY || ck?.valor || "";
  const esCron = req.headers.get("x-cron-key") && claveCron && req.headers.get("x-cron-key") === claveCron;
  if (!esCron) {
    const comoUsuario = createClient(SB_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await comoUsuario.auth.getUser();
    if (!user) return json({ error: "Sesión inválida" }, 401);
    if (!body.empresa_id) return json({ error: "Falta empresa_id" }, 400);
    const { data: ok } = await comoUsuario.rpc("es_admin", { e: body.empresa_id });
    if (!ok) return json({ error: "No administrás esta empresa" }, 403);
    filtroEmpresa = body.empresa_id;
  }
  const simular = !!body.simular;
  const limite = Math.max(1, Math.min(500, +body.limite || 80));
  const soloExt: string[] = Array.isArray(body.solo_ext) ? body.solo_ext.map(String) : [];
  const pag = async (q: () => any) => { let todo: any[] = []; for (let d = 0; ; d += 1000) { const { data, error } = await q().range(d, d + 999); if (error) throw error; todo = todo.concat(data || []); if (!data || data.length < 1000) break; } return todo; };

  let qc = admin.from("conexiones").select("id,empresa_id,externo_id,canal").eq("estado", "activa").eq("canal", "tiendanube");
  if (filtroEmpresa) qc = qc.eq("empresa_id", filtroEmpresa);
  const { data: conexiones } = await qc;
  const resumen: any[] = [];
  for (const cx of conexiones || []) {
    const { data: sec } = await admin.from("conexion_secretos").select("access_token").eq("conexion_id", cx.id).maybeSingle();
    if (!sec) continue;
    const headers = { Authentication: `bearer ${sec.access_token}`, "User-Agent": UA, "Content-Type": "application/json" };
    const base = `https://api.tiendanube.com/2025-03/${cx.externo_id}`;

    // ---- lo que dice Percha: código de la prenda de cada variante cruzada ----
    const items = await pag(() => admin.from("canal_items").select("id,producto_ext,variante_ext,variante_id,sku,mpn,nombre,valores").eq("conexion_id", cx.id).not("variante_id", "is", null));
    const productos = await pag(() => admin.from("productos").select("id,codigo,es_generico").eq("empresa_id", cx.empresa_id));
    const variantes = await pag(() => admin.from("variantes").select("id,producto_id").eq("empresa_id", cx.empresa_id));
    const prod = new Map(productos.map((p: any) => [p.id, p]));
    const prodDeVar = new Map(variantes.map((v: any) => [v.id, prod.get(v.producto_id)]));

    // ---- lo que dice la web ahora ----
    const web = new Map<string, { sku: string; mpn: string }>(); let completo = true;
    if (soloExt.length) {
      for (const pid of soloExt) { const r = await fetch(`${base}/products/${pid}?fields=id,variants`, { headers }); if (!r.ok) { completo = false; break; } const p = await r.json(); for (const v of p.variants || []) web.set(String(v.id), { sku: v.sku ?? "", mpn: v.mpn ?? "" }); await espera(300); }
    } else {
      for (let page = 1; page <= 50; page++) {
        const r = await fetch(`${base}/products?per_page=200&page=${page}&fields=id,variants`, { headers });
        if (r.status === 404) break; if (!r.ok) { completo = false; break; }
        const lote = await r.json(); if (!Array.isArray(lote) || !lote.length) break;
        for (const p of lote) for (const v of p.variants || []) web.set(String(v.id), { sku: v.sku ?? "", mpn: v.mpn ?? "" });
        if (lote.length < 200) break; await espera(300);
      }
    }
    if (!completo) { resumen.push({ conexion: cx.id, error: "No se pudo leer la web completa: no se cambió nada" }); continue; }

    // ---- qué hay que corregir ----
    const corregir: any[] = []; const cache: any[] = [];
    for (const it of items) {
      if (soloExt.length && !soloExt.includes(String(it.producto_ext))) continue;
      const p: any = prodDeVar.get(it.variante_id);
      if (!p || p.es_generico || !String(p.codigo || "").trim()) continue;
      const w = web.get(String(it.variante_ext)); if (!w) continue;   // ya no está en la web (tn-sync la borra)
      const cod = String(p.codigo).trim();
      if (w.sku !== cod || w.mpn !== cod) corregir.push({ it, cod, antes: w.sku });
      else if (it.sku !== cod || it.mpn !== cod) cache.push({ id: it.id, cod });
    }
    if (simular) { resumen.push({ conexion: cx.id, a_corregir: corregir.length, ejemplos: corregir.slice(0, 40).map((c) => `${c.it.nombre} · ${c.it.valores}: ${c.antes || "(vacío)"} → ${c.cod}`) }); continue; }

    // la copia local que ya coincide con la web
    for (const c of cache) await admin.from("canal_items").update({ sku: c.cod, mpn: c.cod }).eq("id", c.id);

    let ok = 0, err = 0, frenado = false; const detalle: string[] = []; const errores: string[] = [];
    for (const c of corregir.slice(0, limite)) {
      if (Date.now() - inicio > 110000) { frenado = true; break; }   // sigue en la próxima vuelta
      const r = await fetch(`${base}/products/${c.it.producto_ext}/variants/${c.it.variante_ext}`, { method: "PUT", headers, body: JSON.stringify({ sku: c.cod, mpn: c.cod }) });
      if (r.status === 429) { frenado = true; break; }
      if (!r.ok) { err++; errores.push(`${c.it.nombre} · ${c.it.valores}: ${r.status} ${(await r.text()).slice(0, 150)}`); await espera(600); continue; }
      await admin.from("canal_items").update({ sku: c.cod, mpn: c.cod }).eq("id", c.it.id);
      ok++; detalle.push(`${c.it.nombre} · ${c.it.valores}: ${c.antes || "(vacío)"} → ${c.cod}`);
      await espera(550);   // la web deja ~2 cambios por segundo
    }
    resumen.push({ conexion: cx.id, corregidas: ok, errores: err, faltan: Math.max(0, corregir.length - ok - err), frenado, cache: cache.length, cambios: detalle.slice(0, 60), detalle_errores: errores.slice(0, 20) });
  }
  return json({ ok: true, resumen });
});
