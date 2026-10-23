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
    return `<div class="tile-p${conFoto ? '' : ' compacta'}" data-pid="${pid}">${!conFoto ? '' : foto ? `<div class="foto"><img src="${esc(foto)}" loading="lazy" alt=""></div>` : `<div class="foto sinfoto">${esc(APP.iniciales(v0.producto_nombre.replace(/[«»]/g, '')))}</div>`}<span class="st ${st > 0 ? '' : 'cero'}">${gen ? '∞' : fmt.num(st)}</span>
      <div class="txt"><div class="nom">${esc(v0.producto_nombre)}</div><div class="cod">${esc(v0.producto_codigo)}${unico ? '' : ' · ' + vars.length + ' var.'}${gen ? ' · al cobrar se elige el modelo' : ''}</div><div class="pre">${fmt.pesos(C.precioLista(v0))}</div></div>${chips}</div>`;
  }
  function activarTiles(cont, alElegir) {
    $$('.tile-p', cont).forEach(t => t.onclick = ev => { const b = ev.target.closest('[data-v]'); if (b) { alElegir(C.catalogo.find(v => v.id === b.dataset.v)); return; } alElegir(null, t.dataset.pid); });
  }
  let grillaMax = 60;
  function pintarGrilla() {
    const q = $('#q').value.trim();
    const recientes = JSON.parse(localStorage.getItem(`percha_recientes_${e}`) || '[]');
    let lista = buscarModelos(q, (pid, vars) => conStock(pid, vars) && (q || familia === 'top' || familia === 'recientes' || (C.productos[pid] || {}).categoria_id === familia));
    if (!q && familia === 'recientes') lista = recientes.map(pid => lista.find(x => x.pid === pid)).filter(Boolean);
    else if (!q && familia === 'top' && masVendidos.length) lista = masVendidos.map(pid => lista.find(x => x.pid === pid)).filter(Boolean).slice(0, 48);
    else if (!q) lista.sort((a, b) => a.vars[0].producto_nombre.localeCompare(b.vars[0].producto_nombre));
    // se dibujan de a 60 para que la pantalla arranque al instante; "Ver más" trae el resto
    const max = q ? 120 : grillaMax;
    $('#grilla').classList.toggle('con-fotos', !!q); $('#grilla').innerHTML = lista.slice(0, max).map(x => tile(x.pid, x.vars, x.coinciden, !!q)).join('') || '<div class="vacio">Nada con ese nombre.</div>';
    if (lista.length > max) $('#grilla').insertAdjacentHTML('beforeend', `<div class="vacio"><button class="btn" id="btn-grilla-mas">Ver ${fmt.num(Math.min(120, lista.length - max))} más</button></div>`);
    const bm = $('#btn-grilla-mas'); if (bm) bm.onclick = () => { grillaMax += 120; pintarGrilla(); };
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
      const elegidos = [];
      const m = modal(`<h2>¿Qué modelos se lleva?</h2><p class="sub">Buscá cada uno (ej. <b>fru cel</b> = Fru Fru celeste) y tocalo. Si no sabés cuál es, dejalo como ${esc(nombreGen)}.</p>
        <div class="pend"><b id="df-n"></b><span class="sub">por definir</span><span class="mult" data-mult><button class="on" data-m="1">×1</button><button data-m="2">×2</button><button data-m="3">×3</button><button data-m="5">×5</button></span><div class="elegidos" id="df-elegidos"></div></div>
        <div class="buscador" style="min-width:0;width:100%"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="df-q" placeholder="Modelo, color, talle…" autocomplete="off"><label class="filtro-stock"><input type="checkbox" id="df-sinstock"> sin stock</label></div>
        <div class="grilla" id="df-grilla"></div>
        <div class="pie"><div style="display:flex;gap:8px"><button class="btn" data-mas>+ Una más</button><button class="btn" data-dejar>Dejar como ${esc(nombreGen)}</button></div><button class="btn primario" data-ok style="padding:12px 22px;font-size:15px">Seguir al cobro</button></div>`, { fijo: true });
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
        const n = Math.min(multDe(m), pendientes()); for (let i = 0; i < n; i++) { const g = genericas()[0]; if (!g) break; g.cantidad -= 1; if (g.cantidad <= 0) C.carrito.lineas.splice(C.carrito.lineas.indexOf(g), 1); elegidos.push(v); }
        C.agregar(v, n); ponerMult(m, 1); $('#df-q', m).value = ''; pintarPend(); pintarLista(); $('#df-q', m).focus();
        if (!pendientes()) { m.cerrar(); res(true); }
      };
      $('#df-q', m).addEventListener('input', () => pintarLista());
      $('#df-q', m).addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); const q = $('#df-q', m).value.trim(); const r = buscarModelos(q, (pid, vars) => !(C.productos[pid] || {}).es_generico && ($('#df-sinstock', m).checked || sumaStock(vars) > 0)); if (r.length === 1 && r[0].coinciden.length === 1) asignar(r[0].coinciden[0]); else if (r.length === 1 && r[0].vars.length === 1) asignar(r[0].vars[0]); } });
      $('#df-sinstock', m).onchange = pintarLista;
      $('[data-mas]', m).onclick = () => { const g = genericas()[0]; if (g) g.cantidad += 1; else C.agregar(l0.variante, 1); C.pintar(); pintarPend(); };
      $('[data-dejar]', m).onclick = () => { m.cerrar(); res(true); };
      $('[data-ok]', m).onclick = () => { m.cerrar(); res(true); };
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
        $('[data-dejar]', m).onclick = () => { l.componentes_ok = true; m.cerrar(); siguiente(); };
        $('[data-ok]', m).onclick = () => { l.componentes_ok = true; m.cerrar(); siguiente(); };
        activarMult(m); pintar(); pintarLista(); $('#dk-q', m).focus();
      };
      siguiente();
    });
  }
  // cobrar y seña pasan primero por la definición de genéricos y de kits
  $('#btn-cobrar').onclick = async () => { if (!C.carrito.lineas.length) return; if (await definirModelos() && await definirKits()) C.cobrar(false); };
  $('#btn-sena').onclick = async () => { if (!C.carrito.lineas.length) return; if (await definirModelos() && await definirKits()) C.cobrar(true); };

  // ================= Más opciones (clienta, nota, descuento, canal) =================
  $('#btn-mas').onclick = () => { const m = $('#mas'); m.classList.toggle('ver'); $('#btn-mas').classList.toggle('on', m.classList.contains('ver')); if (m.classList.contains('ver')) $('#sel-cliente').focus(); };
  if (C.catalogo.length) C.alCargar();
});
