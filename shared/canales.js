/* Percha · Canales de venta de la empresa: Local y WhatsApp siempre, más cada conexión (Tienda Nube, Mercado Libre…).
   Si una empresa no tiene Tienda Nube, no aparece. CANALES.cargar(e) → [{k, n}] */
(function () {
  const NOMBRES = { tiendanube: 'Tienda Nube', mercadolibre: 'Mercado Libre', shopify: 'Shopify', woocommerce: 'WooCommerce', online: 'Otra venta online' };
  let cache = null;
  async function cargar(e) {
    if (cache) return cache;
    let cx = []; try { const r = await sb.from('conexiones').select('canal,nombre').eq('empresa_id', e); cx = r.data || []; } catch (_) { }
    const lista = [{ k: 'local', n: 'Local' }, { k: 'whatsapp', n: 'WhatsApp' }];
    cx.forEach(c => { if (!lista.some(x => x.k === c.canal)) lista.push({ k: c.canal, n: NOMBRES[c.canal] || c.nombre || c.canal }); });
    return cache = lista;
  }
  const nombre = (lista, k) => (lista.find(x => x.k === k) || { n: NOMBRES[k] || k }).n;
  window.CANALES = { cargar, nombre };
})();
