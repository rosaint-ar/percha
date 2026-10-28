/* Percha · Avisos: cuando entra un pedido online (Tienda Nube, etc.) mientras el sistema está abierto,
   suena una campanita suave, aparece una tarjeta con brillo y, si se permitió, una notificación del navegador.
   La campana 🔔 de la barra de arriba los prende o apaga en este equipo (localStorage 'percha_avisos'). */
(function () {
  const K_ON = 'percha_avisos', K_ULT = 'percha_aviso_ult';
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { } } };
  const activos = () => ls.get(K_ON) !== 'off';
  const NOMBRES = { tiendanube: 'Tienda Nube', mercadolibre: 'Mercado Libre', whatsapp: 'WhatsApp', online: 'online', shopify: 'Shopify' };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const pesos = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(+n || 0);

  const css = `.aviso-pedido{position:fixed;right:20px;bottom:20px;z-index:8000;width:320px;max-width:calc(100vw - 32px);background:var(--superficie-2);border:1px solid rgba(var(--acento-rgb),.35);
      border-radius:16px;padding:14px 16px;display:flex;gap:12px;align-items:center;cursor:pointer;text-decoration:none;color:var(--tinta);
      box-shadow:var(--sombra-flotante);animation:aviso-entra .45s cubic-bezier(.3,1.4,.5,1) both, aviso-brilla 2.4s ease-in-out .4s 2}
    .aviso-pedido .ic{font-size:26px;width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:var(--lila);flex:none}
    .aviso-pedido b{display:block;font-size:14px} .aviso-pedido small{color:var(--tinta-3);font-size:12.5px}
    .aviso-pedido .x{margin-left:auto;align-self:flex-start;border:0;background:none;color:var(--tinta-3);font-size:16px;cursor:pointer}
    .aviso-pedido.sale{animation:aviso-sale .3s ease-in forwards}
    .aviso-pedido+.aviso-pedido{bottom:auto}
    @keyframes aviso-entra{from{opacity:0;transform:translateY(20px) scale(.95)}to{opacity:1;transform:none}}
    @keyframes aviso-sale{to{opacity:0;transform:translateX(30px)}}
    @keyframes aviso-brilla{0%,100%{box-shadow:var(--sombra-flotante)}50%{box-shadow:var(--sombra-flotante),0 0 0 6px rgba(var(--acento-rgb),.18),0 0 32px rgba(var(--acento-rgb),.45)}}
    .btn-avisos{border:0;background:none;font-size:16px;cursor:pointer;padding:4px 8px;border-radius:8px;line-height:1}
    .btn-avisos:hover{background:var(--relleno)}
    @media (prefers-reduced-motion:reduce){.aviso-pedido{animation:none}}`;

  function mostrar(v) {
    const canal = NOMBRES[v.origen] || v.origen || 'online';
    if (window.CAJAFX) CAJAFX.sonido('pedido');
    const raiz = (window.APP && APP.root) || '';
    const a = document.createElement('a'); a.className = 'aviso-pedido'; a.href = raiz + 'caja/ventas.html';
    a.innerHTML = `<span class="ic">🛍️</span><span><b>¡Nuevo pedido en ${esc(canal)}!</b><small>Venta #${esc(v.numero)} · ${pesos(v.total)}</small></span><button class="x" title="Cerrar">✕</button>`;
    const fuera = () => { a.classList.add('sale'); setTimeout(() => a.remove(), 320); };
    a.querySelector('.x').onclick = ev => { ev.preventDefault(); ev.stopPropagation(); fuera(); };
    document.querySelectorAll('.aviso-pedido').forEach(x => x.remove());
    document.body.appendChild(a); setTimeout(fuera, 12000);
    // notificación del navegador (si se permitió), sobre todo útil con Percha minimizado
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(`Nuevo pedido en ${canal}`, { body: `Venta #${v.numero} · ${pesos(v.total)}`, icon: raiz + 'shell/percha.svg', tag: 'pedido-' + v.id });
        n.onclick = () => { window.focus(); location.href = raiz + 'caja/ventas.html'; n.close(); };
      }
    } catch (_) { }
  }

  async function revisar() {
    if (!activos() || !window.APP || !APP.empresa) return;
    const { data } = await sb.from('ventas').select('id,numero,total,origen,creado,creado_por').eq('empresa_id', APP.empresa.id)
      .neq('origen', 'local').neq('estado', 'anulada').order('creado', { ascending: false }).limit(5);
    const l = (data || []).filter(v => !v.creado_por || v.creado_por !== APP.user.id);   // las que cargó otra persona o entraron solas
    if (!l.length) return;
    const ult = ls.get(K_ULT);
    if (!ult) { ls.set(K_ULT, l[0].creado); return; }   // primera vez en este equipo: arranca desde ahora
    const nuevas = l.filter(v => v.creado > ult).reverse();
    if (!nuevas.length) return;
    ls.set(K_ULT, nuevas[nuevas.length - 1].creado);
    nuevas.slice(-1).forEach(mostrar);   // si entraron varias juntas, se avisa la última (y suena una sola vez)
  }

  function boton() {
    const barra = document.querySelector('.barra-superior'); if (!barra || barra.querySelector('.btn-avisos')) return;
    const b = document.createElement('button'); b.className = 'btn-avisos';
    const pintar = () => { b.textContent = activos() ? '🔔' : '🔕'; b.title = activos() ? 'Avisos de pedidos online prendidos (tocá para apagar)' : 'Avisos apagados (tocá para prender)'; };
    b.onclick = async () => {
      const on = !activos(); ls.set(K_ON, on ? 'on' : 'off'); pintar();
      if (on && 'Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (_) { } }
      if (window.APP) APP.toast(on ? 'Te aviso cuando entre un pedido online 🔔' : 'Avisos apagados');
      if (on && window.CAJAFX) CAJAFX.sonido('pedido');
    };
    pintar(); const reloj = barra.querySelector('#reloj'); barra.insertBefore(b, reloj || null);
  }

  function iniciar() {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    boton(); revisar(); setInterval(revisar, 45000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });
  }
  window.AVISOS = { iniciar, revisar, probar: () => mostrar({ id: 'prueba', numero: 123, total: 45600, origen: 'tiendanube' }) };
})();
