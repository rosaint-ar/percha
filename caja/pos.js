/* Percha · Punto de venta: capa visual sobre caja.js (familias, grilla de prendas con foto, teclado numérico).
   Toda la lógica de venta (carrito, promos, cobro, señas, cambios, turno, cola sin internet) vive en caja.js. */
APP.ready.then(async () => {
  const { fmt, esc, $, $$ } = APP, e = APP.empresa.id;
  if (APP.rol === 'visor') return;
  const C = APP.caja;
  $('#pos-empresa').textContent = APP.empresa.nombre; $('#pos-avatar').textContent = APP.iniciales(APP.empresa.nombre);
  $('#btn-menu-pos').onclick = () => document.body.classList.toggle('lateral-abierta');
  const reloj = () => { $('#pos-reloj').textContent = new Date().toLocaleString('es-AR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(/\./g, ''); };
  reloj(); setInterval(reloj, 30000);

  // ================= Familias y grilla =================
  let categorias = [], familia = 'todo', porProducto = new Map();
  const { data: cats } = await sb.from('categorias').select('id,nombre,orden').eq('empresa_id', e).eq('activa', true).order('orden').order('nombre');
  categorias = cats || [];
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function agrupar() {
    porProducto = new Map();
    C.catalogo.forEach(v => { if (!porProducto.has(v.producto_id)) porProducto.set(v.producto_id, []); porProducto.get(v.producto_id).push(v); });
  }
  function pintarFamilias() {
    const cuenta = {}; porProducto.forEach((vars, pid) => { const c = (C.productos[pid] || {}).categoria_id || 'sin'; cuenta[c] = (cuenta[c] || 0) + 1; });
    const recientes = JSON.parse(localStorage.getItem(`percha_recientes_${e}`) || '[]');
    const items = [{ id: 'todo', nombre: 'Todo', n: porProducto.size }, ...(recientes.length ? [{ id: 'recientes', nombre: 'Recientes', n: recientes.length }] : []), ...categorias.filter(c => cuenta[c.id]).map(c => ({ id: c.id, nombre: c.nombre, n: cuenta[c.id] }))];
    $('#familias').innerHTML = items.map(c => `<button class="${c.id === familia ? 'on' : ''}" data-f="${c.id}">${esc(c.nombre)}<b>${fmt.num(c.n)}</b></button>`).join('');
    $$('#familias button').forEach(b => b.onclick = () => { familia = b.dataset.f; $('#q').value = ''; pintarFamilias(); pintarGrilla(); });
  }
  function pintarGrilla() {
    const q = norm($('#q').value.trim()), palabras = q.split(/\s+/).filter(Boolean);
    const recientes = JSON.parse(localStorage.getItem(`percha_recientes_${e}`) || '[]');
    let lista = [...porProducto.entries()];
    if (palabras.length) lista = lista.filter(([pid, vars]) => { const t = norm(`${vars[0].producto_nombre} ${vars[0].producto_codigo} ${vars.map(v => v.color_nombre || '').join(' ')}`); return palabras.every(w => t.includes(w)); });
    else if (familia === 'recientes') lista = recientes.map(pid => [pid, porProducto.get(pid)]).filter(x => x[1]);
    else if (familia !== 'todo') lista = lista.filter(([pid]) => (C.productos[pid] || {}).categoria_id === familia);
    if (!palabras.length && familia !== 'recientes') lista.sort((a, b) => (sumaStock(b[1]) > 0) - (sumaStock(a[1]) > 0) || a[1][0].producto_nombre.localeCompare(b[1][0].producto_nombre));
    const max = 240;
    $('#grilla').innerHTML = lista.slice(0, max).map(([pid, vars]) => {
      const v0 = vars[0], st = sumaStock(vars), foto = (C.productos[pid] || {}).imagen_url, unico = vars.length === 1 && !v0.talle && !v0.color;
      return `<div class="tile-p" data-pid="${pid}">${foto ? `<div class="foto" style="background-image:url('${esc(foto)}')"></div>` : `<div class="foto sinfoto">${esc(APP.iniciales(v0.producto_nombre.replace(/[«»]/g, '')))}</div>`}<span class="st ${st > 0 ? '' : 'cero'}">${fmt.num(st)}</span>
        <div class="txt"><div class="nom">${esc(v0.producto_nombre)}</div><div class="cod">${esc(v0.producto_codigo)}${unico ? '' : ' · ' + vars.length + ' var.'}</div><div class="pre">${fmt.pesos(C.precioLista(v0))}</div></div></div>`;
    }).join('') || '<div class="vacio">Nada con ese nombre.</div>';
    if (lista.length > max) $('#grilla').insertAdjacentHTML('beforeend', `<div class="vacio">Hay ${fmt.num(lista.length - max)} más: afiná la búsqueda.</div>`);
    $$('.tile-p', $('#grilla')).forEach(t => t.onclick = () => { C.elegirProducto(t.dataset.pid); $('#q').value = ''; setTimeout(pintarGrilla, 50); });
  }
  const sumaStock = vars => vars.reduce((s, v) => s + (+v.stock || 0), 0);
  let tq; $('#q').addEventListener('input', () => { clearTimeout(tq); tq = setTimeout(pintarGrilla, 150); });
  // cuando caja.js termina de cargar el catálogo, se arma la grilla; y se vuelve a dibujar tras cada venta
  C.alCargar = () => { agrupar(); pintarFamilias(); pintarGrilla(); };
  const observador = new MutationObserver(() => { marcarSeleccion(); });
  observador.observe($('#lineas'), { childList: true });

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
      else if (!n) APP.toast('Primero escribí la cantidad');
      else APP.toast(`Se agregará × ${n} a lo próximo que toques`);
    }
    pintarBuffer(); $('#q').focus();
  });
  // tocar una línea del ticket la marca; el teclado le cambia la cantidad
  $('#lineas').addEventListener('click', ev => {
    if (ev.target.closest('button,input')) return;
    const li = ev.target.closest('.linea'); if (!li) return;
    const i = $$('.linea', $('#lineas')).indexOf(li);
    seleccionada = seleccionada === i ? null : i; marcarSeleccion(); pintarBuffer();
  });
  function marcarSeleccion() { $$('.linea', $('#lineas')).forEach((li, i) => li.classList.toggle('sel', i === seleccionada)); if (seleccionada != null && !C.carrito.lineas[seleccionada]) { seleccionada = null; pintarBuffer(); } }
  // teclas físicas: números van al buffer solo si el foco no está en un campo
  document.addEventListener('keydown', ev => {
    if (ev.target.closest('input,select,textarea,.modal')) return;
    if (/^\d$/.test(ev.key)) { if (buffer.length < 3) buffer += ev.key; pintarBuffer(); }
    if (ev.key === 'Backspace') { buffer = buffer.slice(0, -1); pintarBuffer(); }
  });
  // el catálogo en memoria ya puede estar listo (caja.js arrancó antes)
  if (C.catalogo.length) C.alCargar();
});
