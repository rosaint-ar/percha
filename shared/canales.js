/* Percha · Canales de venta (etiquetas de la venta): se crean en Configuración › Canales de venta (tabla venta_canales).
   La caja pone Local, los pedidos de la web entran como Tienda Nube, y cada venta se puede cambiar.
   CANALES.cargar(e) → [{k, n, color, online}] · CANALES.nombre(lista, k) · CANALES.chip(lista, k) */
(function () {
  const NOMBRES = { local: 'Local', whatsapp: 'WhatsApp', tiendanube: 'Tienda Nube', mercadolibre: 'Mercado Libre', shopify: 'Shopify', woocommerce: 'WooCommerce', online: 'Otra venta online' };
  let cache = null;
  async function cargar(e) {
    if (cache) return cache;
    let filas = [];
    try { const r = await sb.from('venta_canales').select('clave,nombre,color,online,activo,orden').eq('empresa_id', e).order('orden'); filas = r.data || []; } catch (_) { }
    if (filas.length) return cache = filas.map(c => ({ k: c.clave, n: c.nombre, color: c.color, online: c.online, activo: c.activo }));
    // sin tabla todavía: Local, WhatsApp y cada conexión
    let cx = []; try { const r = await sb.from('conexiones').select('canal,nombre').eq('empresa_id', e); cx = r.data || []; } catch (_) { }
    const lista = [{ k: 'local', n: 'Local', activo: true }, { k: 'whatsapp', n: 'WhatsApp', online: true, activo: true }];
    cx.forEach(c => { if (!lista.some(x => x.k === c.canal)) lista.push({ k: c.canal, n: NOMBRES[c.canal] || c.nombre || c.canal, online: true, activo: true }); });
    return cache = lista;
  }
  const buscar = (lista, k) => (lista || []).find(x => x.k === (k || 'local'));
  const nombre = (lista, k) => (buscar(lista, k) || { n: NOMBRES[k] || k || 'Local' }).n;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  // etiqueta de color: el color del canal de fondo suave y el texto en el mismo color
  const chip = (lista, k) => { const c = buscar(lista, k), col = c && /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : null;
    return `<span class="canal ${esc(k || 'local')}"${col ? ` style="background:${col}1f;color:${col};border-color:${col}55"` : ''}>${esc(nombre(lista, k))}</span>`; };
  const activos = lista => (lista || []).filter(x => x.activo !== false);
  window.CANALES = { cargar, nombre, chip, activos, borrarCache: () => { cache = null; } };
})();
