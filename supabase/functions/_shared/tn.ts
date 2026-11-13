// Lo común de las funciones de Tienda Nube (13/11/2026): el cliente de la API, cómo se leen los nombres, la configuración
// de cada conexión (Conexiones › Tienda Nube) y los avisos al instante (webhooks). Antes cada función tenía su copia y
// se desparejaban (el botón «Sincronizar» usaba una lógica vieja).
export const UA = "Percha (integracion Tienda Nube)";
export const API = "2025-03";
export const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const es = (v: unknown) => (v && typeof v === "object" ? ((v as Record<string, string>).es ?? Object.values(v as Record<string, string>)[0] ?? "") : String(v ?? ""));
// talles: XXL = 2XL, XXXL = 3XL (Percha usa 2XL/3XL; la web puede seguir diciendo XXL)
export const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/xxxxl/g, "4xl").replace(/xxxl/g, "3xl").replace(/xxl/g, "2xl");
// el talle de la web como lo nombra Percha (sql/139): «Único» solo = sin talle; «Único (35 - 41)» = «Único (35 al 41)»; «S a XL» = «S al XL»
export const talleClave = (s: unknown) => { const x = String(s ?? "").trim(); if (/^([uú]nic[oa]|talle [uú]nico)$/i.test(x)) return ""; return norm(x.replace(/\s*-\s*/g, " al ").replace(/\s+a\s+/gi, " al ")); };
// nombre del archivo de una foto sin lo que le agrega Tienda Nube («mwdmtl8m-8x5d1-66867da5…-1024-1024.png» → «mwdmtl8m-8x5d1»)
export const archivoBase = (u: unknown) => { const f = decodeURIComponent(String(u || "").split("?")[0].split("/").pop() || "").toLowerCase();
  return f.replace(/-[0-9a-f]{16,}-\d+-\d+\.[a-z0-9]+$/, "").replace(/-\d+-\d+\.[a-z0-9]+$/, "").replace(/\.[a-z0-9]+$/, ""); };
// la primera foto según el orden de la web (no según cómo viene la lista)
export const porPosicion = (ims: any[]) => [...(ims || [])].sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0) || +a.id - +b.id);
export const primeraImagen = (p: any) => porPosicion(p?.images)[0]?.src ?? null;

// ---- configuración de la conexión (conexiones.config; lo que falta toma estos valores) ----
export const CONFIG_DEFECTO = {
  fotos_desde_percha: true,      // también se pueden subir / borrar fotos desde Percha (van a la web)
  publicar_nuevos: true,         // una prenda o un color nuevo de Percha se crea solo en la web
  nuevos_ocultos: true,          // …oculto, para completar fotos y texto allá
  espera_min: 10,                // minutos sin cambios antes de subirla
  medidas: null as null | { peso: number; ancho: number; alto: number; profundidad: number },
  nuevos_ingresos_dias: 30,      // días en «Nuevos Ingresos» (0 = no se usa)
  codigos_percha: true,          // Percha pone su código como SKU/MPN en la web
};
export type ConfigTN = typeof CONFIG_DEFECTO;
export const configDe = (cx: any): ConfigTN => ({ ...CONFIG_DEFECTO, ...(cx?.config || {}) });

// ---- cliente de la API (reintenta si la web pide esperar) ----
export function clienteTN(storeId: string, token: string) {
  const headers = { Authentication: `bearer ${token}`, "User-Agent": UA, "Content-Type": "application/json" };
  const base = `https://api.tiendanube.com/${API}/${storeId}`;
  const tn = async (metodo: string, ruta: string, cuerpo?: unknown) => {
    for (let i = 0; i < 4; i++) {
      const r = await fetch(base + ruta, { method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
      if (r.status === 429) { await dormir(1500 * (i + 1)); continue; }
      const t = await r.text(); let d: any = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
      if (!r.ok) throw new Error(`Tienda Nube ${r.status}: ${typeof d === "string" ? d.slice(0, 200) : JSON.stringify(d).slice(0, 300)}`);
      return d;
    }
    throw new Error("Tienda Nube: demasiados pedidos seguidos");
  };
  return { tn, headers, base };
}

// ---- avisos al instante (webhooks) ----
// pedidos → tn-pedidos; productos y desinstalación de la app → tn-publicar. Los arma la conexión al conectarse
// (tn-callback) y el botón de Conexiones; solo se crean los que faltan.
export const AVISOS: Record<string, string> = {
  "order/paid": "tn-pedidos", "order/updated": "tn-pedidos", "order/cancelled": "tn-pedidos",
  "product/created": "tn-publicar", "product/updated": "tn-publicar", "product/deleted": "tn-publicar",
  "app/uninstalled": "tn-publicar",
};
export async function registrarAvisos(admin: any, cx: any, token: string, simular = false) {
  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const { data: wk } = await admin.from("app_config").select("valor").eq("clave", "tn_webhook_key").maybeSingle();
  if (!wk?.valor) return { error: "Falta la llave de avisos (app_config.tn_webhook_key)" };
  const { tn } = clienteTN(cx.externo_id, token);
  const hay: any[] = (await tn("GET", "/webhooks")) || [];
  const creados: string[] = [], ya: string[] = [];
  for (const [evento, fn] of Object.entries(AVISOS)) {
    const url = `${SB_URL}/functions/v1/${fn}?k=${wk.valor}`;
    if (hay.some((w: any) => w.event === evento && w.url === url)) { ya.push(evento); continue; }
    if (!simular) await tn("POST", "/webhooks", { event: evento, url });
    creados.push(evento);
  }
  return { creados, ya };
}
// ¿qué avisos tiene hoy la conexión? (sin mostrar la llave)
export async function estadoAvisos(admin: any, cx: any, token: string) {
  const { tn } = clienteTN(cx.externo_id, token);
  const hay: any[] = (await tn("GET", "/webhooks")) || [];
  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const nuestros = hay.filter((w: any) => String(w.url || "").startsWith(`${SB_URL}/functions/v1/`));
  return Object.keys(AVISOS).map((ev) => ({ evento: ev, activo: nuestros.some((w: any) => w.event === ev) }));
}
