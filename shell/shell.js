/* Percha · shell común: sesión, empresa activa, barra lateral, tema por empresa, utilidades.
   Cada página declara <meta name="app-root" content="../"> y <body data-page="id" data-title="…" data-subtitle="…">.
   Carga: shell.css, supabase-js (CDN), shared/supabase.js y después este archivo. */
(function () {
  const ROOT = (document.querySelector('meta[name="app-root"]') || {}).content || './';
  const body = document.body;
  const SISTEMA = 'Percha';

  // ---------- tipografías e ícono ----------
  (function cabecera() {
    const add = (tag, attrs) => { const el = document.createElement(tag); Object.assign(el, attrs); document.head.appendChild(el); return el; };
    add('link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' });
    const pc = add('link', { rel: 'preconnect', href: 'https://fonts.gstatic.com' }); pc.crossOrigin = 'anonymous';
    add('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap' });
    if (!document.querySelector('link[rel="icon"]')) add('link', { rel: 'icon', type: 'image/svg+xml', href: ROOT + 'shell/percha.svg' });
  })();

  // ---------- íconos (trazo, 24x24) ----------
  const I = {
    ayuda: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M6 21h13"/><path d="M9 7h6M9 11h4"/></svg>',
    percha: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M32 24c-5 0-8-3-8-7s3.5-7 8-7 8 3 8 7c0 3-2 5-5 6.5"/><path d="M32 24v5"/><path d="M32 29 8 44c-2 1.3-1.2 4.5 1.3 4.5h45.4c2.5 0 3.3-3.2 1.3-4.5L32 29z"/></svg>',
    inicio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>',
    catalogo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.3"/></svg>',
    etiquetas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 5v14M8 5v14M11 5v14M15 5v14M18 5v14M20 5v14"/></svg>',
    conteo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M8.5 12l2 2 4-4M8.5 17h7"/></svg>',
    pos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5M7 8h4M7 11h6"/></svg>',
    caja: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M7 12h.01M17 12h.01"/></svg>',
    envios: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>',
    compras: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6.5"/><circle cx="9.5" cy="20" r="1.2"/><circle cx="16.5" cy="20" r="1.2"/></svg>',
    informes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    config: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    conexiones: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19"/></svg>',
    salir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17l5-5-5-5M15 12H3M13 4h6v16h-6"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    buscar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
  };

  // ---------- utilidades ----------
  const fmtPesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  const fmtNum = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
  const fmtDec = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
  const fmt = {
    pesos: n => fmtPesos.format(Math.round(+n || 0)),
    num: n => fmtNum.format(+n || 0),
    dec: n => fmtDec.format(+n || 0),
    pct: n => (Math.round((+n || 0) * 10) / 10).toLocaleString('es-AR', { minimumFractionDigits: 1 }) + '%',
    fecha: d => d ? new Date(d).toLocaleDateString('es-AR') : '',
    fechaHora: d => d ? new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', ' ·') : ''
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  let toastTimer;
  function toast(msg, tipo) {
    let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; body.appendChild(t); }
    t.textContent = msg; t.className = 'ver' + (tipo === 'error' ? ' error' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = '', tipo === 'error' ? 5000 : 2600);
  }
  function modal(html, opciones) {
    const fondo = document.createElement('div'); fondo.className = 'modal-fondo';
    fondo.innerHTML = `<div class="modal" role="dialog">${html}</div>`;
    fondo.cerrar = () => fondo.remove();
    fondo.addEventListener('click', e => { if (e.target === fondo && !(opciones && opciones.fijo)) fondo.cerrar(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { fondo.cerrar(); document.removeEventListener('keydown', esc); } });
    body.appendChild(fondo);
    const primero = fondo.querySelector('input,select,textarea,button'); if (primero) primero.focus();
    return fondo;
  }
  function confirmar(texto, botonOk) {
    return new Promise(res => {
      const m = modal(`<p style="margin:0 0 4px">${esc(texto)}</p><div class="pie"><button class="btn" data-no>Cancelar</button><button class="btn primario" data-si>${esc(botonOk || 'Confirmar')}</button></div>`);
      $('[data-no]', m).onclick = () => { m.cerrar(); res(false); };
      $('[data-si]', m).onclick = () => { m.cerrar(); res(true); };
    });
  }
  function mensajeError(err) {
    const m = (err && (err.message || err.error_description || err.msg)) || String(err);
    if (/Invalid login credentials/i.test(m)) return 'El correo o la contraseña no son correctos.';
    if (/Email not confirmed/i.test(m)) return 'El correo todavía no está confirmado.';
    if (/duplicate key|already exists/i.test(m)) return 'Ya existe un registro con ese dato.';
    if (/row-level security|permission denied/i.test(m)) return 'No tenés permiso para hacer eso.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Sin conexión. Revisá internet e intentá de nuevo.';
    return m;
  }
  const iniciales = s => String(s || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

  const APP = { root: ROOT, sistema: SISTEMA, iconos: I, fmt, esc, $, $$, toast, modal, confirmar, mensajeError, iniciales, empresa: null, empresas: [], rol: null, user: null };
  window.APP = APP;
  // cerrar sesión: borra la sesión de ESTE equipo sin depender del servidor (si el servidor fallaba, quedaba adentro)
  APP.salir = async () => {
    try { await sb.auth.signOut({ scope: 'local' }); } catch (_) { }
    try { Object.keys(localStorage).filter(k => /^sb-.*-auth-token/.test(k)).forEach(k => localStorage.removeItem(k)); } catch (_) { }
    location.replace(ROOT + 'login.html');
  };

  // ---------- sesión y empresa ----------
  async function requireSession() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace(ROOT + 'login.html?next=' + encodeURIComponent(location.pathname + location.search)); return null; }
    return session;
  }
  async function cargarEmpresas() {
    const { data, error } = await sb.rpc('mis_empresas');
    if (error) { toast(mensajeError(error), 'error'); return []; }
    return data || [];
  }
  function elegirEmpresa(empresas) {
    const guardada = localStorage.getItem('percha_empresa') || localStorage.getItem('augusta_empresa');
    return empresas.find(e => e.id === guardada) || empresas[0] || null;
  }
  async function cargarRol(empresaId) {
    const { data } = await sb.from('empresa_usuarios').select('rol,nombre').eq('empresa_id', empresaId).eq('user_id', APP.user.id).maybeSingle();
    return data || { rol: 'visor', nombre: APP.user.email };
  }

  // ---------- tema por empresa (solo colores; el logo nunca va en el sistema) ----------
  function hexARgb(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return null; const n = parseInt(m[1], 16); return `${n >> 16},${(n >> 8) & 255},${n & 255}`; }
  function aplicarTema() {
    const tema = (APP.empresa.config || {}).tema || {};
    if (hexARgb(tema.color)) { document.documentElement.style.setProperty('--acento', tema.color); document.documentElement.style.setProperty('--acento-rgb', hexARgb(tema.color)); }
    APP.tema = tema;
  }

  // ---------- barra lateral ----------
  const MENU = [
    { grupo: 'Operación' },
    { id: 'inicio', label: 'Inicio', href: 'index.html', icono: 'inicio', p: 'inicio' },
    { id: 'pos', label: 'Punto de venta', href: 'caja/pos.html', icono: 'pos', p: 'vender' },
    { id: 'caja', label: 'Caja', href: 'caja/caja.html', icono: 'caja', p: 'vender' },
    { id: 'ventas', label: 'Ventas', href: 'caja/ventas.html', icono: 'informes', p: ['ventas_todas', 'ventas_propias'] },
    { id: 'envios', label: 'Envíos', href: 'caja/envios.html', icono: 'envios', p: 'vender' },
    { id: 'productos', label: 'Catálogo', href: 'catalogo/productos.html', icono: 'catalogo', p: 'catalogo_ver' },
    { id: 'etiquetas', label: 'Etiquetas', href: 'catalogo/etiquetas.html', icono: 'etiquetas', p: 'catalogo_editar' },
    { id: 'inventario', label: 'Inventario', href: 'catalogo/inventario.html', icono: 'conteo', p: 'catalogo_ver' },
    { id: 'compras', label: 'Compras', href: 'compras/compras.html', icono: 'compras', p: 'compras' },
    { grupo: 'Análisis', p: 'inicio' },
    { id: 'informes', label: 'Informes', href: '#', icono: 'informes', prox: true, p: 'inicio' },
    { grupo: 'Sistema', p: ['conexiones', 'configuracion'] },
    { id: 'conexiones', label: 'Conexiones', href: 'conexiones/conexiones.html', icono: 'conexiones', p: 'conexiones' },
    { id: 'configuracion', label: 'Configuración', href: 'configuracion/empresa.html', icono: 'config', p: 'configuracion' },
    { grupo: 'Ayuda', p: 'instructivo' },
    { id: 'instructivo', label: 'Instructivo', href: 'ayuda/instructivo.html', icono: 'ayuda', p: 'instructivo' }
  ];
  // qué permiso pide cada pantalla (data-page del body); la primera permitida es adonde se manda a quien no puede
  const PERMISO_PAGINA = { instructivo: 'instructivo', inicio: 'inicio', pos: 'vender', caja: 'vender', ventas: ['ventas_todas', 'ventas_propias'], envios: 'vender', productos: 'catalogo_ver', catalogo: 'catalogo_ver', etiquetas: 'catalogo_editar', inventario: 'catalogo_ver', conteo: 'catalogo_editar', compras: 'compras', conexiones: 'conexiones', configuracion: 'configuracion' };
  const permite = p => !p || [].concat(p).some(k => APP.puede(k));
  function pintarLateral() {
    const pagina = body.dataset.page, esAdmin = APP.esAdmin;
    const items = MENU.filter(m => permite(m.p)).map(m => {
      if (m.grupo) return `<div class="grupo">${m.grupo}</div>`;
      const cls = [m.id === pagina ? 'on' : '', m.prox ? 'prox' : ''].join(' ').trim();
      return `<a class="${cls}" href="${m.prox ? '#' : ROOT + m.href}" ${m.prox ? 'title="Próximamente" onclick="return false"' : ''}>${I[m.icono]}<span>${m.label}</span>${m.prox ? '<span class="pronto">PRONTO</span>' : ''}</a>`;
    }).join('');
    const selector = APP.empresas.length > 1
      ? `<select id="sel-empresa" title="Cambiar de empresa">${APP.empresas.map(e => `<option value="${e.id}" ${e.id === APP.empresa.id ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</select>`
      : `<b>${esc(APP.empresa.nombre)}</b>`;
    const lateral = document.createElement('aside');
    lateral.className = 'lateral';
    lateral.innerHTML = `
      <a class="producto" href="${ROOT}index.html"><span class="icono">${I.percha}</span><span><b>${SISTEMA}</b><small>sistema de gestión</small></span></a>
      <nav>${items}</nav>
      <div class="pie">
        <div class="cuenta"><span class="avatar">${esc(iniciales(APP.empresa.nombre))}</span><div class="datos">${selector}<span>${esc(APP.miembro.nombre || APP.user.email)} · ${esc(rolNombre(APP.rol))}</span></div><button class="salir" id="btn-salir" title="Cerrar sesión">${I.salir}</button></div>
      </div>`;
    const telon = document.createElement('div'); telon.className = 'telon'; telon.onclick = () => body.classList.remove('lateral-abierta');
    // contenido: barra superior + main existente
    const main = $('main.app') || (() => { const m = document.createElement('main'); m.className = 'app'; body.appendChild(m); return m; })();
    const contenido = document.createElement('div'); contenido.className = 'contenido';
    const tituloPlano = (body.dataset.title || '').replace(/<[^>]+>/g, '');
    const barra = document.createElement('div'); barra.className = 'barra-superior';
    barra.innerHTML = `<button class="menu" id="btn-menu" title="Menú">${I.menu}</button><div class="miga"><span>${esc(APP.empresa.nombre)}</span><span>/</span><b>${esc(tituloPlano || 'Inicio')}</b></div><button class="pildora-pend" data-pendientes hidden title="">📌 <b></b> pendientes</button><div class="reloj" id="reloj"></div>`;
    body.insertBefore(contenido, main); contenido.appendChild(barra); contenido.appendChild(main);
    body.prepend(lateral); body.appendChild(telon); body.classList.add('con-lateral');
    $('#btn-menu').onclick = () => body.classList.toggle('lateral-abierta');
    const sel = $('#sel-empresa'); if (sel) sel.onchange = () => { localStorage.setItem('percha_empresa', sel.value); location.reload(); };
    $('#btn-salir').onclick = () => APP.salir();
    const reloj = () => { $('#reloj').textContent = new Date().toLocaleString('es-AR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(/\./g, ''); };
    reloj(); setInterval(reloj, 30000);
    if (body.dataset.title && !$('.cab-pagina', main)) {
      const cab = document.createElement('div'); cab.className = 'cab-pagina';
      cab.innerHTML = `<div>${body.dataset.etq ? `<p class="etq">${esc(body.dataset.etq)}</p>` : ''}<h1>${body.dataset.title}</h1>${body.dataset.subtitle ? `<p class="sub">${esc(body.dataset.subtitle)}</p>` : ''}</div><div class="acciones" id="acciones-pagina"></div>`;
      main.prepend(cab);
    }
  }
  // Pendientes: tareas que quedaron para después (prendas vendidas sin definir, stock para revisar). Siempre a la vista, sin molestar.
  function iniciarPendientes() {
    if (APP.rol === 'visor') return;
    document.addEventListener('click', ev => { const b = ev.target.closest('[data-pendientes]'); if (b && window.PENDIENTES) PENDIENTES.abrir(); });
    const s = document.createElement('script'); s.src = ROOT + 'shared/pendientes.js?v=' + ((document.querySelector('script[src*="shell.js"]') || {}).src || '').split('v=')[1];
    s.onload = () => { PENDIENTES.refrescar(); setInterval(PENDIENTES.refrescar, 180000); document.addEventListener('visibilitychange', () => { if (!document.hidden) PENDIENTES.refrescar(); }); };
    document.head.appendChild(s);
    APP.pendientes = { refrescar: () => window.PENDIENTES && PENDIENTES.refrescar(), abrir: () => window.PENDIENTES && PENDIENTES.abrir() };
  }
  // Avisos de pedidos online + sonidos: se cargan en todas las pantallas (los sonidos son de caja-fx.js)
  function iniciarAvisos() {
    if (!(APP.puede('ventas_todas') || APP.puede('vender'))) return;
    const v = ((document.querySelector('script[src*="shell.js"]') || {}).src || '').split('v=')[1] || '';
    const cargar = (src, listo) => { const s = document.createElement('script'); s.src = ROOT + src + '?v=' + v; s.onload = listo; document.head.appendChild(s); };
    const avisos = () => cargar('shared/avisos.js', () => AVISOS.iniciar());
    if (window.CAJAFX) avisos(); else cargar('shared/caja-fx.js', avisos);
  }
  function rolNombre(r) { return { duenio: 'Dueña', admin: 'Administración', vendedora: 'Vendedora', visor: 'Solo ver' }[r] || r; }

  // ---------- arranque ----------
  APP.ready = (async () => {
    const session = await requireSession();
    if (!session) return new Promise(() => {});
    APP.user = session.user;
    APP.empresas = await cargarEmpresas();
    APP.empresa = elegirEmpresa(APP.empresas);
    if (!APP.empresa) {
      body.innerHTML = `<main class="app"><div class="card"><h2>Sin empresa asignada</h2><p>Tu usuario (${esc(APP.user.email)}) todavía no pertenece a ninguna empresa. Pedile a quien administra el sistema que te agregue.</p><p><button class="btn" onclick="APP.salir()">Salir</button></p></div></main>`;
      return new Promise(() => {});
    }
    localStorage.setItem('percha_empresa', APP.empresa.id);
    APP.miembro = await cargarRol(APP.empresa.id);
    APP.rol = APP.miembro.rol;
    APP.esAdmin = ['duenio', 'admin'].includes(APP.rol);
    // permisos de este usuario (los de su rol + los que se le cambiaron en Configuración › Usuarios)
    { const { data: pm } = await sb.rpc('mis_permisos', { e: APP.empresa.id }); APP.permisos = pm || {}; }
    APP.puede = k => !!(APP.permisos || {})[k];
    // pantalla sin permiso: se va a la primera que sí pueda usar
    if (!permite(PERMISO_PAGINA[body.dataset.page])) { const ir = MENU.find(m => m.href && m.href !== '#' && !m.prox && permite(m.p)); if (ir) { location.replace(ROOT + ir.href); return new Promise(() => {}); } }
    aplicarTema();
    pintarLateral();
    document.title = ((body.dataset.title || '').replace(/<[^>]+>/g, '') || 'Inicio') + ' · ' + APP.empresa.nombre + ' · ' + SISTEMA;
    iniciarPendientes();
    iniciarAvisos();
    return APP;
  })();

  // WhatsApp con texto: se abre la app directo (whatsapp://). La página intermedia de api.whatsapp.com/wa.me sin número
  // rompe los emojis (se ven como �). Además el texto queda copiado, por si se usa WhatsApp Web.
  APP.whatsapp = texto => {
    try { navigator.clipboard.writeText(texto); } catch (_) { }
    location.href = 'whatsapp://send?text=' + encodeURIComponent(texto);
    toast('Abriendo WhatsApp… (el texto también quedó copiado)');
  };
  APP.de = tabla => sb.from(tabla).select('*').eq('empresa_id', APP.empresa.id);
  APP.conEmpresa = obj => Object.assign({ empresa_id: APP.empresa.id }, obj);

  // ================= Herramientas comunes de toda la plataforma =================
  // 1) Ventana para agregar o editar: APP.formulario({ titulo, campos: [{ k, label, tipo: 'text'|'number'|'select'|'color'|'textarea', opciones: [[valor, texto]], valor, requerido, ayuda, placeholder, ancho: 'c2' }], boton })
  //    Devuelve los datos (o null si se canceló). Si hay "alGuardar", se llama con los datos y si tira error la ventana sigue abierta.
  APP.formulario = ({ titulo, sub, campos, boton, alGuardar }) => new Promise(res => {
    const campo = c => {
      const id = 'f-' + c.k, val = c.valor == null ? '' : c.valor, req = c.requerido ? ' required' : '';
      let ctl;
      if (c.tipo === 'select') ctl = `<select id="${id}"${req}>${(c.opciones || []).map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
      else if (c.tipo === 'textarea') ctl = `<textarea id="${id}" rows="3" placeholder="${esc(c.placeholder || '')}"${req}>${esc(val)}</textarea>`;
      else ctl = `<input id="${id}" type="${c.tipo || 'text'}" value="${esc(val)}" placeholder="${esc(c.placeholder || '')}"${c.tipo === 'number' ? ' step="any"' : ''}${req}>`;
      return `<div class="campo${c.ancho === 'c2' ? ' c2' : ''}"><label for="${id}">${esc(c.label)}${c.requerido ? ' *' : ''}</label>${ctl}${c.ayuda ? `<span class="ayuda">${esc(c.ayuda)}</span>` : ''}</div>`;
    };
    const m = modal(`<h2>${esc(titulo)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}<form class="form-modal">${campos.map(campo).join('')}<div class="pie"><button type="button" class="btn" data-no>Cancelar</button><button type="submit" class="btn primario" data-si>${esc(boton || 'Agregar')}</button></div></form>`);
    m.classList.add('con-formulario');
    const leer = () => { const d = {}; campos.forEach(c => { const el = $('#f-' + c.k, m); let v = el.value; if (c.tipo === 'number') v = v === '' ? null : +v; else if (typeof v === 'string') v = v.trim(); if (v === '' ) v = null; d[c.k] = v; }); return d; };
    $('[data-no]', m).onclick = () => { m.cerrar(); res(null); };
    $('form', m).onsubmit = async ev => {
      ev.preventDefault();
      const falta = campos.find(c => c.requerido && !String($('#f-' + c.k, m).value).trim()); if (falta) { toast('Completá: ' + falta.label, 'error'); $('#f-' + falta.k, m).focus(); return; }
      const d = leer(), b = $('[data-si]', m); b.disabled = true;
      if (alGuardar) { try { const r = await alGuardar(d); if (r === false) { b.disabled = false; return; } } catch (err) { toast(mensajeError(err), 'error'); b.disabled = false; return; } }
      m.cerrar(); res(d);
    };
    setTimeout(() => { const f = $('input,select,textarea', m); if (f) f.focus(); }, 30);
  });

  // 2) Autoguardado de tablas editables: cada fila con data-id, cada campo con data-k. Guarda solo el campo que cambió.
  //    APP.autoguardar(contenedor, tabla, { transformar(d, fila), alGuardar(fila, d) })
  APP.autoguardar = (cont, tabla, op = {}) => {
    const leer = el => { let v = el.type === 'checkbox' ? el.checked : el.value; if (v === 'true') v = true; else if (v === 'false') v = false; else if (el.type === 'number') v = v === '' ? null : +v; else if (typeof v === 'string') { v = v.trim(); if (v === '') v = null; } return v; };
    const guardar = async el => {
      const tr = el.closest('[data-id]'); if (!tr) return;
      let d = { [el.dataset.k]: leer(el) }; if (op.transformar) d = op.transformar(d, tr) || d;
      tr.classList.remove('guardado', 'error-guardar'); tr.classList.add('guardando');
      const r = await sb.from(tabla).update(d).eq('id', tr.dataset.id);
      tr.classList.remove('guardando');
      if (r.error) { tr.classList.add('error-guardar'); toast(mensajeError(r.error), 'error'); return; }
      tr.classList.add('guardado'); setTimeout(() => tr.classList.remove('guardado'), 1400);
      if (op.alGuardar) op.alGuardar(tr, d);
    };
    const tiempos = new WeakMap();
    cont.querySelectorAll('[data-k]').forEach(el => {
      if (el.tagName === 'SELECT' || el.type === 'checkbox') el.addEventListener('change', () => { if (el.value !== '__nuevo__') guardar(el); });
      else { el.addEventListener('input', () => { clearTimeout(tiempos.get(el)); tiempos.set(el, setTimeout(() => guardar(el), 700)); }); el.addEventListener('change', () => { clearTimeout(tiempos.get(el)); guardar(el); }); }
    });
  };

  // 3) Eliminar: si el registro ya se usó (tiene ventas, stock, etc.) no se puede borrar, entonces se desactiva.
  APP.eliminar = async (tabla, id, { nombre, campoActivo = 'activa' } = {}) => {
    if (!await confirmar(`¿Eliminar ${nombre ? '"' + nombre + '"' : 'este registro'}? Si ya se usó, queda desactivado para no perder el historial.`, 'Eliminar')) return null;
    const r = await sb.from(tabla).delete().eq('id', id);
    if (!r.error) { toast('Eliminado'); return 'eliminado'; }
    if (/foreign key|violates|referenc/i.test(r.error.message || '') || r.error.code === '23503') {
      const r2 = await sb.from(tabla).update({ [campoActivo]: false }).eq('id', id);
      if (r2.error) { toast(mensajeError(r2.error), 'error'); return null; }
      toast('Ya se usó en ventas o movimientos: quedó desactivado'); return 'desactivado';
    }
    toast(mensajeError(r.error), 'error'); return null;
  };

  // 5) Subir una imagen (logo, ícono): se achica en el navegador (lado máx. 'lado' px) y se guarda en la carpeta de la empresa. Devuelve la URL pública.
  APP.subirImagen = async (archivo, carpeta = 'imagenes', lado = 256) => {
    if (!archivo || !String(archivo.type).startsWith('image/')) throw new Error('Elegí una imagen (PNG, JPG, SVG o WebP)');
    let blob = archivo, ext = (archivo.name.split('.').pop() || 'png').toLowerCase();
    if (archivo.type !== 'image/svg+xml') {
      const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error('No se pudo leer la imagen')); i.src = URL.createObjectURL(archivo); });
      const k = Math.min(1, lado / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      blob = await new Promise(ok => c.toBlob(ok, 'image/png')); ext = 'png';
    }
    const ruta = `${APP.empresa.id}/${carpeta}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const r = await sb.storage.from('percha').upload(ruta, blob, { contentType: blob.type || 'image/png', upsert: false });
    if (r.error) throw r.error;
    return sb.storage.from('percha').getPublicUrl(ruta).data.publicUrl;
  };

  // 4) Listas desplegables con "+ Agregar…": al elegirla se abre la ventana para crear el valor nuevo y queda elegido.
  //    APP.selectConAgregar(select, { texto: '+ Agregar empresa…', crear: async () => ({ valor, texto }) | null })
  APP.selectConAgregar = (sel, { texto, crear }) => {
    if (sel.querySelector('option[value="__nuevo__"]')) return;
    sel.insertAdjacentHTML('beforeend', `<option value="__nuevo__">${esc(texto || '+ Agregar…')}</option>`);
    let previo = sel.value; sel.addEventListener('focus', () => { previo = sel.value; });
    sel.addEventListener('change', async () => {
      if (sel.value !== '__nuevo__') { previo = sel.value; return; }
      sel.value = previo;
      const nuevo = await crear(); if (!nuevo) return;
      const opt = document.createElement('option'); opt.value = nuevo.valor; opt.textContent = nuevo.texto;
      sel.insertBefore(opt, sel.querySelector('option[value="__nuevo__"]')); sel.value = nuevo.valor; previo = nuevo.valor;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

})();
