/* Percha · Punto de venta: capa visual sobre caja.js (familias, grilla de prendas con foto, teclado numérico,
   buscador inteligente "fru cel" y la ventana "¿qué modelos se lleva?" para los genéricos como BOMBIS «VARIAS»).
   Toda la lógica de venta (carrito, promos, cobro, señas, cambios, turno, cola sin internet) vive en caja.js. */
APP.ready.then(async () => {
  const { fmt, esc, $, $$, toast, modal } = APP, e = APP.empresa.id;
  if (APP.rol === 'visor') return;
  const C = APP.caja;
  $('#pos-empresa').textContent = APP.empresa.nombre; $('#pos-avatar').textContent = APP.iniciales(APP.empresa.nombre);
  $('#btn-menu-pos').onclick = () => document.body.classList.toggle('lateral-abierta');
  const reloj = () => { $('#pos-reloj').textContent = new Date().toLocaleString('es-AR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(/\./g, ''); };
  reloj(); setInterval(reloj, 30000);
  const saludo = () => { const h = new Date().getHours(), nom = String((APP.miembro || {}).nombre || '').split(' ')[0];
    $('#pos-saludo').textContent = (h < 6 || h >= 20 ? 'Buenas noches' : h < 13 ? 'Buen día' : 'Buenas tardes') + (nom ? ', ' + nom : '') + ' 👋'; };
  saludo(); setInterval(saludo, 600000);

  // ================= Búsqueda inteligente =================
  // cada palabra escrita tiene que ser el comienzo de alguna palabra del nombre, código, color o talle: "fru cel" → FRU FRU · Celeste
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const tokens = s => norm(s).replace(/[«»()\/,.-]/g, ' ').split(/\s+/).filter(Boolean);
  const palabraCoincide = (toks, w) => toks.some(t => t.startsWith(w)) || (w.length >= 4 && toks.some(t => t.includes(w)));
  const textoProducto = vars => tokens(`${vars[0].producto_nombre} ${vars[0].producto_codigo}`);
  const textoVariante = v => tokens(`${v.talle_nombre || ''} ${v.color_nombre || ''}`);
  // devuelve [{pid, vars, variantesQueCoinciden}] para la búsqueda; sin texto devuelve todo
  function buscarModelos(q, filtro) {
    const palabras = tokens(q);
    const res = [];
    porProducto.forEach((vars, pid) => {
      if (filtro && !filtro(pid, vars)) return;
      if (!palabras.length) { res.push({ pid, vars, coinciden: [] }); return; }
      const tp = textoProducto(vars);
      const sobrantes = palabras.filter(w => !palabraCoincide(tp, w));   // lo que no está en el nombre tiene que estar en talle/color
      if (sobrantes.length === palabras.length) return;                   // nada del nombre coincide
      let coinciden = [];
      if (sobrantes.length) { coinciden = vars.filter(v => { const tv = textoVariante(v); return sobrantes.every(w => palabraCoincide(tv, w)); }); if (!coinciden.length) return; }
      res.push({ pid, vars, coinciden });
    });
    return res;
  }

  // ================= Familias y grilla =================
  let categorias = [], familia = 'top', porProducto = new Map(), masVendidos = [];
  const { data: cats } = await sb.from('categorias').select('id,nombre,orden').eq('empresa_id', e).eq('activa', true).order('orden').order('nombre');
  categorias = cats || [];
  // "Más vendidos" (últimos 90 días) es la vista de arranque: lo que más sale, a mano
  sb.rpc('pos_mas_vendidos', { p_empresa: e, p_dias: 90 }).then(({ data }) => { masVendidos = (data || []).map(x => x.producto_id); if (typeof pintarFamilias === 'function' && porProducto.size) { pintarFamilias(); pintarGrilla(); } });
  const LS_SINSTOCK = `percha_pos_sinstock_${e}`;
  $('#chk-sinstock').checked = localStorage.getItem(LS_SINSTOCK) === '1';
  $('#chk-sinstock').onchange = ev => { localStorage.setItem(LS_SINSTOCK, ev.target.checked ? '1' : '0'); pintarFamilias(); pintarGrilla(); };
  const sumaStock = vars => vars.reduce((s, v) => s + (+v.stock || 0), 0);
  const conStock = (pid, vars) => $('#chk-sinstock').checked || sumaStock(vars) > 0 || (C.productos[pid] || {}).es_generico;
  function agrupar() {
    porProducto = new Map();
    C.catalogo.forEach(v => { if (!porProducto.has(v.producto_id)) porProducto.set(v.producto_id, []); porProducto.get(v.producto_id).push(v); });
  }
  function pintarFamilias() {
    const cuenta = {}; porProducto.forEach((vars, pid) => { if (!conStock(pid, vars)) return; const c = (C.productos[pid] || {}).categoria_id || 'sin'; cuenta[c] = (cuenta[c] || 0) + 1; });
    const recientes = JSON.parse(localStorage.getItem(`percha_recientes_${e}`) || '[]');
    const total = Object.values(cuenta).reduce((s, n) => s + n, 0);
    const top = masVendidos.filter(pid => porProducto.has(pid) && conStock(pid, porProducto.get(pid))).length;
    const items = [{ id: 'top', nombre: '★ Más vendidos', n: Math.min(top, 48) }, ...(recientes.length ? [{ id: 'recientes', nombre: 'Recientes', n: recientes.length }] : []), ...categorias.filter(c => cuenta[c.id]).map(c => ({ id: c.id, nombre: c.nombre, n: cuenta[c.id] }))];
    $('#familias').innerHTML = items.map(c => `<button class="${c.id === familia ? 'on' : ''}" data-f="${c.id}">${esc(c.nombre)}<b>${fmt.num(c.n)}</b></button>`).join('');
    $$('#familias button').forEach(b => b.onclick = () => { familia = b.dataset.f; grillaMax = 60; $('#q').value = ''; pintarFamilias(); pintarGrilla(); });
  }
  function tile(pid, vars, coinciden, conFoto = true) {
    const v0 = vars[0], st = sumaStock(vars), foto = (C.productos[pid] || {}).imagen_url, unico = vars.length === 1 && !v0.talle && !v0.color, gen = (C.productos[pid] || {}).es_generico;
    const visibles = (coinciden || []).filter(v => $('#chk-sinstock').checked || +v.stock > 0);
    const chips = visibles.length && visibles.length < vars.length ? `<div class="vchips">${visibles.slice(0, 6).map(v => `<button data-v="${v.id}">${esc([v.talle_nombre, v.color_nombre].filter(Boolean).join(' · '))}<small>${fmt.num(v.stock)}</small></button>`).join('')}</div>` : '';
    return `<div class="tile-p${conFoto ? (foto ? ' con-foto' : '') : ' compacta'}" data-pid="${pid}">${!conFoto ? '' : foto ? `<div class="foto"><img src="${esc(foto)}" loading="lazy" alt=""></div>` : `<div class="foto sinfoto">${esc(APP.iniciales(v0.producto_nombre.replace(/[«»]/g, '')))}</div>`}<span class="st ${st > 0 ? '' : 'cero'}">${gen ? '∞' : fmt.num(st)}</span>
      <div class="txt"><div class="nom">${esc(v0.producto_nombre)}</div><div class="cod">${esc(v0.producto_codigo)}${unico ? '' : ' · ' + vars.length + ' var.'}${gen ? ' · se elige al cobrar' : ''}</div><div class="pie-tile"><div class="pre">${C.precioProducto(visibles.length ? visibles : vars)}</div><span class="mas-tile" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></span></div></div>${chips}</div>`;
  }
  function activarTiles(cont, alElegir) {
    $$('.tile-p', cont).forEach(t => t.onclick = ev => { const b = ev.target.closest('[data-v]'); if (b) { alElegir(C.catalogo.find(v => v.id === b.dataset.v)); return; } alElegir(null, t.dataset.pid); });
  }
  let grillaMax = 60, ultimaGrilla = '';
  const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function pintarGrilla() {
    const q = $('#q').value.trim();
    const recientes = JSON.parse(localStorage.getItem(`percha_recientes_${e}`) || '[]');
    let lista = buscarModelos(q, (pid, vars) => conStock(pid, vars) && (q || familia === 'top' || familia === 'recientes' || (C.productos[pid] || {}).categoria_id === familia));
    if (!q && familia === 'recientes') lista = recientes.map(pid => lista.find(x => x.pid === pid)).filter(Boolean);
    else if (!q && familia === 'top' && masVendidos.length) lista = masVendidos.map(pid => lista.find(x => x.pid === pid)).filter(Boolean).slice(0, 48);
    else if (!q) lista.sort((a, b) => a.vars[0].producto_nombre.localeCompare(b.vars[0].producto_nombre));
    // se dibujan de a 60 para que la pantalla arranque al instante; "Ver más" trae el resto
    const max = q ? 120 : grillaMax;
    $('#grilla').classList.toggle('con-fotos', !!q); $('#grilla').innerHTML = lista.slice(0, max).map(x => tile(x.pid, x.vars, x.coinciden, !!q)).join('') || '<div class="vacio">Nada con ese nombre.<br><button class="btn chico" type="button" data-lo-piden style="margin-top:8px">📝 ¿Lo pidió una clienta? Anotalo</button></div>';
    { const bl = $('#grilla [data-lo-piden]'); if (bl && window.PEDIDO_CLIENTA) bl.onclick = () => PEDIDO_CLIENTA.anotar({ texto: ($('#q') || {}).value || '' }); }
    if (lista.length > max) $('#grilla').insertAdjacentHTML('beforeend', `<div class="vacio"><button class="btn" id="btn-grilla-mas">Ver ${fmt.num(Math.min(120, lista.length - max))} más</button></div>`);
    const bm = $('#btn-grilla-mas'); if (bm) bm.onclick = () => { grillaMax += 120; pintarGrilla(); };
    // al cambiar de familia (o al empezar / dejar de buscar) las tarjetas entran en cascada; mientras se escribe, no
    const clave = familia + '|' + (q ? 'q' : '');
    if (clave !== ultimaGrilla && !sinMovimiento) $$('#grilla .tile-p').slice(0, 40).forEach((t, i) => { t.classList.add('entra'); t.style.animationDelay = i * 16 + 'ms'; });
    ultimaGrilla = clave;
    activarTiles($('#grilla'), (v, pid) => { if (v) C.agregar(v); else C.elegirProducto(pid); $('#q').value = ''; setTimeout(pintarGrilla, 50); });
  }
  let tq; $('#q').addEventListener('input', () => { clearTimeout(tq); tq = setTimeout(pintarGrilla, 150); });
  // Enter con una sola coincidencia exacta de talle/color la agrega directo (antes de que caja.js abra el selector)
  $('#q').addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    // con las flechas se marcó una tarjeta: Enter la agrega (o abre talle y color)
    const act = $('#grilla .tile-p.activa'); if (act) { ev.preventDefault(); ev.stopImmediatePropagation(); toque = { r: act.getBoundingClientRect(), t: Date.now() }; act.click(); return; }
    const q = $('#q').value.trim(); if (!q || /^\d{8,}$/.test(q) || /^\d{4}$/.test(q)) return;
    const res = buscarModelos(q, (pid, vars) => conStock(pid, vars));
    if (res.length === 1 && res[0].coinciden.length === 1) { ev.preventDefault(); ev.stopImmediatePropagation(); C.agregar(res[0].coinciden[0]); $('#q').value = ''; pintarGrilla(); }
  }, true);
  C.alCargar = () => { agrupar(); pintarFamilias(); pintarGrilla(); };

  // ================= "¿Qué modelos se lleva?" (genéricos) =================
  // multiplicador: ×2, ×3, ×5 aplican al próximo toque y vuelven a ×1
  const multDe = m => +(((m.querySelector('[data-mult] .on') || {}).dataset || {}).m) || 1;
  const ponerMult = (m, n) => $$('[data-mult] button', m).forEach(b => b.classList.toggle('on', +b.dataset.m === n));
  const activarMult = m => $$('[data-mult] button', m).forEach(b => b.onclick = () => ponerMult(m, +b.dataset.m));
  const cumpleFiltro = (f, nombre) => { const n = (nombre || '').toUpperCase(); return (f.incluye || []).every(w => !w.trim() || n.includes(w.trim().toUpperCase())) && !(f.excluye || []).some(w => w.trim() && n.includes(w.trim().toUpperCase())); };
  const filtroDe = f => (p2, vars) => !(C.productos[p2] || {}).es_generico && (C.productos[p2] || {}).tipo !== 'kit' && (!f.categoria_id || (C.productos[p2] || {}).categoria_id === f.categoria_id) && cumpleFiltro(f, vars[0].producto_nombre);
  const filtroGenerico = gen => { if (gen.generico_filtro) return filtroDe(gen.generico_filtro); const cat = gen.categoria_id, primera = (((porProducto.get(gen.id) || [{}])[0].producto_nombre || '').split(' ')[0] || '').toUpperCase();
    const porPrefijo = primera && [...porProducto.entries()].some(([p2, vars]) => p2 !== gen.id && (C.productos[p2] || {}).categoria_id === cat && !(C.productos[p2] || {}).es_generico && vars[0].producto_nombre.toUpperCase().startsWith(primera + ' '));
    return (p2, vars) => !(C.productos[p2] || {}).es_generico && (C.productos[p2] || {}).tipo !== 'kit' && (C.productos[p2] || {}).categoria_id === cat && (!porPrefijo || vars[0].producto_nombre.toUpperCase().startsWith(primera + ' ')); };
  // El genérico (BOMBIS «VARIAS») se vende rápido. Antes de cobrar, se pide definir cada unidad buscando el modelo real.
  function definirModelos() {
    return new Promise(res => {
      const genericas = () => C.carrito.lineas.filter(l => !l.devuelta && (C.productos[l.variante.producto_id] || {}).es_generico && l.cantidad > 0);
      if (!genericas().length) { res(true); return; }
      const l0 = genericas()[0], gen = C.productos[l0.variante.producto_id], catId = gen.categoria_id;
      const nombreGen = l0.variante.producto_nombre;
      // las que solo se venden en el local (BOMBIS «LOCAL»): completan sin elegir modelo
      const loc = gen.generico_local_id ? C.catalogo.find(v => v.producto_id === gen.generico_local_id) : null;
      const elegidos = [];
      const m = modal(`<h2>¿Qué modelos se lleva?</h2><p class="sub">Buscá cada uno (ej. <b>fru cel</b> = Fru Fru celeste) y tocalo. Si no sabés cuál es, dejalo como ${esc(nombreGen)}.${genericas().some(l => l.canje) ? ' <b>La del cambio de un conjunto va sin cargo.</b>' : ''}</p>
        <div class="pend"><b id="df-n"></b><span class="sub">por definir</span><span class="mult" data-mult><button class="on" data-m="1">×1</button><button data-m="2">×2</button><button data-m="3">×3</button><button data-m="5">×5</button></span><div class="elegidos" id="df-elegidos"></div></div>
        <div class="buscador" style="min-width:0;width:100%"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="df-q" placeholder="Modelo, color, talle…" autocomplete="off"><label class="filtro-stock"><input type="checkbox" id="df-sinstock"> sin stock</label></div>
        <div class="grilla" id="df-grilla"></div>
        <div class="pie"><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-mas>+ Una más</button>${loc ? `<button class="btn" data-local title="Las que no están en la web: van a ${esc(loc.producto_nombre)}, sin modelo">+ ${esc(loc.producto_nombre)} <small>(no está en la web)</small></button>` : ''}<button class="btn" data-dejar>Dejar como ${esc(nombreGen)}</button></div><button class="btn primario" data-ok style="padding:12px 22px;font-size:15px">Seguir al cobro</button></div>`, { fijo: true });
      m.querySelector('.modal').classList.add('definir');
      const pendientes = () => genericas().reduce((s, l) => s + l.cantidad, 0);
      const pintarPend = () => { $('#df-n', m).textContent = pendientes(); $('#df-elegidos', m).innerHTML = elegidos.map(v => `<span>${esc(v.producto_nombre)} ${esc([v.talle_nombre, v.color_nombre].filter(Boolean).join(' '))}</span>`).join(''); };
      const pintarLista = () => {
        const q = $('#df-q', m).value.trim(), sin = $('#df-sinstock', m).checked;
        const fg = filtroGenerico(Object.assign({ id: l0.variante.producto_id }, gen));
        // se busca dentro de la familia; solo si ahí no hay nada, en todo el catálogo
        let lista = buscarModelos(q, (pid, vars) => fg(pid, vars) && (sin || sumaStock(vars) > 0));
        if (q && !lista.length) lista = buscarModelos(q, (pid, vars) => !(C.productos[pid] || {}).es_generico && (C.productos[pid] || {}).tipo !== 'kit' && (sin || sumaStock(vars) > 0));
        if (!q) lista.sort((a, b) => sumaStock(b.vars) - sumaStock(a.vars) || a.vars[0].producto_nombre.localeCompare(b.vars[0].producto_nombre));
        $('#df-grilla', m).innerHTML = lista.slice(0, 120).map(x => tile(x.pid, x.vars, x.coinciden)).join('') || '<div class="vacio" style="grid-column:1/-1">Nada con ese nombre. Probá con menos letras o marcá "sin stock".</div>';
        activarTiles($('#df-grilla', m), (v, pid) => {
          if (v) { asignar(v); return; }
          const vars = porProducto.get(pid);
          if (vars.length === 1 && !vars[0].talle && !vars[0].color) { asignar(vars[0]); return; }
          const m2 = modal(`<h2>${esc(vars[0].producto_nombre)}</h2><p class="sub">¿Qué talle y color?</p><div class="matriz-pick">${vars.slice().sort((a, b) => (a.talle_orden ?? 999) - (b.talle_orden ?? 999) || String(a.color_nombre || '').localeCompare(b.color_nombre || '')).map(v => `<button data-v="${v.id}" class="${+v.stock > 0 ? '' : 'sin'}">${esc([v.talle_nombre, v.color_nombre].filter(Boolean).join(' · ') || 'único')}<small>${fmt.num(v.stock)} u.</small></button>`).join('')}</div>`);
          $$('[data-v]', m2).forEach(b => b.onclick = () => { m2.cerrar(); asignar(C.catalogo.find(v => v.id === b.dataset.v)); }); C.buscadorPick(m2);
        });
      };
      // una unidad del genérico pasa a ser el modelo real (a su precio)
      const asignar = v => {
        const n = Math.min(multDe(m), pendientes()); let cobra = 0;
        for (let i = 0; i < n; i++) { const g = genericas()[0]; if (!g) break; elegidos.push(v);
          // la suelta del cambio de un conjunto: toma el modelo y sigue a $0, atada a su conjunto
          if (g.canje) { if (g.cantidad > 1) { g.cantidad -= 1; C.carrito.lineas.splice(C.carrito.lineas.indexOf(g) + 1, 0, Object.assign({}, g, { variante: v, cantidad: 1 })); } else g.variante = v; continue; }
          g.cantidad -= 1; if (g.cantidad <= 0) C.carrito.lineas.splice(C.carrito.lineas.indexOf(g), 1); cobra++; }
        if (cobra) C.agregar(v, cobra); else C.pintar(); ponerMult(m, 1); $('#df-q', m).value = ''; pintarPend(); pintarLista(); $('#df-q', m).focus();
        if (!pendientes()) { m.cerrar(); res(true); }
      };
      $('#df-q', m).addEventListener('input', () => pintarLista());
      $('#df-q', m).addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); const q = $('#df-q', m).value.trim(); const r = buscarModelos(q, (pid, vars) => !(C.productos[pid] || {}).es_generico && ($('#df-sinstock', m).checked || sumaStock(vars) > 0)); if (r.length === 1 && r[0].coinciden.length === 1) asignar(r[0].coinciden[0]); else if (r.length === 1 && r[0].vars.length === 1) asignar(r[0].vars[0]); } });
      $('#df-sinstock', m).onchange = pintarLista;
      $('[data-mas]', m).onclick = () => { const g = genericas()[0]; if (g) g.cantidad += 1; else C.agregar(l0.variante, 1); C.pintar(); pintarPend(); };
      const avisarPend = () => { if (pendientes()) toast(`Quedan ${pendientes()} por definir: después las definís desde 📌 Pendientes`); };
      const bl = $('[data-local]', m); if (bl) bl.onclick = () => asignar(loc);
      $('[data-dejar]', m).onclick = () => { avisarPend(); m.cerrar(); res(true); };
      $('[data-ok]', m).onclick = () => { avisarPend(); m.cerrar(); res(true); };
      m.addEventListener('click', ev => { if (ev.target === m) { /* fijo: no se cierra tocando afuera */ } });
      activarMult(m); pintarPend(); pintarLista(); $('#df-q', m).focus();
    });
  }
  // ================= "¿Qué lleva el pack?" (kits por producto) =================
  // Un [PACK x3] LESS «ALDI» lleva 3 LESS «ALDI» del color que elija la clienta: se eligen acá y van en la línea (componentes).
  let componentesKit = {};   // producto_id del kit → [{comp_producto_id, cantidad, comp_generico, variante_id}]
  async function cargarComponentes() { const { data } = await sb.from('v_componentes').select('producto_id,comp_producto_id,cantidad,comp_generico,variante_id,filtro').eq('empresa_id', e); componentesKit = {}; (data || []).forEach(c => { (componentesKit[c.producto_id] = componentesKit[c.producto_id] || []).push(c); }); }
  cargarComponentes();
  function definirKits() {
    return new Promise(res => {
      const pendientes = () => C.carrito.lineas.filter(l => !l.devuelta && l.cantidad > 0 && (C.productos[l.variante.producto_id] || {}).tipo === 'kit' && !l.componentes_ok && (componentesKit[l.variante.producto_id] || []).some(c => !c.variante_id));
      const siguiente = () => {
        const l = pendientes()[0]; if (!l) { res(true); return; }
        // ranuras: por cada kit × cada componente "por producto" × su cantidad
        const ranuras = []; (componentesKit[l.variante.producto_id] || []).filter(c => !c.variante_id).forEach(c => { for (let i = 0; i < l.cantidad * c.cantidad; i++) ranuras.push(c.filtro ? { filtro: c.filtro } : { pid: c.comp_producto_id }); });
        l.componentes = l.componentes || []; const elegidos = [];
        const nombreDe = r => r.pid ? ((porProducto.get(r.pid) || [{}])[0].producto_nombre || '') : ((r.filtro.incluye || []).join(' ') || 'prenda del filtro');
        const m = modal(`<h2>¿Qué lleva ${esc(l.variante.producto_nombre)}?</h2><p class="sub">Tocá cada prenda que va adentro (${ranuras.length} en total). Si no sabés, dejalo sin definir y se acomoda en el Conteo.</p>
          <div class="pend"><b id="dk-n"></b><span class="sub" id="dk-que"></span><span class="mult" data-mult><button class="on" data-m="1">×1</button><button data-m="2">×2</button><button data-m="3">×3</button><button data-m="5">×5</button></span><div class="elegidos" id="dk-elegidos"></div></div>
          <div class="buscador" style="min-width:0;width:100%"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="dk-q" placeholder="Color, talle…" autocomplete="off"><label class="filtro-stock"><input type="checkbox" id="dk-sinstock"> sin stock</label></div>
          <div class="grilla" id="dk-grilla"></div>
          <div class="pie"><button class="btn" data-dejar>Dejar sin definir</button><button class="btn primario" data-ok style="padding:12px 22px;font-size:15px">Seguir</button></div>`, { fijo: true });
        m.querySelector('.modal').classList.add('definir');
        const actual = () => ranuras[elegidos.length];
        const pintar = () => { $('#dk-n', m).textContent = ranuras.length - elegidos.length; $('#dk-que', m).textContent = actual() ? 'por definir · ahora: ' + nombreDe(actual()) : 'listo'; $('#dk-elegidos', m).innerHTML = elegidos.map(v => `<span>${esc(v.producto_nombre)} ${esc([v.talle_nombre, v.color_nombre].filter(Boolean).join(' '))}</span>`).join(''); };
        const pintarLista = () => {
          const r = actual(); if (!r) { $('#dk-grilla', m).innerHTML = ''; return; }
          const pid = r.pid, gen = pid && (C.productos[pid] || {}).es_generico, q = $('#dk-q', m).value.trim(), sin = $('#dk-sinstock', m).checked;
          // filtro: lo que cumple el filtro; genérico (BOMBIS VARIAS): su filtro o su familia; producto concreto: sus variantes
          const fg = r.filtro ? filtroDe(r.filtro) : gen ? filtroGenerico(Object.assign({ id: pid }, C.productos[pid])) : null;
          const lista = buscarModelos(q, (p2, vars) => (fg ? fg(p2, vars) : p2 === pid) && (sin || sumaStock(vars) > 0 || p2 === pid));
          $('#dk-grilla', m).innerHTML = lista.slice(0, 120).map(x => tile(x.pid, x.vars, x.coinciden)).join('') || '<div class="vacio" style="grid-column:1/-1">Nada con ese nombre.</div>';
          activarTiles($('#dk-grilla', m), (v, p2) => {
            if (v) { elegir(v); return; }
            const vars = porProducto.get(p2); if (vars.length === 1) { elegir(vars[0]); return; }
            const m2 = modal(`<h2>${esc(vars[0].producto_nombre)}</h2><p class="sub">¿Qué talle y color?</p><div class="matriz-pick">${vars.slice().sort((a, b) => (a.talle_orden ?? 999) - (b.talle_orden ?? 999) || String(a.color_nombre || '').localeCompare(b.color_nombre || '')).map(v2 => `<button data-v="${v2.id}" class="${+v2.stock > 0 ? '' : 'sin'}">${esc([v2.talle_nombre, v2.color_nombre].filter(Boolean).join(' · ') || 'único')}<small>${fmt.num(v2.stock)} u.</small></button>`).join('')}</div>`);
            $$('[data-v]', m2).forEach(b => b.onclick = () => { m2.cerrar(); elegir(C.catalogo.find(v2 => v2.id === b.dataset.v)); }); C.buscadorPick(m2);
          });
        };
        const elegir = v => {
          const n = Math.min(multDe(m), ranuras.length - elegidos.length); for (let i = 0; i < n; i++) elegidos.push(v); const ya = l.componentes.find(c => c.variante_id === v.id); if (ya) ya.cantidad += n; else l.componentes.push({ variante_id: v.id, cantidad: n }); ponerMult(m, 1);
          $('#dk-q', m).value = ''; pintar(); pintarLista(); $('#dk-q', m).focus();
          if (!actual()) { l.componentes_ok = true; m.cerrar(); siguiente(); }
        };
        $('#dk-q', m).addEventListener('input', pintarLista); $('#dk-sinstock', m).onchange = pintarLista;
        $('[data-dejar]', m).onclick = () => { l.componentes_ok = true; toast('Lo que falta queda en 📌 Pendientes para definir después'); m.cerrar(); siguiente(); };
        $('[data-ok]', m).onclick = () => { l.componentes_ok = true; m.cerrar(); siguiente(); };
        activarMult(m); pintar(); pintarLista(); $('#dk-q', m).focus();
      };
      siguiente();
    });
  }
  // cobrar y seña pasan primero por la definición de genéricos y de kits
  $('#btn-cobrar').onclick = async () => { if (!C.carrito.lineas.length) return; if (await definirModelos() && await definirKits()) C.cobrar(false); };
  $('#btn-sena').onclick = async () => { if (!C.carrito.lineas.length) return C.retirarSena(); if (await definirModelos() && await definirKits()) C.cobrar(true); };

  // ================= Movimiento: la prenda vuela al ticket, el renglón entra, el total sube =================
  // Todo es visual: se mira el ticket después de que caja.js lo dibuja (no cambia nada de la venta).
  let toque = null;   // de dónde sale la prenda que vuela: la tarjeta o el botón de talle que se tocó
  document.addEventListener('pointerdown', ev => { const el = ev.target.closest('.tile-p, .matriz-pick button[data-v], .vchips button'); toque = el ? { r: el.getBoundingClientRect(), t: Date.now() } : null; }, true);
  // terminada la animación se saca la clase, así no tapa el efecto de pasar el mouse
  document.addEventListener('animationend', ev => { const c = ev.target.classList; if (/^(tile-entra|linea-entra|linea-suma)$/.test(ev.animationName)) { c.remove('entra', 'suma'); ev.target.style.animationDelay = ''; } });
  function volar(r, destino, texto) {
    const d = destino.getBoundingClientRect(), el = document.createElement('div'); el.className = 'vuela'; el.textContent = texto; document.body.appendChild(el);
    const w = el.offsetWidth, h = el.offsetHeight, x0 = r.left + r.width / 2 - w / 2, y0 = r.top + r.height / 2 - h / 2, x1 = d.left + 12, y1 = d.top + d.height / 2 - h / 2;
    const mx = x0 + (x1 - x0) * .55, my = Math.min(y0, y1) - 60;   // un arco hacia arriba
    el.animate([
      { transform: `translate(${x0}px,${y0}px) scale(.6)`, opacity: 0 },
      { transform: `translate(${x0}px,${y0 - 14}px) scale(1)`, opacity: 1, offset: .18 },
      { transform: `translate(${mx}px,${my}px) scale(.92)`, opacity: 1, offset: .6 },
      { transform: `translate(${x1}px,${y1}px) scale(.45)`, opacity: 0 }
    ], { duration: 620, easing: 'cubic-bezier(.45,0,.35,1)' }).onfinish = () => el.remove();
    setTimeout(() => el.remove(), 1500);
  }
  const claveLinea = l => (l.variante.id || l.variante.producto_nombre) + (l.falla ? '·f' : '') + (l.devuelta ? '·d' : '');
  let antesLineas = null, antesSub = '', totalAntes = 0, habiaLineas = false, vuelo = 0;
  new MutationObserver(() => {
    const ls = C.carrito.lineas, filas = $$('#lineas .linea'), ahora = new Map(), cuenta = {};
    let destino = null, nueva = null;
    ls.forEach((l, i) => {
      let k = claveLinea(l); cuenta[k] = (cuenta[k] || 0) + 1; k += '#' + cuenta[k]; ahora.set(k, Math.abs(l.cantidad));
      if (!antesLineas || !filas[i]) return;
      const a = antesLineas.get(k);
      if (a == null) { filas[i].classList.add('entra'); destino = filas[i]; nueva = l; selLinea = l; }
      else if (Math.abs(l.cantidad) > a) { filas[i].classList.add('suma'); destino = filas[i]; nueva = l; selLinea = l; }
    });
    antesLineas = ahora;
    if (!destino || sinMovimiento) return;
    // si se tocó una prenda recién (y no hay una ventana abierta tapando el ticket), vuela hasta su renglón
    if (toque && Date.now() - toque.t < 1500 && !document.querySelector('.modal-fondo')) { destino.style.animationDelay = '.4s'; vuelo = Date.now(); volar(toque.r, destino, nueva.variante.producto_nombre); }
    toque = null;
    destino.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }).observe($('#lineas'), { childList: true });
  const bCobrar = $('#btn-cobrar');
  new MutationObserver(() => {
    const t = C.calcular().total, gran = $('#totales .gran'), sp = gran && gran.lastElementChild, hay = C.carrito.lineas.length > 0;
    const sub = $('#ticket-sub'); if (sub && sub.textContent !== antesSub) { if (hay && !sinMovimiento) { sub.classList.remove('pop'); void sub.offsetWidth; sub.classList.add('pop'); } antesSub = sub.textContent; }
    if (hay && !habiaLineas && !sinMovimiento) { bCobrar.classList.remove('brilla'); void bCobrar.offsetWidth; bCobrar.classList.add('brilla'); }
    habiaLineas = hay;
    const desde = totalAntes; totalAntes = t;
    if (!sp || t === desde || sinMovimiento || document.hidden) return;
    // el total cuenta hasta el nuevo valor (si vuela una prenda, espera a que llegue)
    const t0 = performance.now() + (Date.now() - vuelo < 200 ? 380 : 0), dur = 420;
    sp.textContent = fmt.pesos(desde);
    const paso = now => { if (!sp.isConnected) return; const k = Math.min(1, Math.max(0, (now - t0) / dur)), e2 = 1 - Math.pow(1 - k, 3);
      sp.textContent = fmt.pesos(k < 1 ? Math.round(desde + (t - desde) * e2) : t);
      if (k > 0 && !gran.classList.contains('bump')) gran.classList.add('bump');
      if (k < 1) requestAnimationFrame(paso); };
    requestAnimationFrame(paso);
    setTimeout(() => { if (sp.isConnected) sp.textContent = fmt.pesos(t); }, t0 - performance.now() + dur + 60);   // el número final queda sí o sí, aunque el navegador no anime
  }).observe($('#totales'), { childList: true });
  // quitar un renglón: se va hacia el costado y recién ahí se borra
  $('#lineas').addEventListener('click', ev => {
    const b = ev.target.closest('.quitar, [data-d="-1"]'); if (!b || sinMovimiento || b.dataset.ya) return;
    const l = C.carrito.lineas[+b.dataset.i]; if (!l || (!b.classList.contains('quitar') && Math.abs(l.cantidad) > 1)) return;
    ev.stopPropagation(); ev.preventDefault();
    b.closest('.linea').classList.add('sale'); setTimeout(() => { b.dataset.ya = '1'; b.click(); }, 190);
  }, true);

  // ================= Teclado: vender combinando mouse y teclado =================
  // Buscador: ↑↓←→ recorren las tarjetas y Enter agrega · "3*" antes del código o del toque = cantidad para la próxima prenda.
  // Con el buscador vacío: + / − cambian la cantidad del renglón marcado, Supr lo quita · Alt+↑↓ marca otro renglón.
  // F2 cambia el precio del renglón marcado · F4 abre "Más…" · F9 o Ctrl+Enter cobra. Lo que se tipea sin foco va al buscador (el lector nunca se pierde).
  const qIn = $('#q'), sinCampo = el => !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.isContentEditable;
  const tiles = () => $$('#grilla .tile-p');
  function marcarTile(i) {
    const ts = tiles(); ts.forEach(t => t.classList.remove('activa')); if (!ts.length) return;
    const t = ts[Math.max(0, Math.min(i, ts.length - 1))]; t.classList.add('activa'); t.scrollIntoView({ block: 'nearest' });
  }
  const columnas = () => { const ts = tiles(); let n = 0; while (n < ts.length && ts[n].offsetTop === ts[0].offsetTop) n++; return n || 1; };
  // renglón marcado: el último que se agregó o tocó (si no hay, el último del ticket)
  let selLinea = null;
  const idxSel = () => { const ls = C.carrito.lineas, i = ls.indexOf(selLinea); return i >= 0 ? i : ls.length - 1; };
  const filaSel = () => $$('#lineas .linea')[idxSel()];
  function pintarSel() { const i = idxSel(); $$('#lineas .linea').forEach((f, k) => f.classList.toggle('sel', k === i && C.carrito.lineas.length > 1)); }
  new MutationObserver(pintarSel).observe($('#lineas'), { childList: true });
  $('#lineas').addEventListener('click', ev => { const f = ev.target.closest('.linea'); if (!f) return; const l = C.carrito.lineas[$$('#lineas .linea').indexOf(f)]; if (l) { selLinea = l; pintarSel(); } });
  function moverSel(d) { const ls = C.carrito.lineas; if (!ls.length) return; selLinea = ls[Math.max(0, Math.min(idxSel() + d, ls.length - 1))]; pintarSel(); const f = filaSel(); if (f) f.scrollIntoView({ block: 'nearest' }); }
  const tocarEnSel = sel => { const f = filaSel(), b = f && f.querySelector(sel); if (b) b.click(); };
  // cantidad para la próxima prenda: "3*" en el buscador
  let cantPend = null;
  function pintarCant() { let b = $('#cant-pend'); if (!cantPend) { if (b) b.remove(); return; } if (!b) { qIn.insertAdjacentHTML('beforebegin', '<span id="cant-pend" title="Cantidad para la próxima prenda (Esc la saca)"></span>'); b = $('#cant-pend'); } b.textContent = '×' + cantPend; }
  C.tomarCantidad = () => { const n = cantPend; if (n) { cantPend = null; pintarCant(); } return n; };
  qIn.addEventListener('input', () => { const mm = /^(\d{1,3})\s*\*\s*/.exec(qIn.value); if (mm && +mm[1] > 0) { cantPend = +mm[1]; qIn.value = qIn.value.slice(mm[0].length); pintarCant(); } });
  qIn.addEventListener('keydown', ev => {
    if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) { ev.preventDefault(); moverSel(ev.key === 'ArrowUp' ? -1 : 1); return; }
    const salto = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columnas(), ArrowUp: -columnas() }[ev.key];
    if (salto) {
      const i = tiles().findIndex(t => t.classList.contains('activa'));
      if (i < 0 && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'ArrowUp')) return;   // ← → mueven el cursor del texto hasta entrar a la grilla con ↓
      ev.preventDefault(); marcarTile(i < 0 ? 0 : i + salto); return;
    }
    if (ev.key === 'Escape') { tiles().forEach(t => t.classList.remove('activa')); cantPend = null; pintarCant(); return; }
    if (qIn.value) return;
    if (ev.key === '+' || ev.key === '-') { ev.preventDefault(); toque = null; tocarEnSel(`[data-d="${ev.key === '+' ? 1 : -1}"]`); }
    else if (ev.key === 'Delete') { ev.preventDefault(); tocarEnSel('.quitar'); }
  });
  // al escribir, la marca de la grilla se va (la grilla se vuelve a dibujar con lo buscado)
  qIn.addEventListener('input', () => tiles().forEach(t => t.classList.remove('activa')));
  document.addEventListener('keydown', ev => {
    if (document.querySelector('.modal-fondo') || ev.ctrlKey || ev.metaKey) return;
    if (ev.key === 'F2') { ev.preventDefault(); const i = idxSel(); if (i >= 0) C.cambiarPrecio(i); return; }
    if (ev.key === 'F4') { ev.preventDefault(); $('#btn-mas').click(); return; }
    if (ev.target === qIn || !sinCampo(ev.target) || ev.altKey) return;
    // sin foco en un campo: + − Supr actúan sobre el renglón; cualquier otra letra o número va al buscador
    if (ev.key === '+' || ev.key === '-') { ev.preventDefault(); toque = null; tocarEnSel(`[data-d="${ev.key === '+' ? 1 : -1}"]`); }
    else if (ev.key === 'Delete') { ev.preventDefault(); tocarEnSel('.quitar'); }
    else if (ev.key.length === 1 && ev.key !== ' ') qIn.focus();
  });
  // ventanas: talle y color con flechas · cobro con números · "Nueva venta" con Enter
  document.addEventListener('keydown', ev => {
    const el = document.activeElement; if (!el || !el.closest || !/^Arrow|^Enter$/.test(ev.key)) return;
    const grid = el.closest('.matriz-pick'), busca = el.classList.contains('pick-busca'), m = el.closest('.modal');
    if ((!grid && !busca) || !m) return;
    if (ev.key === 'Enter') { if (grid) toque = { r: el.getBoundingClientRect(), t: Date.now() }; return; }
    const bs = $$('.matriz-pick button[data-v]', m).filter(b => b.offsetParent !== null); if (!bs.length) return;
    if (busca) { if (ev.key === 'ArrowDown') { ev.preventDefault(); (bs.find(b => !b.classList.contains('sin')) || bs[0]).focus(); } return; }
    ev.preventDefault();
    const i = bs.indexOf(el), r = el.getBoundingClientRect(), cx = r.left + r.width / 2;
    let dest = ev.key === 'ArrowRight' ? bs[i + 1] : ev.key === 'ArrowLeft' ? bs[i - 1] : null;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {   // el más cercano en la fila de abajo / arriba
      const abajo = ev.key === 'ArrowDown', cand = bs.filter(b => { const rb = b.getBoundingClientRect(); return abajo ? rb.top >= r.bottom - 2 : rb.bottom <= r.top + 2; });
      if (!cand.length) { const inp = !abajo && $('.pick-busca', m); if (inp) inp.focus(); return; }
      const fila = (abajo ? Math.min : Math.max)(...cand.map(b => b.getBoundingClientRect().top));
      dest = cand.filter(b => Math.abs(b.getBoundingClientRect().top - fila) < 4).sort((a, b) => { const ca = a.getBoundingClientRect(), cb = b.getBoundingClientRect(); return Math.abs(ca.left + ca.width / 2 - cx) - Math.abs(cb.left + cb.width / 2 - cx); })[0];
    }
    if (dest) dest.focus();
  }, true);
  function prepararCobro(m) {
    const md = $('.modal', m), bs = $$('[data-f]', m).filter(b => b.offsetParent !== null).slice(0, 9);
    bs.forEach((b, i) => b.insertAdjacentHTML('beforeend', `<kbd class="num">${i + 1}</kbd>`));
    md.tabIndex = -1; md.focus();
    m.addEventListener('keydown', ev => {
      if (m !== $$('.modal-fondo').pop() || ev.ctrlKey || ev.altKey || ev.metaKey) return;   // si hay otra ventana encima (crédito), no
      const enCampo = !sinCampo(ev.target);
      // 1…9: elige el medio y deja el importe listo para escribir (por ejemplo, con cuánto paga en efectivo)
      if (!enCampo && /^[1-9]$/.test(ev.key)) { const b = bs[+ev.key - 1]; if (!b) return; ev.preventDefault(); b.click(); setTimeout(() => { const ins = $$('#cb-pagos input', m), x = ins[ins.length - 1]; if (x) { x.focus(); x.select(); } }, 0); return; }
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      // Enter en el importe: lo toma y muestra el vuelto; el siguiente Enter confirma
      if (enCampo && ev.target.closest('#cb-pagos')) { ev.target.dispatchEvent(new Event('change')); md.focus(); return; }
      const si = $('[data-si]', m); if (si && !si.disabled) si.click();
    });
  }
  new MutationObserver(recs => recs.forEach(r => r.addedNodes.forEach(n => {
    if (!n.classList || !n.classList.contains('modal-fondo')) return;
    if ($('#cb-pagos', n)) { prepararCobro(n); return; }
    if ($('[data-monto-venta]', n)) { const ok = $('[data-ok]', n); if (ok) ok.focus(); return; }
    const mp = $('.matriz-pick', n);
    if (mp && !$('.pick-busca', n)) { const b = $$('button[data-v]', mp).find(x => !x.classList.contains('sin')) || $('button[data-v]', mp); if (b) b.focus(); }
    // cualquier otra ventana que quedó sin foco (se dibuja después de abrirse): Enter = el botón principal de abajo
    setTimeout(() => { if (!n.isConnected || n.contains(document.activeElement)) return; const bs = $$('.pie button:not(:disabled)', n).filter(b => b.offsetParent !== null); const b = bs.find(x => x.classList.contains('primario')) || bs[bs.length - 1]; if (b) b.focus(); }, 60);
  }))).observe(document.body, { childList: true });

  // ================= Más opciones (clienta, nota, descuento, canal) =================
  $('#btn-mas').onclick = () => { const m = $('#mas'); m.classList.toggle('ver'); $('#btn-mas').classList.toggle('on', m.classList.contains('ver')); if (m.classList.contains('ver')) $('#sel-cliente').focus(); };
  // la grilla se pinta apenas está el catálogo (caja.js y pos.js arrancan en paralelo; a veces el aviso de "cargado" llega antes que la grilla)
  let intentosGrilla = 0;
  const esperarCatalogo = setInterval(() => {
    intentosGrilla++;
    if (C.catalogo.length && !$('#grilla .tile-p') && !$('#grilla .vacio')) C.alCargar();
    if ($('#grilla .tile-p') || intentosGrilla > 75) clearInterval(esperarCatalogo);
  }, 400);
  if (C.catalogo.length) C.alCargar();
});
