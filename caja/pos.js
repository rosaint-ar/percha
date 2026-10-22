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
  let categorias = [], familia = 'todo', porProducto = new Map();
  const { data: cats } = await sb.from('categorias').select('id,nombre,orden').eq('empresa_id', e).eq('activa', true).order('orden').order('nombre');
  categorias = cats || [];
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
    const items = [{ id: 'todo', nombre: 'Todo', n: total }, ...(recientes.length ? [{ id: 'recientes', nombre: 'Recientes', n: recientes.length }] : []), ...categorias.filter(c => cuenta[c.id]).map(c => ({ id: c.id, nombre: c.nombre, n: cuenta[c.id] }))];
    $('#familias').innerHTML = items.map(c => `<button class="${c.id === familia ? 'on' : ''}" data-f="${c.id}">${esc(c.nombre)}<b>${fmt.num(c.n)}</b></button>`).join('');
    $$('#familias button').forEach(b => b.onclick = () => { familia = b.dataset.f; $('#q').value = ''; pintarFamilias(); pintarGrilla(); });
  }
  function tile(pid, vars, coinciden) {
    const v0 = vars[0], st = sumaStock(vars), foto = (C.productos[pid] || {}).imagen_url, unico = vars.length === 1 && !v0.talle && !v0.color, gen = (C.productos[pid] || {}).es_generico;
    const visibles = (coinciden || []).filter(v => $('#chk-sinstock').checked || +v.stock > 0);
    const chips = visibles.length && visibles.length < vars.length ? `<div class="vchips">${visibles.slice(0, 6).map(v => `<button data-v="${v.id}">${esc([v.talle_nombre, v.color_nombre].filter(Boolean).join(' · '))}<small>${fmt.num(v.stock)}</small></button>`).join('')}</div>` : '';
    return `<div class="tile-p" data-pid="${pid}">${foto ? `<div class="foto" style="background-image:url('${esc(foto)}')"></div>` : `<div class="foto sinfoto">${esc(APP.iniciales(v0.producto_nombre.replace(/[«»]/g, '')))}</div>`}<span class="st ${st > 0 ? '' : 'cero'}">${gen ? '∞' : fmt.num(st)}</span>
      <div class="txt"><div class="nom">${esc(v0.producto_nombre)}</div><div class="cod">${esc(v0.producto_codigo)}${unico ? '' : ' · ' + vars.length + ' var.'}${gen ? ' · al cobrar se elige el modelo' : ''}</div><div class="pre">${fmt.pesos(C.precioLista(v0))}</div></div>${chips}</div>`;
  }
  function activarTiles(cont, alElegir) {
    $$('.tile-p', cont).forEach(t => t.onclick = ev => { const b = ev.target.closest('[data-v]'); if (b) { alElegir(C.catalogo.find(v => v.id === b.dataset.v)); return; } alElegir(null, t.dataset.pid); });
  }
  function pintarGrilla() {
    const q = $('#q').value.trim();
    const recientes = JSON.parse(localStorage.getItem(`percha_recientes_${e}`) || '[]');
    let lista = buscarModelos(q, (pid, vars) => conStock(pid, vars) && (q || familia === 'todo' || familia === 'recientes' || (C.productos[pid] || {}).categoria_id === familia));
    if (!q && familia === 'recientes') lista = recientes.map(pid => lista.find(x => x.pid === pid)).filter(Boolean);
    else if (!q) lista.sort((a, b) => a.vars[0].producto_nombre.localeCompare(b.vars[0].producto_nombre));
    const max = 240;
    $('#grilla').innerHTML = lista.slice(0, max).map(x => tile(x.pid, x.vars, x.coinciden)).join('') || '<div class="vacio">Nada con ese nombre.</div>';
    if (lista.length > max) $('#grilla').insertAdjacentHTML('beforeend', `<div class="vacio">Hay ${fmt.num(lista.length - max)} más: afiná la búsqueda.</div>`);
    activarTiles($('#grilla'), (v, pid) => { if (v) C.agregar(v); else C.elegirProducto(pid); $('#q').value = ''; setTimeout(pintarGrilla, 50); });
  }
  let tq; $('#q').addEventListener('input', () => { clearTimeout(tq); tq = setTimeout(pintarGrilla, 150); });
  // Enter con una sola coincidencia exacta de talle/color la agrega directo (antes de que caja.js abra el selector)
  $('#q').addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    const q = $('#q').value.trim(); if (!q || /^\d{8,}$/.test(q)) return;
    const res = buscarModelos(q, (pid, vars) => conStock(pid, vars));
    if (res.length === 1 && res[0].coinciden.length === 1) { ev.preventDefault(); ev.stopImmediatePropagation(); C.agregar(res[0].coinciden[0]); $('#q').value = ''; pintarGrilla(); }
  }, true);
  C.alCargar = () => { agrupar(); pintarFamilias(); pintarGrilla(); };
  const observador = new MutationObserver(() => { marcarSeleccion(); });
  observador.observe($('#lineas'), { childList: true });

  // ================= "¿Qué modelos se lleva?" (genéricos) =================
  // El genérico (BOMBIS «VARIAS») se vende rápido. Antes de cobrar, se pide definir cada unidad buscando el modelo real.
  function definirModelos() {
    return new Promise(res => {
      const genericas = () => C.carrito.lineas.filter(l => !l.devuelta && (C.productos[l.variante.producto_id] || {}).es_generico && l.cantidad > 0);
      if (!genericas().length) { res(true); return; }
      const l0 = genericas()[0], gen = C.productos[l0.variante.producto_id], catId = gen.categoria_id;
      const nombreGen = l0.variante.producto_nombre;
      const elegidos = [];
      const m = modal(`<h2>¿Qué modelos se lleva?</h2><p class="sub">Buscá cada uno (ej. <b>fru cel</b> = Fru Fru celeste) y tocalo. Si no sabés cuál es, dejalo como ${esc(nombreGen)}.</p>
        <div class="pend"><b id="df-n"></b><span class="sub">por definir</span><div class="elegidos" id="df-elegidos"></div></div>
        <div class="buscador" style="min-width:0;width:100%"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="df-q" placeholder="Modelo, color, talle…" autocomplete="off"><label class="filtro-stock"><input type="checkbox" id="df-sinstock"> sin stock</label></div>
        <div class="grilla" id="df-grilla"></div>
        <div class="pie"><div style="display:flex;gap:8px"><button class="btn" data-mas>+ Una más</button><button class="btn" data-dejar>Dejar como ${esc(nombreGen)}</button></div><button class="btn primario" data-ok style="padding:12px 22px;font-size:15px">Seguir al cobro</button></div>`, { fijo: true });
      m.querySelector('.modal').classList.add('definir');
      const pendientes = () => genericas().reduce((s, l) => s + l.cantidad, 0);
      const pintarPend = () => { $('#df-n', m).textContent = pendientes(); $('#df-elegidos', m).innerHTML = elegidos.map(v => `<span>${esc(v.producto_nombre)} ${esc([v.talle_nombre, v.color_nombre].filter(Boolean).join(' '))}</span>`).join(''); };
      const pintarLista = () => {
        const q = $('#df-q', m).value.trim(), sin = $('#df-sinstock', m).checked;
        const lista = buscarModelos(q, (pid, vars) => !(C.productos[pid] || {}).es_generico && (C.productos[pid] || {}).tipo !== 'kit' && (q || (C.productos[pid] || {}).categoria_id === catId) && (sin || sumaStock(vars) > 0));
        if (!q) lista.sort((a, b) => sumaStock(b.vars) - sumaStock(a.vars) || a.vars[0].producto_nombre.localeCompare(b.vars[0].producto_nombre));
        $('#df-grilla', m).innerHTML = lista.slice(0, 120).map(x => tile(x.pid, x.vars, x.coinciden)).join('') || '<div class="vacio" style="grid-column:1/-1">Nada con ese nombre. Probá con menos letras o marcá "sin stock".</div>';
        activarTiles($('#df-grilla', m), (v, pid) => {
          if (v) { asignar(v); return; }
          const vars = porProducto.get(pid);
          if (vars.length === 1 && !vars[0].talle && !vars[0].color) { asignar(vars[0]); return; }
          const m2 = modal(`<h2>${esc(vars[0].producto_nombre)}</h2><p class="sub">¿Qué talle y color?</p><div class="matriz-pick">${vars.slice().sort((a, b) => (a.talle_orden ?? 999) - (b.talle_orden ?? 999) || String(a.color_nombre || '').localeCompare(b.color_nombre || '')).map(v => `<button data-v="${v.id}" class="${+v.stock > 0 ? '' : 'sin'}">${esc([v.talle_nombre, v.color_nombre].filter(Boolean).join(' · ') || 'único')}<small>${fmt.num(v.stock)} u.</small></button>`).join('')}</div>`);
          $$('[data-v]', m2).forEach(b => b.onclick = () => { m2.cerrar(); asignar(C.catalogo.find(v => v.id === b.dataset.v)); });
        });
      };
      // una unidad del genérico pasa a ser el modelo real (a su precio)
      const asignar = v => {
        const g = genericas()[0]; if (!g) return;
        g.cantidad -= 1; if (g.cantidad <= 0) C.carrito.lineas.splice(C.carrito.lineas.indexOf(g), 1);
        C.agregar(v, 1); elegidos.push(v); $('#df-q', m).value = ''; pintarPend(); pintarLista(); $('#df-q', m).focus();
        if (!pendientes()) { m.cerrar(); res(true); }
      };
      $('#df-q', m).addEventListener('input', () => pintarLista());
      $('#df-q', m).addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); const q = $('#df-q', m).value.trim(); const r = buscarModelos(q, (pid, vars) => !(C.productos[pid] || {}).es_generico && ($('#df-sinstock', m).checked || sumaStock(vars) > 0)); if (r.length === 1 && r[0].coinciden.length === 1) asignar(r[0].coinciden[0]); else if (r.length === 1 && r[0].vars.length === 1) asignar(r[0].vars[0]); } });
      $('#df-sinstock', m).onchange = pintarLista;
      $('[data-mas]', m).onclick = () => { const g = genericas()[0]; if (g) g.cantidad += 1; else C.agregar(l0.variante, 1); C.pintar(); pintarPend(); };
      $('[data-dejar]', m).onclick = () => { m.cerrar(); res(true); };
      $('[data-ok]', m).onclick = () => { m.cerrar(); res(true); };
      m.addEventListener('click', ev => { if (ev.target === m) { /* fijo: no se cierra tocando afuera */ } });
      pintarPend(); pintarLista(); $('#df-q', m).focus();
    });
  }
  // cobrar y seña pasan primero por la definición de genéricos
  $('#btn-cobrar').onclick = async () => { if (!C.carrito.lineas.length) return; if (await definirModelos()) C.cobrar(false); };
  $('#btn-sena').onclick = async () => { if (!C.carrito.lineas.length) return; if (await definirModelos()) C.cobrar(true); };

  // ================= Teclado numérico =================
  let buffer = '', seleccionada = null;
  const pintarBuffer = () => { $('#tk-buffer').textContent = buffer ? '× ' + buffer : ''; $('#tk-ayuda').textContent = seleccionada != null ? 'Cantidad para la prenda marcada' : 'Cantidad para lo próximo que agregues'; };
  C.tomarCantidad = () => { const n = parseInt(buffer) || 0; buffer = ''; pintarBuffer(); return n > 0 ? n : 1; };
  $$('#teclado button').forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (/^\d$/.test(k)) { if (buffer.length < 3) buffer += k; }
    else if (k === 'borrar') buffer = buffer.slice(0, -1);
    else if (k === 'limpiar') { buffer = ''; seleccionada = null; marcarSeleccion(); }
    else if (k === 'mas') $('#mas').classList.toggle('ver');
    else if (k === 'aplicar') {
      const n = parseInt(buffer) || 0;
      if (seleccionada != null && C.carrito.lineas[seleccionada]) { const l = C.carrito.lineas[seleccionada]; if (n === 0) C.carrito.lineas.splice(seleccionada, 1); else l.cantidad = l.devuelta ? -n : n; buffer = ''; seleccionada = null; C.pintar(); }
      else if (!n) toast('Primero escribí la cantidad');
      else toast(`Se agregará × ${n} a lo próximo que toques`);
    }
    pintarBuffer(); $('#q').focus();
  });
  $('#lineas').addEventListener('click', ev => {
    if (ev.target.closest('button,input')) return;
    const li = ev.target.closest('.linea'); if (!li) return;
    const i = $$('.linea', $('#lineas')).indexOf(li);
    seleccionada = seleccionada === i ? null : i; marcarSeleccion(); pintarBuffer();
  });
  function marcarSeleccion() { $$('.linea', $('#lineas')).forEach((li, i) => li.classList.toggle('sel', i === seleccionada)); if (seleccionada != null && !C.carrito.lineas[seleccionada]) { seleccionada = null; pintarBuffer(); } }
  document.addEventListener('keydown', ev => {
    if (ev.target.closest('input,select,textarea,.modal')) return;
    if (/^\d$/.test(ev.key)) { if (buffer.length < 3) buffer += ev.key; pintarBuffer(); }
    if (ev.key === 'Backspace') { buffer = buffer.slice(0, -1); pintarBuffer(); }
  });
  if (C.catalogo.length) C.alCargar();
});
