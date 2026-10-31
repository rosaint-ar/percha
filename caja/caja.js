/* Percha · Caja: búsqueda y lector, ticket, promociones, cobro mixto, señas, cambios, turno y arqueo, cola sin internet. */
APP.ready.then(async () => {
  const { fmt, esc, $, $$, toast, modal, confirmar, mensajeError } = APP, e = APP.empresa.id;
  if (APP.rol === 'visor') { $('main').innerHTML = '<div class="card"><p>Tu usuario es de solo lectura: no puede vender.</p></div>'; return; }
  const LS = k => `percha_${k}_${e}`;
  const hoy = () => new Date().toISOString().slice(0, 10);
  const r2 = n => Math.round((+n || 0) * 100) / 100;

  // ================= Datos base =================
  let usosFormas = {};
  let catalogo = [], productos = {}, listas = [], pctx = PRECIOS.armar({}), formas = [], promos = [], vendedoras = [], caja = null, turno = null, clientes = [];
  let carrito = { lineas: [], lista: null, cliente: null, vendedora: APP.user.id, descPct: 0, nota: '', cambio: null };

  async function paginar(consulta, pagina = 1000) {
    let desde = 0, todo = [];
    while (true) { const { data, error } = await consulta().range(desde, desde + pagina - 1); if (error) throw error; todo = todo.concat(data || []); if (!data || data.length < pagina) break; desde += pagina; }
    return todo;
  }
  async function cargarBase() {
    const [l, f, p, v, c, cl] = await Promise.all([
      PRECIOS.cargar(sb, e).catch(() => null),
      sb.from('formas_pago').select('*').eq('empresa_id', e).eq('activa', true).order('orden'),
      sb.from('promociones').select('*').eq('empresa_id', e).eq('activa', true),
      sb.from('empresa_usuarios').select('user_id,nombre,rol').eq('empresa_id', e).eq('activo', true).neq('rol', 'visor').order('nombre'),
      sb.from('cajas').select('*').eq('empresa_id', e).eq('activa', true).order('nombre').limit(1),
      sb.from('clientes').select('id,nombre,telefono,lista_id,direccion,localidad').eq('empresa_id', e).eq('activo', true).eq('generico', false).order('nombre').limit(1000)
    ]);
    // listas, reglas y rebajas: sin internet se usan las últimas guardadas
    if (l && l.listas.length) { pctx = l; try { localStorage.setItem(LS('precios'), JSON.stringify(l.datos)); } catch (_) {} } else { try { const g = JSON.parse(localStorage.getItem(LS('precios')) || 'null'); if (g) pctx = PRECIOS.armar(g); } catch (_) {} }
    listas = PRECIOS.delLocal(pctx); formas = f.data || []; if (window.MEDIOS) { MEDIOS.cargar(sb, e); MEDIOS.listas = Object.fromEntries(listas.map(x => [x.id, x])); } sb.rpc('formas_pago_uso', { e }).then(({ data }) => { usosFormas = Object.fromEntries((data || []).map(x => [x.forma_pago_id, +x.usos])); }); promos = p.data || []; vendedoras = v.data || []; caja = (c.data || [])[0]; clientes = cl.data || [];
    carrito.lista = carrito.lista || (listas.find(x => x.predeterminada) || listas[0] || {}).id;
    // arranque rápido: si hay catálogo guardado de hace menos de 12 h, se usa ya y se refresca en segundo plano
    cargarFallas();
    const guardado = JSON.parse(localStorage.getItem(LS('catalogo')) || 'null');
    const fresco = guardado && Date.now() - guardado.t < 12 * 3600 * 1000;
    if (fresco) { catalogo = guardado.vars; productos = Object.fromEntries(guardado.prods.map(x => [x.id, x])); }
    const traer = async () => {
      const [vars, prods] = await Promise.all([
        paginar(() => sb.from('v_variantes').select('id,producto_id,producto_codigo,producto_nombre,producto_tipo,sku,ean,talle,talle_nombre,talle_orden,color,color_nombre,color_hex,precio,costo,stock,fallas,falla_nota,activa,foto').eq('empresa_id', e).eq('activa', true).order('producto_nombre').order('talle_orden')),
        paginar(() => sb.from('productos').select('id,categoria_id,tipo,activo,imagen_url,es_generico,generico_filtro,generico_local_id').eq('empresa_id', e).eq('activo', true))
      ]);
      productos = Object.fromEntries(prods.map(x => [x.id, x]));
      catalogo = vars.filter(x => productos[x.id === undefined ? '' : x.producto_id]);
      localStorage.setItem(LS('catalogo'), JSON.stringify({ t: Date.now(), vars: catalogo, prods }));
    };
    if (fresco) { traer().then(() => { pintar(); if (APP.caja.alCargar) APP.caja.alCargar(); }).catch(() => {}); }
    else {
      try { await traer(); }
      catch (err) {
        if (guardado) { catalogo = guardado.vars; productos = Object.fromEntries(guardado.prods.map(x => [x.id, x])); toast('Sin conexión: catálogo guardado del ' + fmt.fechaHora(guardado.t), 'error'); }
        else { toast('No se pudo cargar el catálogo', 'error'); }
      }
    }
    const selV = $('#sel-vendedora'); selV.innerHTML = vendedoras.map(x => `<option value="${x.user_id}" ${x.user_id === APP.user.id ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('');
    $('#dl-clientes').innerHTML = clientes.map(x => `<option value="${esc(x.nombre)}">${esc(x.telefono || '')}</option>`).join('');
  }

  // Prendas con falla, una por una (nota, descuento y a qué listas)
  var fallasU;   // var: la carga del catálogo puede llamar a cargarFallas antes de llegar a esta línea
  async function cargarFallas() {
    const { data } = await sb.from('variante_fallas').select('id,variante_id,nota,descuento_pct,listas').eq('empresa_id', e).eq('estado', 'disponible').order('creado');
    fallasU = new Map(); (data || []).forEach(f => { if (!fallasU.has(f.variante_id)) fallasU.set(f.variante_id, []); fallasU.get(f.variante_id).push(f); });
  }
  const unidadesLibres = (v, salvo) => ((fallasU && fallasU.get(v.id)) || []).filter(u => !carrito.lineas.some(l => l !== salvo && l.fallaU && l.fallaU.id === u.id));
  const descFalla = l => { const u = l.fallaU; if (!u || !+u.descuento_pct) return 0; if (u.listas && u.listas.length && !u.listas.includes(carrito.lista)) return 0; return +u.descuento_pct; };
  // "es la de la falla": cada prenda fallada queda en su propia línea, con su nota y su descuento
  function marcarFalla(l) {
    return new Promise(res => {
      const libres = unidadesLibres(l.variante, l);
      const asignar = u => {
        if (l.cantidad > 1) { l.cantidad -= 1; carrito.lineas.splice(carrito.lineas.indexOf(l) + 1, 0, Object.assign({}, l, { cantidad: 1, falla: true, fallaU: u || null })); }
        else { l.falla = true; l.fallaU = u || null; }
        pintar(); res();
      };
      if (libres.length <= 1 || libres.every(u => (u.nota || '') === (libres[0].nota || '') && +u.descuento_pct === +libres[0].descuento_pct)) { asignar(libres[0]); return; }
      const m = modal(`<h2>¿Cuál de las fallas es?</h2><p class="sub">${esc([l.variante.producto_nombre, l.variante.talle_nombre, l.variante.color_nombre].filter(Boolean).join(' · '))}</p>
        <div class="cl-res">${libres.map((u, i) => `<button data-u="${i}"><span>◆ ${esc(u.nota || 'Sin detalle')}</span><small>${+u.descuento_pct ? fmt.dec(u.descuento_pct) + '% off' : 'sin descuento'}</small></button>`).join('')}</div>`, { fijo: true });
      $$('[data-u]', m).forEach(b => b.onclick = () => { m.cerrar(); asignar(libres[+b.dataset.u]); });
    });
  }
  async function marcarFallas(v, n) {
    for (let k = 0; k < n; k++) { const l = carrito.lineas.find(x => x.variante.id === v.id && !x.devuelta && !x.falla); if (!l) break; await marcarFalla(l); }
  }

  // ================= Turno de caja =================
  async function cargarTurno() {
    if (!caja) { $('#estado-caja').innerHTML = '<span class="chip error">Sin caja configurada</span>'; return; }
    const { data } = await sb.from('caja_turnos').select('*').eq('caja_id', caja.id).eq('estado', 'abierto').order('abierto', { ascending: false }).limit(1);
    turno = (data || [])[0] || null;
    if (window.TAREAS) TAREAS.iniciar({ turno: () => turno });   // la rutina del local: aviso amable durante el día
    pintarEstado();
    if (!turno) abrirTurno();
  }
  function pintarEstado() {
    const cola = colaPendiente().length;
    $('#estado-caja').innerHTML = turno
      ? `<span class="punto" id="punto-red"></span><span class="chip ok">Caja abierta</span><span style="font-size:12.5px;color:var(--tinta-3)">${esc(caja.nombre)} · desde ${fmt.fechaHora(turno.abierto)}</span>
         <a class="btn chico" href="caja.html" title="Ingresos, retiros y cierre de caja">💰 Caja</a><a class="btn chico" href="ventas.html">Ventas del día</a><button class="btn chico" id="btn-pedido" type="button" title="Una clienta pidió algo que no hay: anotalo">📝 Lo pidieron</button><button class="btn chico" id="btn-tareas" type="button" title="Las tareas del local de hoy" hidden>✨ Tareas</button><button class="btn chico" id="btn-sonido" title="Prender o apagar los sonidos de la caja">${fx.sonidoActivo() ? '🔊' : '🔇'}</button>
         ${cola ? `<button class="btn chico suave" id="btn-sync">${cola} venta${cola > 1 ? 's' : ''} por subir</button>` : ''}`
      : `<span class="punto off"></span><span class="chip aviso">Caja cerrada</span><button class="btn chico primario" id="btn-abrir">🔓 Abrir caja</button><a class="btn chico" href="ventas.html">Ventas</a><button class="btn chico" id="btn-sonido" title="Prender o apagar los sonidos de la caja">${fx.sonidoActivo() ? '🔊' : '🔇'}</button>`;
    const b = $('#btn-abrir'); if (b) b.onclick = abrirTurno;
    const m = $('#btn-mov'); if (m) m.onclick = movimientoCaja;
    const c = $('#btn-cerrar'); if (c) c.onclick = cerrarTurno;
    if (window.TAREAS) { TAREAS.pintarChip(); const bt = $('#btn-tareas'); if (bt) bt.onclick = TAREAS.panel; }
    const bp = $('#btn-pedido'); if (bp) bp.onclick = () => window.PEDIDO_CLIENTA && PEDIDO_CLIENTA.anotar({ texto: ($('#q') || {}).value ? $('#q').value.trim() : '' });
    const s = $('#btn-sync'); if (s) s.onclick = sincronizar;
    const so = $('#btn-sonido'); if (so) so.onclick = () => { const on = fx.alternarSonido(); so.textContent = on ? '🔊' : '🔇'; toast(on ? 'Sonidos prendidos' : 'Sonidos apagados'); };
    actualizarRed();
  }
  const fx = window.CAJAFX || { sonido() { }, telon: async () => { }, billetes: () => ({ total: () => 0 }), pop() { }, sonidoActivo: () => false, alternarSonido: () => false };
  // abrir, ingresos/retiros y cierre viven en turno.js (los usa también la pantalla Caja)
  async function abrirTurno() { const t = await TURNO.abrir(caja); if (t) { turno = t; pintarEstado(); if (window.TAREAS) setTimeout(() => TAREAS.momento('apertura'), 2400); } }   // después del "¡Caja abierta!": las tareas para arrancar
  function movimientoCaja() { if (turno) TURNO.movimiento(turno); }
  async function cerrarTurno() { if (turno && await TURNO.cerrar(caja, turno, { pendientes: colaPendiente().length })) { turno = null; pintarEstado(); } }

  // ================= Búsqueda =================
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function buscar(q) {
    q = norm(q.trim()); if (!q) return [];
    const exacta = catalogo.filter(v => v.ean === q || norm(v.sku) === q);
    if (exacta.length) return { exacta };
    const palabras = q.split(/\s+/);
    const porProducto = new Map();
    catalogo.forEach(v => {
      const texto = norm(`${v.producto_nombre} ${v.producto_codigo} ${v.color_nombre || ''}`);
      if (palabras.every(w => texto.includes(w))) { if (!porProducto.has(v.producto_id)) porProducto.set(v.producto_id, []); porProducto.get(v.producto_id).push(v); }
    });
    return { productos: [...porProducto.entries()].slice(0, 24) };
  }
  function pintarResultados(res) {
    const cont = $('#resultados');
    if (!res || (!res.exacta && !res.productos)) { cont.innerHTML = ''; return; }
    if (res.exacta) { cont.innerHTML = ''; return; }
    cont.innerHTML = res.productos.map(([pid, vars]) => {
      const v0 = vars[0], st = vars.reduce((s, v) => s + (+v.stock || 0), 0), unico = vars.length === 1 && !v0.talle && !v0.color;
      return `<div class="res" data-pid="${pid}"><div class="nom">${esc(v0.producto_nombre)}</div><div class="cod">${esc(v0.producto_codigo)} · ${unico ? 'único' : vars.length + ' variantes'}</div><div class="pre">${precioProducto(vars)}</div><span class="st chip ${st > 0 ? 'ok' : 'gris'}">${fmt.num(st)}</span></div>`;
    }).join('') || '<div class="vacio">Nada con ese nombre.</div>';
    $$('.res', cont).forEach(el => el.onclick = () => elegirProducto(el.dataset.pid));
  }
  function elegirProducto(pid) {
    const vars = catalogo.filter(v => v.producto_id === pid);
    if (vars.length === 1 && !vars[0].talle && !vars[0].color) { agregar(vars[0]); return; }
    const porColor = [...new Map(vars.map(v => [v.color || '', v])).values()], prod = productos[pid] || {};
    if (porColor.length > 1 && vars.some(v => v.foto && v.foto !== prod.imagen_url)) { elegirConFotos(vars, porColor); return; }
    const m = modal(`<h2>${esc(vars[0].producto_nombre)}</h2><p class="sub">Elegí talle y color</p><div class="matriz-pick">${vars.sort((a, b) => (a.talle_orden ?? 999) - (b.talle_orden ?? 999) || String(a.color_nombre).localeCompare(b.color_nombre)).map(v => `<button data-v="${v.id}" class="${+v.stock > 0 ? '' : 'sin'}">${esc([v.talle_nombre, v.color_nombre].filter(Boolean).join(' · ') || 'único')}<small>${fmt.num(v.stock)} u.${+v.fallas > 0 ? ' · ◆' + fmt.num(v.fallas) + ' con falla' : ''}</small></button>`).join('')}</div>`);
    $$('[data-v]', m).forEach(b => b.onclick = () => { agregar(catalogo.find(v => v.id === b.dataset.v)); m.cerrar(); });
    buscadorPick(m);
  }
  function elegirConFotos(vars, porColor) {
    const orden = (a, b) => (a.talle_orden ?? 999) - (b.talle_orden ?? 999);
    const m = modal(`<h2>${esc(vars[0].producto_nombre)}</h2><p class="sub">Elegí el color y el talle</p><div class="matriz-pick por-color">${porColor.sort((a, b) => String(a.color_nombre || '').localeCompare(b.color_nombre || '')).map(c => {
      const vs = vars.filter(v => (v.color || '') === (c.color || '')).sort(orden), st = vs.reduce((s, v) => s + Math.max(+v.stock || 0, 0), 0);
      return `<div class="pc-col${st > 0 ? '' : ' sin'}"><div class="pc-foto">${c.foto ? `<img src="${esc(c.foto)}" alt="" loading="lazy">` : `<i style="background:${esc(c.color_hex || '#E6DEF0')}"></i>`}</div><b>${esc(c.color_nombre || 'Sin color')}</b>
        <div class="pc-talles">${vs.map(v => `<button data-v="${v.id}" data-txt="${esc([v.talle_nombre, v.color_nombre].filter(Boolean).join(' '))}" class="${+v.stock > 0 ? '' : 'sin'}">${esc(v.talle_nombre || 'único')}<small>${fmt.num(v.stock)} u.${+v.fallas > 0 ? ' · ◆' : ''}</small></button>`).join('')}</div></div>`; }).join('')}</div>`);
    $('.modal', m).style.maxWidth = '760px';
    $$('[data-v]', m).forEach(b => b.onclick = () => { agregar(catalogo.find(v => v.id === b.dataset.v)); m.cerrar(); });
    buscadorPick(m);
  }
  // Cambiar una prenda ya cargada: otro talle/color del mismo producto, u otra prenda. Mantiene cantidad y descuento.
  function cambiarLinea(i) {
    if ((carrito.lineas[i] || {}).variante && carrito.lineas[i].variante.producto_tipo === 'envio') { entrega(); return; }
    const l = carrito.lineas[i]; if (!l || l.devuelta) return;
    const matriz = (vars, actual) => `<div class="matriz-pick">${vars.slice().sort((a, b) => (a.talle_orden ?? 999) - (b.talle_orden ?? 999) || String(a.color_nombre || '').localeCompare(b.color_nombre || '')).map(v => `<button data-v="${v.id}" class="${+v.stock > 0 ? '' : 'sin'}${v.id === actual ? ' actual' : ''}">${esc([v.talle_nombre, v.color_nombre].filter(Boolean).join(' · ') || 'único')}<small>${v.id === actual ? 'la cargada' : fmt.num(v.stock) + ' u.'}${+v.fallas > 0 ? ' · ◆' + fmt.num(v.fallas) : ''}</small></button>`).join('')}</div>`;
    const m = modal('<div id="cl"></div>');
    const reemplazar = v => {
      if (!v) return;
      if (v.id !== l.variante.id) {
        const otra = carrito.lineas.find(x => x !== l && x.variante.id === v.id && !x.devuelta && !x.canje);
        if (otra) { otra.cantidad += l.cantidad; carrito.lineas.splice(carrito.lineas.indexOf(l), 1); }
        else { if (v.producto_id !== l.variante.producto_id && !l.canje) delete l.precioManual; l.variante = v; l.falla = false; delete l.fallaU; delete l.componentes; delete l.componentes_ok; }
        recientes(v); toast('Cambiado por ' + [v.producto_nombre, v.talle_nombre, v.color_nombre].filter(Boolean).join(' · '));
      }
      m.cerrar(); pintar();
    };
    const verProducto = pid => {
      const vars = catalogo.filter(v => v.producto_id === pid);
      if (vars.length === 1 && pid !== l.variante.producto_id) { reemplazar(vars[0]); return; }
      $('#cl', m).innerHTML = `<h2>${esc(vars[0].producto_nombre)}</h2><p class="sub">${pid === l.variante.producto_id ? 'Tocá el talle o color correcto. Se mantiene la cantidad (' + fmt.num(l.cantidad) + ').' : 'Elegí talle y color'}</p>${matriz(vars, l.variante.id)}
        <div class="pie" style="justify-content:space-between"><button class="btn" data-otro>🔎 Es otra prenda</button><button class="btn" data-cerrar>Dejar como está</button></div>`;
      $$('[data-v]', m).forEach(b => b.onclick = () => reemplazar(catalogo.find(v => v.id === b.dataset.v)));
      $('[data-otro]', m).onclick = buscarOtro; $('[data-cerrar]', m).onclick = () => m.cerrar();
      buscadorPick(m);
    };
    const buscarOtro = () => {
      $('#cl', m).innerHTML = `<h2>¿Qué prenda era?</h2><p class="sub">Se cambia "${esc(l.variante.producto_nombre)}" por la que elijas, con la misma cantidad.</p>
        <input class="pick-busca" id="cl-q" placeholder="Escribí el nombre o el código (ej. fru cel)" autocomplete="off"><div id="cl-res" class="cl-res"></div>
        <div class="pie"><button class="btn" data-volver>Volver</button></div>`;
      const q = $('#cl-q', m), res = $('#cl-res', m);
      q.oninput = () => { const r = buscar(q.value);
        if (r.exacta) { res.innerHTML = ''; reemplazar(r.exacta[0]); return; }
        const stk = vars => vars.reduce((t, v) => t + Math.max(+v.stock || 0, 0), 0); res.innerHTML = (r.productos || []).slice().sort((x, y) => stk(y[1]) - stk(x[1])).slice(0, 14).map(([pid, vars]) => `<button data-pid="${pid}"><span>${esc(vars[0].producto_nombre)}</span><small>${fmt.num(vars.reduce((s, v) => s + Math.max(+v.stock || 0, 0), 0))} u.</small></button>`).join('') || (q.value.trim() ? '<div class="vacio">Nada con ese nombre.</div>' : '');
        $$('[data-pid]', res).forEach(b => b.onclick = () => verProducto(b.dataset.pid)); };
      q.onkeydown = ev => { if (ev.key === 'Enter') { const b = $('[data-pid]', res); if (b) b.click(); } };
      $('[data-volver]', m).onclick = () => verProducto(l.variante.producto_id);
      setTimeout(() => q.focus(), 30);
    };
    verProducto(l.variante.producto_id);
  }
  // ================= Modo reservado (Emi) =================
  // Se entra y se sale escribiendo la clave en el buscador + Enter. La clave la valida el servidor y queda solo en memoria.
  let reservado = null, vendedoraAntes = null;
  async function alternarReservado(pin) {
    if (reservado) { if (pin === reservado) salirReservado(); return; }
    let ok = false; try { const r = await sb.rpc('reservado_entrar', { e, p_pin: pin }); ok = r.data === true; if (r.error && /intentos/i.test(r.error.message)) toast(r.error.message, 'error'); } catch (_) {}
    if (!ok) return;   // clave mala: no se dice nada
    reservado = pin; document.body.classList.add('reservado'); pintarNumero();
    const emi = vendedoras.find(v => /^emi/i.test(v.nombre || '')); vendedoraAntes = carrito.vendedora;
    if (emi) { carrito.vendedora = emi.user_id; const sv = $('#sel-vendedora'); if (sv) sv.value = emi.user_id; }
    document.body.insertAdjacentHTML('beforeend', '<div id="barra-reservado"><span>🔒 Modo reservado</span><button type="button" id="btn-reservadas">Ventas reservadas</button><small>Para salir: la clave + Enter en el buscador</small></div>');
    $('#btn-reservadas').onclick = verReservadas;
    pintar(); $('#q').focus();
  }
  function salirReservado() {
    reservado = null; document.body.classList.remove('reservado'); pintarNumero();
    const b = $('#barra-reservado'); if (b) b.remove();
    document.querySelectorAll('.modal-reservadas').forEach(m => m.remove());
    if (vendedoraAntes) { carrito.vendedora = vendedoraAntes; const sv = $('#sel-vendedora'); if (sv) sv.value = vendedoraAntes; }
    pintar(); $('#q').focus();
  }
  async function verReservadas() {
    if (!reservado) return;
    const hoy = new Date(), d = n => { const x = new Date(hoy); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
    const m = modal(`<h2>🔒 Ventas reservadas</h2><div class="filtros-res"><input type="date" id="rv-desde" value="${d(30)}"><span>a</span><input type="date" id="rv-hasta" value="${d(0)}"><b id="rv-total"></b></div><div id="rv-lista" class="rv-lista">Cargando…</div><div class="pie"><button class="btn" data-cerrar>Cerrar</button></div>`);
    m.classList.add('modal-reservadas');
    $('[data-cerrar]', m).onclick = () => m.cerrar();
    const cargarRes = async () => {
      const { data, error } = await sb.rpc('reservadas_listar', { e, p_pin: reservado, p_desde: $('#rv-desde', m).value, p_hasta: $('#rv-hasta', m).value });
      if (error) { $('#rv-lista', m).textContent = mensajeError(error); return; }
      const vs = data || [], ok = vs.filter(v => v.estado !== 'anulada');
      $('#rv-total', m).textContent = ok.length + ' ventas · ' + fmt.pesos(ok.reduce((s, v) => s + +v.total, 0));
      $('#rv-lista', m).innerHTML = vs.map(v => `<details class="rv-venta ${v.estado === 'anulada' ? 'anulada' : ''}"><summary><span class="mono">${esc(v.numero)}</span><span>${fmt.fechaHora(v.fecha)}</span><span>${esc(v.cliente || '—')}</span><b class="mono">${fmt.pesos(v.total)}</b>${v.estado === 'anulada' ? '<span class="chip error">anulada</span>' : ''}</summary>
        <div class="rv-det">${(v.lineas || []).map(l => `<div>${l.n}× ${esc(l.d)} <small>${esc([l.t, l.c].filter(Boolean).join(' · '))}${l.falla ? ' ◆' : ''}</small><span class="mono">${fmt.pesos(l.total)}</span></div>`).join('')}
        <div class="rv-pagos">${(v.pagos || []).map(p => esc(p.forma || 'Pago') + ' ' + fmt.pesos(p.monto)).join(' · ')}${v.vendedora ? ' · atendió ' + esc(v.vendedora) : ''}${v.nota ? ' · ' + esc(v.nota) : ''}${v.anulada_motivo ? ' · anulada: ' + esc(v.anulada_motivo) : ''}</div>
        ${v.estado !== 'anulada' ? `<button class="btn chico peligro" data-anular="${v.id}">Anular (vuelve el stock)</button>` : ''}</div></details>`).join('') || '<p class="sub">No hay ventas reservadas en esas fechas.</p>';
      $$('[data-anular]', m).forEach(b => b.onclick = async () => {
        if (!await confirmar('Se anula la venta y vuelve el stock. ¿Seguimos?', 'Anular')) return;
        const { error: er } = await sb.rpc('reservada_anular', { e, p_pin: reservado, p_venta: b.dataset.anular, p_motivo: 'Anulada desde el modo reservado' });
        if (er) { toast(mensajeError(er), 'error'); return; } toast('Venta anulada, stock devuelto'); cargarBase(); cargarRes(); });
    };
    $('#rv-desde', m).onchange = cargarRes; $('#rv-hasta', m).onchange = cargarRes; cargarRes();
  }
  // Buscador de la ventana "talle y color": se escribe directo (sin tocar nada) y filtra; Enter elige si queda una sola
  function buscadorPick(m) {
    const grilla = $('.matriz-pick', m); if (!grilla) return;
    const botones = $$('button[data-v]', grilla); if (botones.length < 7) return;
    grilla.insertAdjacentHTML('beforebegin', '<input class="pick-busca" placeholder="Escribí el talle o el color (ej. 100, negro, 90 bla)" autocomplete="off">');
    const inp = $('.pick-busca', m), nrm = s => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const textos = botones.map(b => nrm(b.dataset.txt || (b.firstChild ? b.firstChild.textContent : b.textContent)).split(/[\s·/]+/).filter(Boolean));
    const filtrar = () => { const qs = nrm(inp.value).split(/\s+/).filter(Boolean);
      botones.forEach((b, i) => { b.style.display = qs.every(x => textos[i].some(t => t.startsWith(x))) ? '' : 'none'; });
      $$('.pc-col', grilla).forEach(c => { c.style.display = $$('button[data-v]', c).some(b => b.style.display !== 'none') ? '' : 'none'; }); };
    inp.addEventListener('input', filtrar);
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); const vis = botones.filter(b => b.style.display !== 'none'); const conStock = vis.filter(b => !b.classList.contains('sin')); const uno = vis.length === 1 ? vis[0] : (conStock.length === 1 ? conStock[0] : null); if (uno) uno.click(); } });
    setTimeout(() => inp.focus(), 30);
  }
  // Antes de cobrar: avisa si se vende algo que el sistema dice que no hay, o si solo quedan las que tienen falla.
  // Se puede seguir igual: la venta se hace y queda un aviso en "Stock a revisar".
  function revisarStock() {
    return new Promise(resolve => {
      const problemas = () => {
        const g = new Map();
        carrito.lineas.forEach(l => { const v = l.variante; if (!v || l.devuelta || v.producto_tipo === 'kit' || v.producto_tipo === 'envio' || (productos[v.producto_id] || {}).es_generico || /-SD$/.test(v.sku || '')) return;
          const x = g.get(v.id) || { v, normal: 0, falla: 0, lineas: [] }; if (l.falla) x.falla += l.cantidad; else x.normal += l.cantidad; x.lineas.push(l); g.set(v.id, x); });
        const out = [];
        g.forEach(x => { const st = Math.max(+x.v.stock || 0, 0), f = Math.min(+x.v.fallas || 0, st), buenas = st - f;
          if (f > 0 && x.normal > buenas && x.falla < f) out.push({ tipo: 'falla', x, cuantas: Math.min(x.normal - buenas, f - x.falla), st, f, buenas });
          else if (x.normal + x.falla > st) out.push({ tipo: 'sin', x, st, n: x.normal + x.falla }); });
        return out;
      };
      const nombre = v => esc([v.producto_nombre, v.talle_nombre, v.color_nombre].filter(Boolean).join(' · '));
      let ps = problemas(); if (!ps.length) { carrito.avisos = 0; resolve(true); return; }
      const m = modal('<div id="rs"></div>', { fijo: true });
      const pintarRs = () => {
        ps = problemas(); if (!ps.length) { m.cerrar(); carrito.avisos = 0; pintar(); resolve(true); return; }
        $('#rs', m).innerHTML = `<h2>⚠ Revisá antes de cobrar</h2><div class="rs-lista">${ps.map((p, i) => p.tipo === 'falla'
          ? `<div class="rs-item falla"><div><b>${nombre(p.x.v)}</b><span>${p.buenas ? `Hay ${p.buenas} sin falla y estás vendiendo ${p.x.normal}.` : 'La que queda tiene falla.'} ¿Es la de la falla?</span></div><button class="btn primario" data-es-falla="${i}">◆ Sí, es la de la falla</button></div>`
          : `<div class="rs-item sin"><div><b>${nombre(p.x.v)}</b><span>${p.st ? `El sistema dice que hay ${p.st} y estás vendiendo ${p.n}.` : 'El sistema dice que no hay.'}</span></div></div>`).join('')}</div>
          <p class="rs-nota">Si seguís, la venta se hace igual y queda un aviso en <b>Inventario → Stock → Para revisar</b> para corregir el stock.</p>
          <div class="pie"><button class="btn" data-volver>Volver al ticket</button><button class="btn peligro" data-seguir>Vender igual</button></div>`;
        $$('[data-es-falla]', m).forEach(b => b.onclick = async () => { const p = ps[+b.dataset.esFalla]; await marcarFallas(p.x.v, p.cuantas); pintar(); pintarRs(); });
        $('[data-volver]', m).onclick = () => { m.cerrar(); resolve(false); };
        $('[data-seguir]', m).onclick = () => { m.cerrar(); carrito.avisos = ps.length; resolve(true); };
      };
      pintarRs();
    });
  }
  const q = $('#q'); let tq;
  q.addEventListener('input', () => { clearTimeout(tq); tq = setTimeout(() => { const r = buscar(q.value); if (r.exacta && q.value.trim().length >= 8) { agregar(r.exacta[0]); q.value = ''; pintarResultados(null); } else pintarResultados(r); }, 120); });
  q.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && /^\d{4}$/.test(q.value.trim()) && !buscar(q.value).exacta) { ev.preventDefault(); const pin = q.value.trim(); q.value = ''; pintarResultados(null); alternarReservado(pin); return; }
    if (ev.key === 'Enter') { ev.preventDefault(); const r = buscar(q.value); if (r.exacta) { agregar(r.exacta[0]); q.value = ''; pintarResultados(null); } else if (r.productos && r.productos.length) { elegirProducto(r.productos[0][0]); q.value = ''; pintarResultados(null); } }
    if (ev.key === 'Escape') { q.value = ''; pintarResultados(null); }
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === '/' && document.activeElement !== q && !ev.target.closest('.modal') && !/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) { ev.preventDefault(); q.focus(); }
    if (((ev.key === 'Enter' && ev.ctrlKey) || ev.key === 'F9') && !document.querySelector('.modal-fondo')) { ev.preventDefault(); $('#btn-cobrar').click(); }   // por el botón: el POS puede interceptarlo
  });

  // ================= Carrito =================
  // Lista → rebaja → regla de la lista (%, excepciones, precio fijo, redondeo): shared/precios.js
  function precioDe(v, listaId) {
    if (v.producto_tipo === 'envio') return { base: +v.precio || 0, precio: +v.precio || 0, rebaja: null };   // el envío va a su costo, sin lista ni rebajas
    const p = productos[v.producto_id] || {};
    const o = origenVenta(), lc = !listaId && o !== 'local' && pctx.listas.find(l => l.canal === o);   // venta cargada a mano de la tienda online: su lista
    return PRECIOS.calcular(v, listaId || (lc ? lc.id : carrito.lista), pctx, { canal: o, categoria_id: p.categoria_id, tipo: p.tipo || v.producto_tipo });
  }
  function precioLista(v, listaId) { return precioDe(v, listaId).precio; }
  // Precio de un producto para mostrar (tarjetas y resultados): el de sus variantes con stock, no el de la primera.
  // Si los colores tienen precios distintos (cada uno es otra publicación en la web), "desde" el menor.
  function precioProducto(vars) {
    const conStock = vars.filter(v => +v.stock > 0), ps = (conStock.length ? conStock : vars).map(v => precioLista(v)), min = Math.min(...ps);
    return (ps.some(p => p !== min) ? 'desde ' : '') + fmt.pesos(min);
  }
  // ================= Cambios con otro medio de pago =================
  // Lo que devuelve vale lo que pagó, en el medio con que lo pagó: cada prenda devuelta recuerda su lista (listaOrigen) y, si la
  // diferencia se paga con un medio de otra lista, vale lo equivalente ($18.000 por transferencia = $22.500 de Lista).
  // Así el descuento del medio cae solo sobre la diferencia que se paga ahora.
  const pctLista = id => +((listas.find(x => x.id === id) || {}).porcentaje) || 100;
  const nombreLista = id => (listas.find(x => x.id === id) || {}).nombre || '';
  function valorDevuelta(l, listaId) {
    if (!l.listaOrigen || l.listaOrigen === listaId) return l.precioFijo;
    const a = precioLista(l.variante, listaId), b = precioLista(l.variante, l.listaOrigen);
    return Math.round(l.precioFijo * (a > 0 && b > 0 ? a / b : pctLista(listaId) / pctLista(l.listaOrigen)));
  }
  // una nota de crédito vale lo mismo: la de Contado paga más a precio Lista
  const valorCredito = p => !p.listaNc || p.listaNc === carrito.lista ? p.saldo : Math.round(p.saldo * pctLista(carrito.lista) / pctLista(p.listaNc));
  const listasDe = f => f && (f.listas && f.listas.length ? f.listas : f.lista_id ? [f.lista_id] : null);
  // la lista a la que se pagó la venta: la del medio con que se pagó (el ticket puede decir otra si vino de FactuSOL); con varios medios, la del ticket
  function listaPagada(v) {
    const ls = [...new Set((v.pagos || []).filter(p => p.forma_pago_id).map(p => { const lf = listasDe(formas.find(x => x.id === p.forma_pago_id)); return lf && !lf.includes(v.lista_id) ? lf[0] : v.lista_id; }))];
    return (ls.length === 1 ? ls[0] : v.lista_id) || carrito.lista;
  }
  function agregar(v, cantidad) {
    if (!v) return;
    if (v.producto_tipo === 'gift_card' && !carrito.devolviendo) { venderGift(v); return; }
    if (cantidad == null) cantidad = (APP.caja && APP.caja.tomarCantidad && APP.caja.tomarCantidad()) || 1;   // el teclado del POS puede dejar una cantidad lista
    // devolución sin ticket: lo que se toca o escanea entra como devuelto, al precio de hoy (se puede corregir en el renglón)
    if (carrito.devolviendo) {
      const dv = carrito.lineas.find(l => l.variante.id === v.id && l.devuelta && l.sinTicket && !l.parte);
      if (dv) dv.cantidad -= cantidad; else carrito.lineas.push({ variante: v, cantidad: -cantidad, descPct: 0, devuelta: true, sinTicket: true, precioFijo: precioLista(v), listaOrigen: carrito.lista });
      recientes(v); pintar(); $('#q').focus(); return;
    }
    const ya = carrito.lineas.find(l => l.variante.id === v.id && !l.devuelta && !l.canje);
    if (ya) ya.cantidad += cantidad; else carrito.lineas.push({ variante: v, cantidad, descPct: 0 });
    recientes(v); pintar(); $('#q').focus();
    avisoAlAgregar(v, cantidad);
  }
  // Para el ticket: ¿esta línea vende más de lo que el sistema dice que hay?
  const controlaStock = v => v && v.producto_tipo !== 'kit' && v.producto_tipo !== 'envio' && !(productos[v.producto_id] || {}).es_generico && !/-SD$/.test(v.sku || '');
  const llevando = v => carrito.lineas.filter(l => l.variante.id === v.id && !l.devuelta).reduce((t, l) => t + l.cantidad, 0);
  // Primer aviso, apenas se agrega (el segundo es al cobrar): no hay stock, o solo quedan las que tienen falla
  function avisoAlAgregar(v, cantidad) {
    if (!controlaStock(v)) return;
    const st = Math.max(+v.stock || 0, 0), f = Math.min(+v.fallas || 0, st), lleva = llevando(v);
    const conFalla = carrito.lineas.filter(l => l.variante.id === v.id && !l.devuelta && l.falla).reduce((t, l) => t + l.cantidad, 0);
    const soloFalla = f > 0 && lleva - conFalla > st - f && conFalla < f && lleva <= st;
    if (lleva <= st && !soloFalla) return;
    const nom = esc([v.producto_nombre, v.talle_nombre, v.color_nombre].filter(Boolean).join(' · '));
    const m = modal(soloFalla
      ? `<h2>◆ La que queda tiene falla</h2><p><b>${nom}</b></p><p class="sub">${st - f > 0 ? 'Hay ' + (st - f) + ' sin falla y ' + f + ' con falla.' : (f > 1 ? 'Las ' + f + ' que hay tienen falla.' : 'La única que hay en el sistema tiene falla.')} ¿Es la de la falla?</p>
         <div class="pie" style="justify-content:space-between"><button class="btn" data-sacar>Sacarla del ticket</button><div style="display:flex;gap:6px"><button class="btn" data-dejar>No, es otra</button><button class="btn primario" data-falla-si>◆ Sí, es la de la falla</button></div></div>`
      : `<h2>⚠ No hay stock en el sistema</h2><p><b>${nom}</b></p><p class="sub">${st ? 'El sistema dice que hay ' + st + ' y estás llevando ' + lleva + '.' : 'El sistema dice que no hay ninguna.'} Si la tenés en la mano, dejala: queda un aviso para corregir el stock.</p>
         <div class="pie" style="justify-content:space-between"><button class="btn" data-sacar>Sacarla del ticket</button><button class="btn primario" data-dejar>Sí, dejarla</button></div>`, { fijo: true });
    const linea = () => carrito.lineas.find(l => l.variante.id === v.id && !l.devuelta && !l.falla) || carrito.lineas.find(l => l.variante.id === v.id && !l.devuelta);
    $('[data-sacar]', m).onclick = () => { const l = linea(); if (l) { l.cantidad -= cantidad; if (l.cantidad <= 0) carrito.lineas.splice(carrito.lineas.indexOf(l), 1); } m.cerrar(); pintar(); };
    $('[data-dejar]', m).onclick = () => { m.cerrar(); $('#q').focus(); };
    const fs1 = $('[data-falla-si]', m); if (fs1) fs1.onclick = async () => { m.cerrar(); await marcarFallas(v, Math.min(cantidad, f - conFalla)); pintar(); };
    setTimeout(() => (fs1 || $('[data-dejar]', m)).focus(), 30);
  }
  function recientes(v) {
    const lista = JSON.parse(localStorage.getItem(LS('recientes')) || '[]').filter(x => x !== v.producto_id); lista.unshift(v.producto_id);
    localStorage.setItem(LS('recientes'), JSON.stringify(lista.slice(0, 8)));
  }
  function pintarRecientes() {
    const ids = JSON.parse(localStorage.getItem(LS('recientes')) || '[]'), cont = $('#recientes');
    const items = ids.map(pid => catalogo.find(v => v.producto_id === pid)).filter(Boolean);
    cont.innerHTML = items.length ? `<h3>Recientes</h3><div class="resultados">${items.map(v0 => `<div class="res" data-pid="${v0.producto_id}"><div class="nom">${esc(v0.producto_nombre)}</div><div class="cod">${esc(v0.producto_codigo)}</div><div class="pre">${precioProducto(catalogo.filter(v => v.producto_id === v0.producto_id))}</div></div>`).join('')}</div>` : '';
    $$('.res', cont).forEach(el => el.onclick = () => elegirProducto(el.dataset.pid));
  }

  // ---- promociones ----
  const origenVenta = () => (document.getElementById('sel-origen') || {}).value || 'local';
  // el selector de canal de la venta: Local, WhatsApp y cada conexión de la empresa (genérico)
  async function armarCanales() {
    const sel = document.getElementById('sel-origen'); if (!sel || !window.CANALES) return;
    const lista = CANALES.activos(await CANALES.cargar(e)), actual = sel.value;
    sel.innerHTML = lista.map(x => `<option value="${x.k}">${esc(x.n)}</option>`).join('') + (lista.some(x => x.k === 'online') ? '' : '<option value="online">Otra venta online</option>');
    sel.value = lista.some(x => x.k === actual) ? actual : 'local';
    sel.onchange = () => pintar();
  }
  armarCanales();
  function promoAplica(p, v) {
    const d = new Date(); const dow = ((d.getDay() + 6) % 7) + 1; const f = hoy();
    if (p.desde && f < p.desde) return false; if (p.hasta && f > p.hasta) return false;
    if (!(p.dias_semana || []).includes(dow)) return false;
    // en qué canales vale (null = todos) y en qué listas
    if (p.canales && p.canales.length && !p.canales.includes(origenVenta())) return false;
    if (p.listas && p.listas.length && !p.listas.includes(carrito.lista)) return false;
    if (p.alcance === 'familias') return (p.familia_ids || []).includes((productos[v.producto_id] || {}).categoria_id);
    if (p.alcance === 'productos') return (p.producto_ids || []).includes(v.producto_id);
    return (productos[v.producto_id] || {}).tipo === 'prenda';
  }
  function calcular() {
    // precio base por lista, descuento de línea, luego la mejor promo por línea (sin acumular)
    const lineas = carrito.lineas.map(l => { const pc = precioDe(l.variante), pl = pc.precio, df = l.falla ? descFalla(l) : 0; const pu = l.precioManual != null ? r2(l.precioManual) : r2(pl * (1 - Math.max(l.descPct || 0, df) / 100)); return Object.assign(l, { precioLista: pl, precioBase: pc.base, rebaja: pc.rebaja, precioUnit: pu, descFalla: df, promo: null, descPromo: 0 }); });
    promos.forEach(p => {
      const grupo = lineas.filter(l => l.cantidad > 0 && l.precioManual == null && promoAplica(p, l.variante));
      if (!grupo.length) return;
      const unidades = grupo.reduce((s, l) => s + l.cantidad, 0);
      // escalones: vale el más alto alcanzado (3 o más: 20% · 6 o más: 30%)
      const esc = p.tipo === 'cantidad' ? (p.escalones && p.escalones.length ? p.escalones : [{ n: p.n, valor: p.valor }]).filter(x => unidades >= +x.n && (!x.canales || !x.canales.length || x.canales.includes(origenVenta()))).sort((a, b) => b.n - a.n)[0] : null;
      if (p.tipo === 'porcentaje' || esc) {
        const pct = esc ? +esc.valor : +p.valor;
        grupo.forEach(l => { const d = r2(l.precioUnit * pct / 100); if (d > l.descPromo) { l.descPromo = d; l.promo = esc ? Object.assign({}, p, { nombre: p.nombre + (p.escalones && p.escalones.length > 1 ? ` (${esc.n}+: ${esc.valor}%)` : '') }) : p; } });
      } else if (p.tipo === 'monto') {
        grupo.forEach(l => { const d = Math.min(l.precioUnit, +p.valor); if (d > l.descPromo) { l.descPromo = d; l.promo = p; } });
      } else if (p.tipo === 'nxm' && p.n > 0 && p.m > 0 && p.m < p.n) {
        // lleva n paga m: las (n-m) unidades más baratas de cada grupo de n salen gratis
        const unidadesSueltas = []; grupo.forEach(l => { for (let i = 0; i < l.cantidad; i++) unidadesSueltas.push(l); });
        unidadesSueltas.sort((a, b) => b.precioUnit - a.precioUnit);
        const gratis = Math.floor(unidadesSueltas.length / p.n) * (p.n - p.m);
        const porLinea = new Map();
        unidadesSueltas.slice(unidadesSueltas.length - gratis).forEach(l => porLinea.set(l, (porLinea.get(l) || 0) + l.precioUnit));
        porLinea.forEach((descTotal, l) => { const d = r2(descTotal / l.cantidad); if (d > l.descPromo) { l.descPromo = d; l.promo = p; } });
      }
    });
    let subtotal = 0, costo = 0;
    lineas.forEach(l => { l.precioFinal = r2(l.precioUnit - l.descPromo); l.total = r2(l.precioFinal * l.cantidad); subtotal += l.total; costo += (+l.variante.costo || 0) * l.cantidad; });
    const descuento = r2(subtotal * (carrito.descPct || 0) / 100);
    return { lineas, subtotal: r2(subtotal), descuento, total: r2(subtotal - descuento), costo: r2(costo) };
  }
  function pintar() {
    ajustarPartes();
    const c = calcular(), cont = $('#lineas');
    const avisoDev = carrito.devolviendo ? '<div class="modo-dev"><span><b>↩ Devolución sin ticket</b>Tocá o escaneá lo que trae. Después, “Listo” y cargá lo que se lleva.</span><button class="btn chico primario" data-dev-listo>Listo</button></div>' : '';
    if (!c.lineas.length && carrito.devolviendo) cont.innerHTML = avisoDev;
    else if (!c.lineas.length) cont.innerHTML = '<div class="vacio-ticket"><b>Listo para vender</b><span>Tocá una prenda o escaneá el código.</span><small><kbd>/</kbd> buscar · <kbd>F9</kbd> cobrar</small></div>';
    else cont.innerHTML = avisoDev + c.lineas.map((l, i) => `<div class="linea">
      <div><div class="n">${l.canje ? (esGen(l) ? esc(pieza) + ' suelta' : `<span class="cambiable" data-cambiar="${i}" title="Tocá para cambiarla por otra">${esc(l.variante.producto_nombre)}</span>`) + ' <span class="chip">cambio</span>' : l.parte ? esc(l.desc) + ' <span class="chip ok">queda en el local</span>' : l.devuelta ? esc(l.variante.producto_nombre) : `<span class="cambiable" data-cambiar="${i}" title="Tocá para cambiar el talle, el color o la prenda">${esc(l.variante.producto_nombre)}</span>`}${l.devuelta && !l.parte ? ' <span class="chip error">devuelve</span>' : ''}</div><div class="v">${l.canje ? (esGen(l) ? 'se elige al cobrar' : esc([l.variante.talle_nombre, l.variante.color_nombre].filter(Boolean).join(' · ') || 'único')) + ' · por la del conjunto' : l.parte ? 'entra a ' + esc(l.variante.producto_nombre) : l.devuelta ? esc([l.variante.talle_nombre, l.variante.color_nombre].filter(Boolean).join(' · ') || l.variante.sku || '') : `<span class="cambiable" data-cambiar="${i}">${esc([l.variante.talle_nombre, l.variante.color_nombre].filter(Boolean).join(' · ') || 'único')}</span>`}${l.canje ? "" : " · " + fmt.pesos(l.precioLista)}${l.descPct && l.precioManual == null ? ' −' + l.descPct + '%' : ''}${!l.devuelta && controlaStock(l.variante) && llevando(l.variante) > Math.max(+l.variante.stock || 0, 0) ? '<span class="sinstock-chip" title="El sistema dice que no hay suficiente">⚠ sin stock</span>' : ''}</div>${l.precioManual != null && !l.devuelta && !l.canje ? `<div class="promo manual">Precio cambiado a mano</div>` : ''}${l.conv ? `<div class="promo">Pagó ${fmt.pesos(l.conv.pago)} a precio ${esc(nombreLista(l.conv.de))} = ${fmt.pesos(l.precioFinal)} a precio ${esc(nombreLista(carrito.lista))}</div>` : ''}${l.mismoModelo ? `<div class="promo">↔ Mismo modelo y color: se cambia sin diferencia</div>` : ''}${l.gift ? `<div class="promo">🎁 Código <b>${esc(l.gift.codigo)}</b>${l.gift.para ? ' · para ' + esc(l.gift.para) : ''} · vale ${fmt.pesos(l.gift.valor)} · <a href="#" data-gift="${i}">cambiar</a></div>` : ''}${l.rebaja && !l.devuelta && l.precioManual == null ? `<div class="promo">▼ ${esc(l.rebaja.nombre)} · antes ${fmt.pesos(l.precioBase)}</div>` : ''}${l.promo ? `<div class="promo">★ ${esc(l.promo.nombre)} · −${fmt.pesos(l.descPromo)}/u</div>` : ''}${(+l.variante.fallas > 0 || l.falla) && !l.devuelta && !l.canje ? `<button class="falla ${l.falla ? 'on' : ''}" data-falla="${i}" title="${l.falla ? 'Tocá para desmarcar' : esc(l.variante.falla_nota || '')}">${l.falla ? '◆ Con falla' + (l.fallaU && l.fallaU.nota ? ': ' + esc(l.fallaU.nota) : '') + (l.descFalla ? ' · ' + fmt.dec(l.descFalla) + '% off' : '') : '◆ Hay ' + fmt.num(l.variante.fallas) + ' con falla · ¿es esta?'}</button>` : ''}${puedeSinParte(l) ? `<button class="parte-btn" data-parte="${i}" title="${esc(SP.texto)}: el total baja ${fmt.pesos(SP.monto)} (se puede cambiar en el renglón)">${esc(SP.boton)} · −${fmt.pesos(SP.monto)}</button>` : ''}${puedeSinParte(l) && genCanje() ? `<button class="parte-btn" data-cambio="${i}" title="La ${esc(pieza.toLowerCase())} del conjunto queda en el local y se lleva una suelta: al cobrar se elige cuál">${esc(SP.cambio_boton || 'Cambio ' + pieza.toLowerCase())}</button>` : ''}</div>
      <div class="t">${l.devuelta && !l.sinTicket ? fmt.pesos(l.total) : `<input class="pu${l.precioManual != null && !l.canje ? ' manual' : ''}" data-pu="${i}" type="number" min="0" step="1" value="${l.precioFinal}" data-orig="${l.precioFinal}" title="Precio por unidad: escribí otro para cambiarlo (F2)"${APP.puede('descuentos') ? '' : ' readonly'}>${Math.abs(l.cantidad) > 1 ? `<small>${l.cantidad} u. = ${fmt.pesos(l.total)}</small>` : ''}`}</div>
      <div class="ctrl"><button data-i="${i}" data-d="-1">−</button><input data-i="${i}" data-q value="${l.cantidad}"><button data-i="${i}" data-d="1">+</button><span class="desc">desc % <input data-i="${i}" data-desc type="number" min="0" max="100" value="${l.precioManual != null ? 0 : l.descPct || 0}"${l.precioManual != null ? ' disabled title="Tiene precio a mano"' : ''}></span><button class="quitar" data-i="${i}" data-x title="Quitar">×</button></div></div>`).join('');
    $$('[data-d]', cont).forEach(b => b.onclick = () => { const l = carrito.lineas[+b.dataset.i]; l.cantidad += +b.dataset.d * (l.devuelta ? -1 : 1); if ((l.devuelta ? -l.cantidad : l.cantidad) <= 0) carrito.lineas.splice(+b.dataset.i, 1); pintar(); });
    $$('[data-q]', cont).forEach(i => i.onchange = () => { const n = parseInt(i.value) || 0; const l = carrito.lineas[+i.dataset.i]; if (n === 0) carrito.lineas.splice(+i.dataset.i, 1); else l.cantidad = l.devuelta ? -Math.abs(n) : Math.abs(n); pintar(); });
    $$('[data-desc]', cont).forEach(i => i.onchange = () => { if (!APP.puede('descuentos') && +i.value > 0) { toast('Los descuentos los habilita administración', 'error'); i.value = 0; return; } carrito.lineas[+i.dataset.i].descPct = Math.min(100, Math.max(0, +i.value || 0)); pintar(); });
    $$('[data-x]', cont).forEach(b => b.onclick = () => { carrito.lineas.splice(+b.dataset.i, 1); pintar(); });
    $$('[data-pu]', cont).forEach(inp => { inp.onfocus = () => inp.select(); inp.onchange = () => ponerPrecio(+inp.dataset.pu, inp.value);
      inp.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); $('#q').focus(); } else if (ev.key === 'Escape') { inp.value = inp.dataset.orig; $('#q').focus(); } }; });
    $$('[data-parte]', cont).forEach(b => b.onclick = ev => { ev.stopPropagation(); sinParte(carrito.lineas[+b.dataset.parte]); });
    $$('[data-gift]', cont).forEach(a => a.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); const l = carrito.lineas[+a.dataset.gift]; venderGift(l.variante, l); });
    $$('[data-cambio]', cont).forEach(b => b.onclick = ev => { ev.stopPropagation(); sinParte(carrito.lineas[+b.dataset.cambio], true); });
    $$('[data-cambiar]', cont).forEach(el => el.onclick = ev => { ev.stopPropagation(); cambiarLinea(+el.dataset.cambiar); });
    $$('[data-falla]', cont).forEach(b => b.onclick = ev => { ev.stopPropagation(); const l = carrito.lineas[+b.dataset.falla]; if (l.falla) { l.falla = false; delete l.fallaU; pintar(); } else marcarFalla(l); });
    $('#listas').innerHTML = listas.map(l => `<button class="${l.id === carrito.lista ? 'on' : ''}" data-l="${l.id}" title="${+l.porcentaje === 100 ? 'Precio de lista' : (+l.porcentaje < 100 ? '−' + fmt.dec(100 - l.porcentaje) : '+' + fmt.dec(l.porcentaje - 100)) + '% sobre Lista'}">${esc(l.nombre)}</button>`).join('');
    $$('#listas button').forEach(b => b.onclick = () => { carrito.lista = b.dataset.l; pintar(); });
    $('#totales').innerHTML = `<div><span>Subtotal</span><span class="mono">${fmt.pesos(c.subtotal)}</span></div>${c.descuento ? `<div><span>Descuento ${carrito.descPct}%</span><span class="mono">−${fmt.pesos(c.descuento)}</span></div>` : ''}<div class="gran"><span>Total</span><span>${fmt.pesos(c.total)}</span></div>`;
    { const dl = $('[data-dev-listo]', cont); if (dl) dl.onclick = () => { carrito.devolviendo = false; pintar(); $('#q').focus(); }; }
    $('#ticket-sub').textContent = carrito.cambio ? (carrito.cambio.numero ? `Cambio sobre la venta #${carrito.cambio.numero}` : 'Cambio sin ticket') : (c.lineas.length ? (n => n + (n === 1 ? ' prenda' : ' prendas'))(c.lineas.filter(l => !l.parte && !l.canje).reduce((s, l) => s + Math.abs(l.cantidad), 0)) : 'Nueva venta');
    $('#btn-cobrar').disabled = !c.lineas.length;
    { const bs = $('#btn-sena'); bs.disabled = !!carrito.cambio; bs.textContent = c.lineas.length ? 'Dejar seña' : '🎟️ Retirar seña'; }
  }
  $('#btn-vaciar').onclick = async () => { if (!carrito.lineas.length || await confirmar('¿Vaciar el ticket?', 'Vaciar')) { carrito.lineas = []; carrito.cambio = null; carrito.devolviendo = false; carrito.envio = null; pintarEntrega(); carrito.descPct = 0; $('#desc-general').value = 0; $('#nota').value = ''; pintar(); } };
  $('#desc-general').onchange = ev => { if (!APP.puede('descuentos') && +ev.target.value > 0) { toast('Los descuentos los habilita administración', 'error'); ev.target.value = 0; } carrito.descPct = Math.min(100, Math.max(0, +ev.target.value || 0)); pintar(); };
  $('#sel-vendedora').onchange = ev => carrito.vendedora = ev.target.value;

  // ================= Conjunto sin una pieza ("Solo corpiño") o con la pieza cambiada ("Cambio bombacha") =================
  // Config de la empresa (config.sin_parte): en los productos de esa familia, un toque agrega la pieza que queda en el local
  // en −1 (entra a la variante indicada, que no está en la web): el conjunto sale entero del stock. Sigue siendo una venta.
  // · Solo corpiño: la pieza va a −$monto (editable en el renglón).
  // · Cambio: la pieza va a $0 y se suma una suelta a $0 (el genérico que se completa con esa variante: BOMBIS «VARIAS»);
  //   al cobrar se elige cuál se lleva en "¿Qué modelos se lleva?" (pos.js). Si se deja para después, queda en Pendientes como cualquier genérico.
  const SP = ((APP.empresa.config || {}).sin_parte) || null;
  const pieza = SP ? String(SP.texto || 'Pieza').split(/\s+/)[0] : 'Pieza';
  const partesDe = l => carrito.lineas.filter(x => x.parte && x.de === l).reduce((s, x) => s - x.cantidad, 0);
  const puedeSinParte = l => !!SP && !l.devuelta && !l.parte && !l.canje && l.cantidad > 0 && (productos[l.variante.producto_id] || {}).categoria_id === SP.categoria_id && partesDe(l) < l.cantidad;
  const esGen = l => !!(productos[l.variante.producto_id] || {}).es_generico;
  // la suelta de reemplazo: el genérico que se completa con la variante que recibe la pieza
  function genCanje() {
    if (!SP || SP.cambio === false) return null;
    const vl = catalogo.find(x => x.id === SP.variante_id); if (!vl) return null;
    const g = Object.values(productos).find(p => p.es_generico && p.generico_local_id === vl.producto_id);
    return g ? catalogo.find(x => x.producto_id === g.id) || null : null;
  }
  function sinParte(l, cambio) {
    if (!l || !puedeSinParte(l)) return;
    const v = catalogo.find(x => x.id === SP.variante_id); if (!v) { toast('No encuentro la prenda que recibe la pieza: revisá la configuración', 'error'); return; }
    const vg = cambio && genCanje(); if (cambio && !vg) { toast('No encuentro las sueltas para el cambio: revisá la configuración', 'error'); return; }
    const ya = carrito.lineas.find(x => x.parte && x.de === l && !!x.cambio === !!cambio);
    if (ya) ya.cantidad -= 1;
    else carrito.lineas.splice(carrito.lineas.indexOf(l) + 1, 0, { variante: v, cantidad: -1, descPct: 0, devuelta: true, sinTicket: true, parte: true, cambio: !!cambio, de: l, desc: SP.texto, precioFijo: cambio ? 0 : +SP.monto || 0 });
    if (cambio) {
      const ultima = Math.max(...carrito.lineas.map((x, k) => (x === l || x.de === l) ? k : -1));
      carrito.lineas.splice(ultima + 1, 0, { variante: vg, cantidad: 1, descPct: 0, canje: true, de: l, precioManual: 0 });
    }
    pintar();
  }
  // si se quita el conjunto (o baja su cantidad), sus piezas lo acompañan; en el cambio, la que entra y la que se lleva van juntas
  function ajustarPartes() {
    const ls = carrito.lineas, quitar = x => { const k = ls.indexOf(x); if (k >= 0) ls.splice(k, 1); };
    ls.filter(x => (x.parte || x.canje) && (!ls.includes(x.de) || x.de.cantidad <= 0)).forEach(quitar);
    ls.filter(l => ls.some(x => x.de === l)).forEach(l => {
      const pc = ls.find(x => x.parte && x.cambio && x.de === l), sp = ls.find(x => x.parte && !x.cambio && x.de === l);
      const cj = ls.filter(x => x.canje && x.de === l);
      if (!pc) cj.forEach(quitar);
      // tope: no más piezas que conjuntos (primero se recorta el cambio)
      let exceso = (sp ? -sp.cantidad : 0) + (pc ? cj.reduce((t, x) => t + x.cantidad, 0) : 0) - l.cantidad;
      for (let k = cj.length - 1; k >= 0 && exceso > 0 && pc; k--) { const d = Math.min(exceso, cj[k].cantidad); cj[k].cantidad -= d; exceso -= d; if (cj[k].cantidad <= 0) quitar(cj[k]); }
      if (exceso > 0 && sp) { sp.cantidad += exceso; if (sp.cantidad >= 0) quitar(sp); }
      if (pc) { const n = ls.filter(x => x.canje && x.de === l).reduce((t, x) => t + x.cantidad, 0); if (n > 0) pc.cantidad = -n; else quitar(pc); }
    });
  }

  // ================= Precio a mano =================
  // El precio por unidad es un campo en el renglón: se escribe otro y manda sobre la lista, el desc % y las promos. Pide el permiso de descuentos.
  // Escribir el de lista (o dejarlo vacío) lo vuelve a la normalidad.
  function ponerPrecio(i, valor) {
    const l = carrito.lineas[i]; if (!l || (l.devuelta && !l.sinTicket)) return;
    if (!APP.puede('descuentos')) { toast('Cambiar el precio lo habilita administración (permiso de descuentos)', 'error'); pintar(); return; }
    const v = valor === '' ? null : r2(+valor);
    if (l.devuelta) { l.precioFijo = v == null || !(v >= 0) ? precioLista(l.variante) : v; if (!l.parte) l.listaOrigen = carrito.lista; pintar(); return; }
    if (v == null || !(v >= 0) || v === r2(l.precioLista)) delete l.precioManual;
    else if (v !== r2(l.precioFinal) || l.precioManual != null) { l.precioManual = v; l.descPct = 0; }
    pintar();
  }
  // F2: va al campo del precio del renglón
  function cambiarPrecio(i) {
    const inp = document.querySelector('#lineas [data-pu="' + i + '"]'); if (!inp) return;
    if (inp.readOnly) { toast('Cambiar el precio lo habilita administración (permiso de descuentos)', 'error'); return; }
    inp.focus(); inp.select();
  }

  // ================= Cobro =================
  // a qué lista pasa el ticket al cobrar con este medio: si el medio vale para todas o para la del ticket, no cambia; si no, va a la primera que admite
  function listaDeForma(f) {
    const ls = f && f.listas && f.listas.length ? f.listas : (f && f.lista_id ? [f.lista_id] : null);
    if (!ls || ls.includes(carrito.lista)) return null;
    return listas.find(l => l.id === ls[0]) || null;
  }
  async function cobrar(modoSena) {
    const c = calcular(); if (!c.lineas.length) return;
    if (!turno && !reservado) { toast('Primero abrí la caja', 'error'); abrirTurno(); return; }
    if (modoSena && c.lineas.some(l => l.gift)) { toast('Las gift cards no se señan: cobralas completas', 'error'); return; }
    if (!(await revisarStock())) return;
    const pagos = []; let creditoUsado = null;
    const total = () => { const cc = calcular(); const recargo = pagos.reduce((s, p) => s + r2(p.monto * (p.recargo_pct || 0) / 100), 0); return { ...cc, recargo: r2(recargo), aPagar: r2(cc.total + recargo) }; };
    const m = modal(`<h2>${modoSena ? 'Dejar seña' : (c.total < 0 ? 'Devolver dinero' : 'Cobrar')} <span class="mono" id="cb-total" style="float:right"></span></h2>
      <p class="sub">${modoSena ? 'Pago a cuenta; el resto queda como saldo.' : 'Tocá un medio de pago: se completa con lo que falta. Podés combinar varios.'}</p>
      <div id="cb-cambio"></div>
      ${window.MEDIOS ? MEDIOS.botonera(formas, usosFormas, listaDeForma) : `<div class="formas" style="margin-top:12px">${formas.map(f => `<button data-f="${f.id}">${esc(f.nombre)}</button>`).join('')}<button data-cred>Nota de crédito / gift card</button></div>`}
      <div class="pagos-lista" id="cb-pagos"></div>
      <div class="resto" id="cb-resto"></div>
      <div class="pie"><button class="btn" data-no>Cancelar</button><button class="btn primario" data-si disabled>Confirmar</button></div>`, { fijo: true });
    { const caja_ = $('.modal', m); if (caja_ && window.MEDIOS) caja_.style.maxWidth = '660px'; }
    // Cambio: lo que devuelve vale lo que pagó, en el medio con que lo pagó. La diferencia según con qué pague ahora,
    // y si hay que devolver plata, por el mismo medio con que pagó (en la misma proporción si fueron varios).
    const orig = !modoSena && carrito.cambio && carrito.cambio.pagos ? carrito.cambio.pagos : null;
    const devolviendo = () => !modoSena && total().aPagar < 0;
    const origDe = id => orig ? orig.filter(p => p.forma_pago_id === id).reduce((s, p) => s + +p.monto, 0) : 0;
    const origTotal = orig ? orig.reduce((s, p) => s + +p.monto, 0) : 0;
    if (!modoSena && carrito.cambio && c.lineas.some(l => l.devuelta && l.listaOrigen)) {
      const caja_ = $('#cb-cambio', m), ver = [];
      if (c.total < 0 && orig && orig.length) {
        const fs = orig.filter(p => p.forma_pago_id);
        caja_.innerHTML = `<div class="aviso-caja info"><b>Le sobra ${fmt.pesos(-c.total)}.</b> Pagó con ${orig.map(p => esc(p.nombre) + ' ' + fmt.pesos(p.monto)).join(' + ')}: si quiere la plata, va por ${fs.length > 1 ? 'los mismos medios, en la misma proporción' : 'el mismo medio'}. Si no, queda en nota de crédito.${fs.length ? ' <button type="button" class="btn chico primario" data-devolver>Devolver por ' + esc(fs.length > 1 ? 'los mismos medios' : fs[0].nombre) + '</button>' : ''}</div>`;
      } else if (c.total > 0 && c.lineas.some(l => !l.devuelta && l.cantidad > 0)) {
        // cuánto paga según la lista de cada medio (Contado, Débito, Lista…)
        const ids = [...new Set(formas.map(f => (listaDeForma(f) || {}).id || carrito.lista))];
        const antes = carrito.lista;
        listas.filter(x => ids.includes(x.id)).forEach(x => { carrito.lista = x.id; ver.push([x, calcular().total]); });
        carrito.lista = antes; calcular(); ver.sort((a, b) => a[1] - b[1]);
        if (new Set(ver.map(x => x[1])).size > 1) caja_.innerHTML = `<div class="aviso-caja info"><b>Lo que devuelve vale lo que pagó, con el medio que pagó.</b> La diferencia: ${ver.map(([x, t]) => `precio ${esc(x.nombre)} <b>${fmt.pesos(t)}</b>`).join(' · ')}</div>`;
      }
    }
    // las notas de crédito se recalculan si cambia la lista del ticket (una de Contado paga más a precio Lista)
    const recalcCreditos = () => { let resto = total().aPagar; pagos.forEach(p => { if (p.credito_id) { p.monto = Math.max(0, Math.min(valorCredito(p), r2(resto))); resto = r2(resto - p.monto); } }); };
    const pintarPagos = () => {
      const t = total(); $('#cb-total', m).textContent = fmt.pesos(t.aPagar);
      const pagado = r2(pagos.reduce((s, p) => s + p.monto, 0)); const resto = r2(t.aPagar - pagado);
      $('#cb-pagos', m).innerHTML = pagos.map((p, i) => `<div class="pago"><div>${esc(p.nombre)}${p.recargo_pct ? ` <small style="color:var(--tinta-3)">+${p.recargo_pct}% = ${fmt.pesos(r2(p.monto * p.recargo_pct / 100))}</small>` : ''}</div><input type="number" step="1" value="${p.monto}" data-i="${i}"><button class="x" data-i="${i}">×</button></div>`).join('');
      $$('input[data-i]', m).forEach(i => i.onchange = () => { pagos[+i.dataset.i].monto = r2(+i.value || 0); pintarPagos(); });
      $$('button.x', m).forEach(b => b.onclick = () => { pagos.splice(+b.dataset.i, 1); pintarPagos(); });
      const r = $('#cb-resto', m), efectivo = pagos.filter(p => p.tipo === 'efectivo').reduce((s, p) => s + p.monto, 0);
      let ok;
      if (modoSena) { ok = pagado > 0 && pagado < t.aPagar; r.className = 'resto ' + (ok ? 'ok' : 'falta'); r.innerHTML = `<span>Seña</span><span>${fmt.pesos(pagado)} · saldo ${fmt.pesos(resto)}</span>`; }
      else if (t.aPagar < 0 && !pagos.length) { ok = true; r.className = 'resto ok'; r.innerHTML = `<span>Se emite nota de crédito</span><span>${fmt.pesos(-t.aPagar)}</span>`; }
      else if (t.aPagar < 0 && Math.abs(resto) < 0.5) { ok = true; r.className = 'resto ok'; r.innerHTML = '<span>Dinero devuelto</span><span>✓</span>'; }
      else if (t.aPagar < 0) { ok = false; r.className = 'resto falta'; r.innerHTML = `<span>Falta devolver</span><span>${fmt.pesos(-resto)}</span>`; }
      else if (Math.abs(resto) < 0.5) { ok = true; r.className = 'resto ok'; r.innerHTML = '<span>Completo</span><span>✓</span>'; }
      else if (resto < 0 && efectivo >= -resto) { ok = true; r.className = 'resto vuelto'; r.innerHTML = `<span>Vuelto</span><span>${fmt.pesos(-resto)}</span>`; }
      else if (resto < 0) { ok = false; r.className = 'resto falta'; r.innerHTML = `<span>Sobra ${fmt.pesos(-resto)}: solo hay vuelto en efectivo</span><span></span>`; }
      else { ok = false; r.className = 'resto falta'; r.innerHTML = `<span>Falta</span><span>${fmt.pesos(resto)}</span>`; }
      $('[data-si]', m).disabled = !ok;
    };
    // devolución de un cambio: solo por los medios con que pagó (administración puede elegir otro, avisando)
    if (orig && devolviendo()) $$('[data-f]', m).forEach(b => { if (!origDe(b.dataset.f)) { b.classList.add('mp-otro'); b.style.opacity = '.4'; b.title = 'Pagó con otro medio: la plata se devuelve por el mismo'; } });
    $$('[data-f]', m).forEach(b => b.onclick = async () => {
      const f = formas.find(x => x.id === b.dataset.f);
      if (orig && devolviendo() && !origDe(f.id)) {
        if (!APP.puede('descuentos')) { toast('Pagó con ' + orig.map(p => p.nombre).join(' y ') + ': la plata se devuelve por el mismo medio (o queda nota de crédito)', 'error'); return; }
        if (!(await confirmar(`Pagó con ${orig.map(p => p.nombre).join(' y ')}. ¿Devolver igual por ${f.nombre}?`, 'Devolver por ' + f.nombre))) return;
      }
      // si el medio tiene lista propia y es el primer pago (las notas de crédito no cuentan), el ticket pasa a esa lista.
      // Devolviendo plata no: se devuelve a la lista con que pagó
      const lf = listaDeForma(f); if (lf && !pagos.some(p => !p.credito_id) && carrito.lista !== lf.id && !devolviendo()) { carrito.lista = lf.id; pintar(); recalcCreditos(); }
      const t = total(); const pagado = pagos.reduce((s, p) => s + p.monto, 0);
      let monto = r2(t.aPagar - pagado); if (f.recargo_pct) monto = r2((t.total + pagos.reduce((s, p) => s + r2(p.monto * (p.recargo_pct || 0) / 100), 0) - pagado) / (1 + f.recargo_pct / 100));
      if (modoSena && !pagos.length) monto = r2(Math.round(t.aPagar / 2 / 100) * 100);
      // devolviendo con varios medios: a cada uno, su parte de lo que pagó
      if (t.aPagar < 0 && origDe(f.id) && origTotal > 0) monto = Math.max(monto, -r2(-t.aPagar * origDe(f.id) / origTotal) - pagos.filter(p => p.forma_pago_id === f.id).reduce((s, p) => s + p.monto, 0));
      if (t.aPagar < 0 && monto >= 0) return;
      pagos.push({ forma_pago_id: f.id, nombre: f.nombre, tipo: f.tipo, cuotas: f.cuotas, recargo_pct: +f.recargo_pct || 0, monto: t.aPagar < 0 ? Math.min(0, monto) : Math.max(0, monto) }); pintarPagos();
    });
    { const bd = $('[data-devolver]', m); if (bd) bd.onclick = () => { pagos.splice(0); [...new Set(orig.filter(p => p.forma_pago_id).map(p => p.forma_pago_id))].forEach(id => { const b = $(`[data-f="${id}"]`, m); if (b) b.click(); }); pintarPagos(); }; }
    $('[data-cred]', m).onclick = () => {
      const m2 = modal(`<h2>Pagar con crédito</h2><div class="campo" style="margin-top:12px"><label>Código de la nota de crédito o gift card</label><input id="cr-cod" placeholder="8 letras y números" style="text-transform:uppercase;font-family:var(--f-mono)"></div><div class="pie"><button class="btn" data-no>Volver</button><button class="btn primario" data-si>Aplicar</button></div>`);
      $('[data-no]', m2).onclick = () => m2.cerrar();
      $('[data-si]', m2).onclick = async () => {
        const codigo = $('#cr-cod', m2).value.trim().toUpperCase(); if (!codigo) return;
        const { data } = await sb.from('creditos').select('*').eq('empresa_id', e).eq('codigo', codigo).maybeSingle();
        if (!data || data.estado !== 'vigente' || +data.saldo <= 0) { toast('Ese código no tiene saldo vigente', 'error'); return; }
        if (pagos.some(p => p.credito_id === data.id)) { toast('Ese crédito ya está aplicado', 'error'); return; }
        const t = total(); const pagado = pagos.reduce((s, p) => s + p.monto, 0);
        const pc = { credito_id: data.id, nombre: `${data.tipo === 'gift_card' ? 'Gift card' : 'Nota de crédito'} ${data.codigo} (saldo ${fmt.pesos(data.saldo)}${data.lista_id ? ' a precio ' + nombreLista(data.lista_id) : ''})`, tipo: 'credito', saldo: +data.saldo, listaNc: data.lista_id || null, esGift: data.tipo === 'gift_card' };
        pc.monto = Math.max(0, Math.min(valorCredito(pc), r2(t.aPagar - pagado))); pagos.push(pc);
        m2.cerrar(); pintarPagos();
      };
    };
    pintarPagos();
    $('[data-no]', m).onclick = () => m.cerrar();
    $('[data-si]', m).onclick = async () => {
      $('[data-si]', m).disabled = true;
      const t = total(); const pagado = r2(pagos.reduce((s, p) => s + p.monto, 0));
      // el vuelto se descuenta del efectivo
      const pagosFinal = pagos.map(p => ({ ...p })); const vuelto = t.aPagar > 0 ? r2(pagado - t.aPagar) : 0;
      if (!modoSena && vuelto > 0) { const ef = pagosFinal.find(p => p.tipo === 'efectivo'); ef.monto = r2(ef.monto - vuelto); }
      const creditos_a_emitir = [];
      if (!modoSena && t.aPagar < 0) {
        // devolución con saldo a favor: nota de crédito salvo que se haya devuelto en efectivo
        const devuelto = pagosFinal.reduce((s, p) => s + p.monto, 0);
        if (Math.abs(devuelto - t.aPagar) > 0.5) { creditos_a_emitir.push({ tipo: 'nota_credito', monto: r2(-t.aPagar - (-devuelto)), cliente_id: carrito.cliente, vence: null, nota: 'Por cambio/devolución', lista_id: carrito.lista }); }
      }
      // gift cards vendidas: una por renglón, con el código elegido, a precio de lista (lo que vale en la web)
      if (!modoSena) t.lineas.filter(l => l.gift && l.cantidad > 0).forEach(l => creditos_a_emitir.push({ tipo: 'gift_card', codigo: l.gift.codigo, monto: l.gift.valor, lista_id: listaBase(), cliente_id: carrito.cliente, vence: null, nota: 'Gift card vendida', dedicatoria: { para: l.gift.para || null, de: l.gift.de || null, mensaje: l.gift.mensaje || null } }));
      const cliente = await resolverCliente();
      const payload = {
        empresa_id: e, offline_id: crypto.randomUUID(), tipo: carrito.cambio ? 'cambio' : 'venta', estado: modoSena ? 'senada' : 'completada',
        caja_id: reservado ? null : caja.id, turno_id: reservado ? null : turno.id, reservada: !!reservado, pin: reservado || undefined, cliente_id: cliente, vendedora_id: carrito.vendedora, lista_id: carrito.lista,
        descuento_pct: carrito.descPct || 0, descuento: t.descuento, recargo: t.recargo, nota: $('#nota').value.trim() || null,
        envio: carrito.envio || null,
        numero: reservado ? null : numeroRes,   // el número que se ve en el ticket desde que empezó la venta
        venta_origen_id: carrito.cambio ? carrito.cambio.id : null, origen: ($('#sel-origen') || {}).value || 'local',
        lineas: t.lineas.map(l => ({ variante_id: l.variante.id, producto_id: l.variante.producto_id, descripcion: (l.desc || l.variante.producto_nombre) + (l.gift ? ' ' + l.gift.codigo : ''), talle: l.variante.talle_nombre, color: l.variante.color_nombre, cantidad: l.cantidad, precio_lista: l.precioLista, precio_unit: l.precioFinal, descuento_pct: l.descPct || 0, promocion_id: l.promo ? l.promo.id : null, promocion_nombre: l.promo ? l.promo.nombre : null, total: l.total, costo_unit: +l.variante.costo || 0, componentes: l.componentes && l.componentes.length ? l.componentes : null, falla: !!l.falla, falla_id: l.fallaU ? l.fallaU.id : null, precio_manual: l.precioManual != null || undefined })),
        pagos: pagosFinal.filter(p => p.monto !== 0).map(p => ({ forma_pago_id: p.forma_pago_id || null, credito_id: p.credito_id || null, monto: p.monto, cuotas: p.cuotas || 1, recargo_pct: p.recargo_pct || 0,
          // nota de crédito de otra lista: lo que se descuenta de su saldo (paga $2.500 a precio Lista, descuenta $2.000 de Contado)
          consumo: p.credito_id && p.listaNc && p.listaNc !== carrito.lista ? (p.monto >= valorCredito(p) - 0.5 ? p.saldo : r2(p.monto * pctLista(p.listaNc) / pctLista(carrito.lista))) : undefined })),
        creditos_a_emitir
      };
      // la ventana de cobro queda abierta mientras se registra: si falla, se ve el error y se puede reintentar
      const bSi = $('[data-si]', m); bSi.textContent = 'Registrando…';
      let res;
      try { res = await enviarVenta(payload); }
      catch (err) { bSi.disabled = false; bSi.textContent = 'Confirmar'; const r = $('#cb-resto', m); if (r) { r.className = 'resto falta'; r.innerHTML = `<span>No se pudo registrar: ${esc(mensajeError(err))}</span><span>Probá de nuevo</span>`; } return; }
      m.cerrar();
      // si se pagó con gift cards, su cupón de la web baja al saldo que queda (o se apaga)
      if (!res.pendiente && window.NOTA_CREDITO) pagosFinal.filter(p => p.credito_id && p.esGift).forEach(p => NOTA_CREDITO.cupon(e, p.credito_id, 'sincronizar').catch(err => toast('No se pudo actualizar el cupón de la web: ' + err.message, 'error')));
      const numTxt = res.numero_mostrar || (res.numero ? '#' + String(res.numero).padStart(6, '0') : '');
      toast(res.pendiente ? 'Venta guardada: se sube sola cuando vuelva internet' : payload.tipo === 'cambio' ? `✓ Cambio ${numTxt} registrado` : `✓ Venta ${numTxt} registrada`);
      try { mostrarTicket(payload, res, { vuelto: vuelto > 0 ? vuelto : 0, pagos: pagosFinal, total: t }); }
      catch (err) { console.error(err); modal(`<h2>✓ Venta ${esc(numTxt)} registrada</h2><div style="font:800 30px var(--f-titulo);margin:6px 0">${fmt.pesos(t.aPagar)}</div>${vuelto > 0 ? `<div class="aviso-caja info">Vuelto: <b>${fmt.pesos(vuelto)}</b></div>` : ''}<div class="pie"><button class="btn primario" onclick="this.closest('.modal-fondo').remove()">Listo</button></div>`); }
      cargarFallas(); setTimeout(pintarAvisosStock, 1200);
      if (carrito.avisos) { toast('Venta hecha. Quedó un aviso para corregir el stock en Inventario', 'error'); carrito.avisos = 0; setTimeout(pintarAvisosStock, 1500); }
      carrito.lineas = []; carrito.cambio = null; carrito.devolviendo = false; carrito.envio = null; pintarEntrega(); carrito.descPct = 0; $('#desc-general').value = 0; $('#nota').value = ''; $('#sel-cliente').value = ''; if ($('#sel-origen')) $('#sel-origen').value = 'local';
      carrito.lista = (listas.find(x => x.predeterminada) || listas[0] || {}).id;   // la próxima venta arranca con la lista base
      if (!payload.reservada) reservarNumero(true);   // la próxima venta ya tiene su número
      // el stock del catálogo en memoria
      payload.lineas.forEach(l => { const v = catalogo.find(x => x.id === l.variante_id); if (v && v.producto_tipo !== 'kit') v.stock = (+v.stock || 0) - l.cantidad; });
      if (payload.lineas.some(l => (catalogo.find(x => x.id === l.variante_id) || {}).producto_tipo === 'kit')) cargarBase();   // los kits y sus componentes se recalculan en la base
      pintar(); pintarRecientes();
    };
  }
  async function resolverCliente() {
    const nombre = $('#sel-cliente').value.trim(); if (!nombre) return null;
    const ya = clientes.find(c => norm(c.nombre) === norm(nombre)); if (ya) { if (ya.lista_id) {} return ya.id; }
    const r = await sb.from('clientes').insert(APP.conEmpresa({ nombre })).select().single();
    if (r.error) return null; clientes.push(r.data); return r.data.id;
  }
  // ================= Entrega (envío) =================
  // la venta puede llevar una entrega: medio (retiro, cadete, correo…), costo, dirección y contacto. Queda en Envíos para despachar.
  let metodosEnvio = null;
  const lineaEnvio = () => carrito.lineas.find(l => l.variante && l.variante.producto_tipo === 'envio');
  function pintarEntrega() { const b = document.getElementById('btn-entrega'); if (b) b.innerHTML = carrito.envio ? '🚚 ' + esc(carrito.envio.metodo) + (carrito.envio.costo ? ' · ' + fmt.pesos(carrito.envio.costo) : '') : '🚚 Entrega'; }
  async function entrega() {
    if (!metodosEnvio) { const { data } = await sb.from('envio_metodos').select('*').eq('empresa_id', e).eq('activo', true).order('orden'); metodosEnvio = data || []; }
    if (!metodosEnvio.length) { toast('No hay medios de envío: se cargan en Configuración › Envíos', 'error'); return; }
    const act = carrito.envio || {}; let sel = metodosEnvio.find(x => x.id === act.metodo_id) || null;
    const cli = clientes.find(c => norm(c.nombre) === norm($('#sel-cliente').value.trim()));
    const m = modal(`<h2>Entrega</h2><p class="sub">Cómo le llega a la clienta. Queda en <b>Envíos</b> para despachar.</p>
      <div class="campo"><label>Medio</label><div style="display:flex;gap:6px;flex-wrap:wrap">${metodosEnvio.map(x => `<button type="button" class="btn chico${sel && sel.id === x.id ? ' primario' : ''}" data-me="${x.id}">${esc(x.nombre)}</button>`).join('')}</div></div>
      <div class="campo"><label>Costo del envío (lo paga la clienta)</label><input id="en-costo" type="number" min="0" step="10" value="${act.costo ?? (sel ? sel.costo : 0)}"></div>
      <div class="campo" id="en-dir-c"><label>Dirección</label><input id="en-dir" value="${esc(act.direccion || (cli && [cli.direccion, cli.localidad].filter(Boolean).join(', ')) || '')}" placeholder="Calle, número, piso, localidad"></div>
      <div class="campo"><label>Contacto</label><input id="en-con" value="${esc(act.contacto || (cli && cli.telefono) || '')}" placeholder="Teléfono o quién recibe"></div>
      <div class="pie">${carrito.envio ? '<button class="btn" data-quitar style="margin-right:auto">Sin entrega</button>' : ''}<button class="btn" data-no>Cancelar</button><button class="btn primario" data-si>Listo</button></div>`);
    const marcar = () => { $$('[data-me]', m).forEach(b => b.classList.toggle('primario', !!sel && b.dataset.me === sel.id)); $('#en-dir-c', m).style.display = sel && !sel.pide_direccion ? 'none' : ''; };
    $$('[data-me]', m).forEach(b => b.onclick = () => { sel = metodosEnvio.find(x => x.id === b.dataset.me); const ci = $('#en-costo', m); ci.value = sel.tipo === 'cadete' ? '' : (sel.costo || 0); marcar(); if (sel.tipo === 'cadete') { ci.placeholder = 'Lo que cobra el cadete'; ci.focus(); } });   // el cadete se carga en el momento
    marcar();
    $('[data-no]', m).onclick = () => m.cerrar();
    const q = $('[data-quitar]', m); if (q) q.onclick = () => { carrito.envio = null; const l = lineaEnvio(); if (l) carrito.lineas.splice(carrito.lineas.indexOf(l), 1); m.cerrar(); pintarEntrega(); pintar(); };
    $('[data-si]', m).onclick = () => {
      if (!sel) { toast('Elegí el medio', 'error'); return; }
      const costo = Math.max(0, +$('#en-costo', m).value || 0);
      carrito.envio = { metodo_id: sel.id, metodo: sel.nombre, costo, direccion: sel.pide_direccion ? $('#en-dir', m).value.trim() : '', contacto: $('#en-con', m).value.trim() };
      // el costo va como un renglón "Envío" del ticket (sin stock, sin lista ni rebajas)
      const l = lineaEnvio();
      if (costo > 0) { const v = { id: null, producto_id: null, producto_nombre: 'Envío · ' + sel.nombre, producto_tipo: 'envio', precio: costo, costo: 0, stock: 0 }; if (l) l.variante = v; else carrito.lineas.push({ variante: v, cantidad: 1, descPct: 0 }); }
      else if (l) carrito.lineas.splice(carrito.lineas.indexOf(l), 1);
      m.cerrar(); pintarEntrega(); pintar();
    };
  }
  { const n = document.getElementById('nota'); if (n && !document.getElementById('btn-entrega')) { n.insertAdjacentHTML('afterend', '<button class="btn chico" id="btn-entrega" type="button" title="Envío o retiro: medio, costo y dirección">🚚 Entrega</button>'); document.getElementById('btn-entrega').onclick = entrega; } }
  $('#btn-cobrar').onclick = () => cobrar(false);
  $('#btn-sena').onclick = () => carrito.lineas.length ? cobrar(true) : retirarSena();

  // ---- envío con cola sin internet ----
  const colaPendiente = () => JSON.parse(localStorage.getItem(LS('cola_ventas')) || '[]');
  async function enviarVenta(payload) {
    try {
      const { data, error } = await sb.rpc('caja_registrar_venta', { p: payload });
      if (error) { if (/fetch|network/i.test(error.message)) throw error; toast(mensajeError(error), 'error'); throw error; }
      empujarStock();
      return data;
    } catch (err) {
      if (/fetch|network/i.test(err.message || '') && payload.reservada) { toast('Sin internet: la venta reservada no se guardó. Probá de nuevo.', 'error'); throw err; }
      if (/fetch|network/i.test(err.message || '')) {
        const cola = colaPendiente(); cola.push(payload); localStorage.setItem(LS('cola_ventas'), JSON.stringify(cola));
        toast('Sin internet: la venta quedó guardada y se sube sola', 'error'); pintarEstado();
        return { pendiente: true };
      }
      throw err;
    }
  }
  async function sincronizar() {
    let cola = colaPendiente(); if (!cola.length) return;
    for (const p of [...cola]) {
      const { error } = await sb.rpc('caja_registrar_venta', { p });
      if (error && /fetch|network/i.test(error.message)) break;
      if (error) { toast(`Una venta guardada no se pudo subir: ${mensajeError(error)}`, 'error'); }
      cola = cola.filter(x => x.offline_id !== p.offline_id); localStorage.setItem(LS('cola_ventas'), JSON.stringify(cola));
    }
    empujarStock(); pintarEstado(); if (!colaPendiente().length) toast('Ventas pendientes subidas');
  }
  function actualizarRed() { const p = $('#punto-red'); if (p) p.className = 'punto' + (navigator.onLine ? '' : ' off'); }
  window.addEventListener('online', () => { actualizarRed(); sincronizar(); }); window.addEventListener('offline', actualizarRed);

  // ================= Ticket =================
  function mostrarTicket(p, res, extra) {
    const emp = APP.empresa, num = res.numero_mostrar ? res.numero_mostrar : res.numero ? '#' + String(res.numero).padStart(6, '0') : 'pendiente';
    // cambio o devolución: el comprobante dice qué devolvió y qué se llevó; la nota de crédito va aparte, como nota de crédito
    const esCambio = p.tipo === 'cambio', aPagar = extra.total.aPagar, ncs = (res.creditos || []).filter(c => c.tipo === 'nota_credito');
    const origenNum = carrito.cambio && carrito.cambio.numero ? '#' + String(carrito.cambio.numero).padStart(6, '0') : '';
    const fila = l => `<tr><td>${Math.abs(l.cantidad)}× ${esc(l.descripcion)}${l.falla ? ' ◆' : ''}<br><small>${esc([l.talle, l.color].filter(Boolean).join(' · '))}${l.promocion_nombre ? ' · ' + esc(l.promocion_nombre) : ''}</small></td><td class="r">${fmt.pesos(esCambio ? Math.abs(l.total) : l.total)}</td></tr>`;
    const devuelve = p.lineas.filter(l => l.cantidad < 0), lleva = p.lineas.filter(l => l.cantidad > 0);
    const lineas = esCambio ? (devuelve.length ? '<tr><td colspan="2"><b>DEVUELVE</b></td></tr>' + devuelve.map(fila).join('') : '') + (lleva.length ? '<tr><td colspan="2"><b>SE LLEVA</b></td></tr>' + lleva.map(fila).join('') : '') : p.lineas.map(fila).join('');
    const pagos = extra.pagos.filter(pg => pg.monto).map(pg => `<tr><td>${esc(pg.nombre)}${pg.cuotas > 1 ? ' (' + pg.cuotas + ' cuotas)' : ''}</td><td class="r">${fmt.pesos(Math.abs(pg.monto))}</td></tr>`).join('');
    const rotulo = !esCambio ? 'TOTAL' : aPagar > 0 ? 'DIFERENCIA A PAGAR' : aPagar < 0 ? 'A FAVOR DE LA CLIENTA' : 'SIN DIFERENCIA';
    const html = `${emp.logo_url ? `<div class="c"><img src="${esc(emp.logo_url)}" alt="" style="max-width:42mm;max-height:20mm;margin:0 auto 4px;display:block"></div>` : ''}<h2 class="c">${esc(emp.nombre)}</h2><div class="c">${esc([emp.domicilio, emp.localidad].filter(Boolean).join(' · '))}<br>${esc(emp.telefono || '')}</div><hr>
      <div>${esCambio ? '<b>CAMBIO</b> ' + num + (origenNum ? ' · del ticket ' + origenNum : '') : 'Ticket ' + num} · ${new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
      <div>Atendió: ${esc((vendedoras.find(v => v.user_id === p.vendedora_id) || {}).nombre || '')}</div><hr>
      <table>${lineas}</table><hr>
      <table>${extra.total.descuento ? `<tr><td>Descuento ${p.descuento_pct}%</td><td class="r">−${fmt.pesos(extra.total.descuento)}</td></tr>` : ''}${extra.total.recargo ? `<tr><td>Recargo</td><td class="r">${fmt.pesos(extra.total.recargo)}</td></tr>` : ''}<tr><td><b>${rotulo}</b></td><td class="r"><b>${fmt.pesos(esCambio ? Math.abs(aPagar) : aPagar)}</b></td></tr>${aPagar < 0 && pagos ? '<tr><td colspan="2"><small>Se devolvió por:</small></td></tr>' : ''}${pagos}${extra.vuelto ? `<tr><td>Vuelto</td><td class="r">${fmt.pesos(extra.vuelto)}</td></tr>` : ''}${p.estado === 'senada' ? `<tr><td><b>SEÑA · saldo</b></td><td class="r"><b>${fmt.pesos(r2(aPagar - extra.pagos.reduce((s, x) => s + x.monto, 0)))}</b></td></tr>` : ''}</table>
      ${(res.creditos || []).map(c => `<hr><div class="c">${c.tipo === 'gift_card' ? 'Gift card' : 'Nota de crédito'} <b>${c.codigo}</b> por ${fmt.pesos(c.monto)}<br><small>(comprobante aparte)</small></div>`).join('')}
      ${p.nota ? `<hr><div>${esc(p.nota)}</div>` : ''}<hr><div class="c">Cambios con este ticket dentro de los 30 días.<br>¡Gracias por tu compra!</div>`;
    // la nota de crédito: su propio comprobante (shared/nota-credito.js)
    const clienta = (clientes.find(c => c.id === p.cliente_id) || {}).nombre || null;
    const ncOpts = { empresa: emp, listas, formas, clienta, ticket: res.numero, origen: carrito.cambio && carrito.cambio.numero, devuelve, lleva };
    const ncDe = c => ({ codigo: c.codigo, tipo: c.tipo, monto: c.monto, saldo: c.monto, creado: new Date().toISOString(), lista_id: (p.creditos_a_emitir.find(x => x.tipo === c.tipo) || {}).lista_id || null, estado: 'vigente' });
    const imprimirTicket = () => { $('#impresion').innerHTML = html; window.print(); };
    $('#impresion').innerHTML = html;
    const nc = window.NOTA_CREDITO && ncs[0];
    const gifts = window.NOTA_CREDITO ? (res.creditos || []).filter(c => c.tipo === 'gift_card').map(c => ({ id: c.id, codigo: c.codigo, tipo: 'gift_card', monto: +c.monto, saldo: +c.monto, creado: new Date().toISOString(), lista_id: c.lista_id || listaBase(), dedicatoria: c.dedicatoria || null, estado: 'vigente' })) : [];
    const giftOpts = { empresa: emp, listas, formas, web: conWeb() };
    // seña: su comprobante (número para retirar, prendas, lo que pagó y lo que falta según el medio), como la nota de crédito
    const sena = p.estado === 'senada' && !res.pendiente && window.SENA ? { numero: res.numero, fecha: new Date().toISOString(), total: aPagar, pagado: r2(extra.pagos.reduce((s, x) => s + x.monto, 0)), lista_id: p.lista_id, lineas: p.lineas, estado: 'senada' } : null;
    if (sena) sena.saldo = r2(sena.total - sena.pagado);
    const senaOpts = { empresa: emp, listas, formas, clienta: (clientes.find(c => c.id === p.cliente_id) || {}).nombre || null };
    // ticket de cambio para regalo (sin precios): se resalta si la nota dice "regalo"
    const regalable = !nc && p.estado !== 'senada' && !res.pendiente && window.TICKET_CAMBIO && TICKET_CAMBIO.prendas(p.lineas).length > 0, regalo = /regalo/i.test(p.nota || '');
    const texto = encodeURIComponent(nc ? NOTA_CREDITO.texto(ncDe(nc), ncOpts) : `${emp.nombre} · ${esCambio ? 'Cambio' : 'Ticket'} ${num}\n` + p.lineas.map(l => `${l.cantidad}× ${l.descripcion} ${[l.talle, l.color].filter(Boolean).join(' ')} ${fmt.pesos(l.total)}`).join('\n') + `\n${rotulo} ${fmt.pesos(esCambio ? Math.abs(aPagar) : aPagar)}` + (p.estado === 'senada' ? `\nSeña: saldo ${fmt.pesos(r2(aPagar - extra.pagos.reduce((s, x) => s + x.monto, 0)))}` : '') + `\n¡Gracias por tu compra!`);
    const titulo = res.pendiente ? (esCambio ? 'Cambio guardado' : 'Venta guardada') + ' (se sube al volver internet)' : sena ? '✓ Seña ' + num + ' registrada' : nc ? '✓ Nota de crédito emitida' : esCambio ? (aPagar < 0 ? '✓ Devolución ' + num + ' registrada' : '✓ Cambio ' + num + ' registrado') : '✓ Venta ' + num + ' registrada';
    const cuerpo = sena ? `<p class="sub">Las prendas quedan reservadas. Mandale el comprobante: con ese número la retira y paga lo que falta.</p><div class="nc-vista">${SENA.html(sena, senaOpts)}</div>`
      : nc ? `<p class="sub">Cambio ${esc(num)}${origenNum ? ' del ticket ' + origenNum : ''}. Así se imprime:</p><div class="nc-vista">${NOTA_CREDITO.html(ncDe(nc), ncOpts)}</div>`
      : esCambio ? `<div style="font:800 30px var(--f-titulo);letter-spacing:-.03em;margin:6px 0">${aPagar > 0 ? 'Cobrado ' + fmt.pesos(aPagar) : aPagar < 0 ? 'Devuelto ' + fmt.pesos(-aPagar) : 'Sin diferencia'}</div>${aPagar < 0 ? `<p class="sub">Por ${esc(extra.pagos.filter(x => x.monto).map(x => x.nombre).join(' y '))}</p>` : ''}`
      : `<div style="font:800 30px var(--f-titulo);letter-spacing:-.03em;margin:6px 0"><span data-monto-venta>${fmt.pesos(aPagar)}</span> ${res.pendiente ? '' : '🎉'}</div>`;
    const giftsHtml = gifts.map((g, i) => `<div style="margin-top:12px"><div class="nc-vista">${NOTA_CREDITO.html(g, giftOpts)}</div><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;align-items:center"><button class="btn primario" data-gc-print="${i}">Imprimir gift card</button><button class="btn" data-gc-wsp="${i}">📷 WhatsApp (foto)</button>${conWeb() ? `<span class="sub" data-gc-web="${i}">🌐 Creando el cupón en la web…</span>` : ''}</div></div>`).join('');
    const m = modal(`<h2>${titulo}</h2>${cuerpo}${giftsHtml}
      ${extra.vuelto ? `<div class="aviso-caja info">Vuelto: <b>${fmt.pesos(extra.vuelto)}</b></div>` : ''}
      ${(res.creditos || []).filter(c => c !== nc && !(gifts.length && c.tipo === 'gift_card')).map(c => `<div class="aviso-caja ok">${c.tipo === 'gift_card' ? 'Gift card' : 'Nota de crédito'} emitida · código <b class="mono">${c.codigo}</b> · ${fmt.pesos(c.monto)}</div>`).join('')}
      <div class="pie" style="justify-content:space-between"><div style="display:flex;gap:8px;flex-wrap:wrap">${res.id && p.estado === 'completada' && aPagar > 0 && !p.reservada && !res.reservada && window.FACTURA ? '<button class="btn" data-facturar hidden>Facturar</button>' : ''}${sena ? '<button class="btn primario" data-print-sena>Imprimir comprobante de seña</button>' : nc ? '<button class="btn primario" data-print-nc>Imprimir nota de crédito</button><button class="btn" data-print>Imprimir el cambio</button>' : `<button class="btn" data-print>Imprimir ${esCambio ? 'comprobante' : 'ticket'}</button>`}${regalable ? `<button class="btn${regalo ? ' primario' : ''}" data-regalo title="Para regalo: el número de ticket y las prendas, sin precios">🎁 Ticket de cambio</button>` : ''}${sena ? '<button class="btn" data-wsp-sena>📷 WhatsApp (foto)</button>' : nc ? '<button class="btn" data-wsp-nc>📷 WhatsApp (foto)</button>' : `<a class="btn" href="whatsapp://send?text=${texto}">WhatsApp</a>`}${res.id && !res.pendiente ? '<button class="btn" data-prueba title="Borra esta venta como si no hubiera existido">🧪 Era de prueba</button>' : ''}</div><button class="btn${nc || sena ? '' : ' primario'}" data-ok>Nueva venta</button></div>`, { fijo: true });
    if (gifts.length) {
      const md = $('.modal', m); if (md) md.style.maxWidth = '560px';
      const tel = (clientes.find(c => c.id === p.cliente_id) || {}).telefono;
      $$('[data-gc-print]', m).forEach(b => b.onclick = () => { $('#impresion').innerHTML = NOTA_CREDITO.html(gifts[+b.dataset.gcPrint], giftOpts); window.print(); });
      $$('[data-gc-wsp]', m).forEach(b => b.onclick = async () => { const r = await NOTA_CREDITO.compartir(gifts[+b.dataset.gcWsp], giftOpts, tel); if (NOTA_CREDITO.AVISO[r]) toast(NOTA_CREDITO.AVISO[r]); });
      // el cupón de descuento en la web, con el mismo código y el mismo valor
      const crearCupon = i => { const s = $(`[data-gc-web="${i}"]`, m); if (!s) return; s.textContent = '🌐 Creando el cupón en la web…';
        NOTA_CREDITO.cupon(e, gifts[i].id, 'crear').then(r => { s.innerHTML = r.sin_web ? '' : `<span style="color:var(--ok)">🌐 Cupón ${esc(gifts[i].codigo)} creado en la web ✓</span>`; })
          .catch(err => { s.innerHTML = `<span style="color:var(--error)">⚠ ${esc(err.message)}</span> <button class="btn chico" type="button">Reintentar</button>`; $('button', s).onclick = () => crearCupon(i); }); };
      gifts.forEach((g, i) => crearCupon(i));
    }
    if (sena) { const md = $('.modal', m); if (md) md.style.maxWidth = '560px';
      $('[data-print-sena]', m).onclick = () => { $('#impresion').innerHTML = SENA.html(sena, senaOpts); window.print(); };
      $('[data-wsp-sena]', m).onclick = async () => { const r = await SENA.compartir(sena, senaOpts, (clientes.find(c => c.id === p.cliente_id) || {}).telefono); if (SENA.AVISO[r]) toast(SENA.AVISO[r]); }; }
    if (nc) { const md = $('.modal', m); if (md) md.style.maxWidth = '560px'; $('[data-print-nc]', m).onclick = () => { $('#impresion').innerHTML = NOTA_CREDITO.html(ncDe(nc), ncOpts); window.print(); };
      $('[data-wsp-nc]', m).onclick = async () => { const r = await NOTA_CREDITO.compartir(ncDe(nc), ncOpts, (clientes.find(c => c.id === p.cliente_id) || {}).telefono); if (NOTA_CREDITO.AVISO[r]) toast(NOTA_CREDITO.AVISO[r]); }; }
    { const br = $('[data-regalo]', m); if (br) br.onclick = () => TICKET_CAMBIO.elegir({ empresa: emp, numero: num, fecha: new Date().toISOString(), lineas: p.lineas }); }
    if (!res.pendiente && !esCambio) { fx.sonido('venta'); fx.pop($('[data-monto-venta]', m)); if (fx.brillo) fx.brillo($('.modal', m) || m); }
    { const bp = $('[data-print]', m); if (bp) bp.onclick = imprimirTicket; }   // la seña no tiene ticket: tiene su comprobante
    const bf = $('[data-facturar]', m);
    if (bf) FACTURA.config(e).then(c => { if (c.estado !== 'listo') return; bf.hidden = false; bf.onclick = () => FACTURA.abrir({ id: res.id, numero: res.numero, total: extra.total.aPagar, cliente_id: p.cliente_id || null, cliente_nombre: null }, { alTerminar: c2 => { if (c2 && c2.estado === 'autorizado') { bf.textContent = '✓ ' + c2.nombre_tipo + ' ' + c2.numero_mostrar; bf.onclick = () => window.open(FACTURA.urlFactura(c2.id), '_blank'); } } }); });
    $('[data-ok]', m).onclick = () => { m.cerrar(); $('#q').focus(); };
    // venta de prueba: se borra entera (vuelve el stock, sale de la caja), sin dejar registro
    const pr = $('[data-prueba]', m); if (pr) pr.onclick = async () => {
      if (!await confirmar('Se borra esta venta como si nunca hubiera existido: el stock vuelve (también en la web) y sale de la caja. ¿Seguimos?', 'Borrar venta de prueba')) return;
      const { error } = await sb.rpc('venta_borrar_prueba', { p_venta: res.id });
      if (error) { toast(mensajeError(error), 'error'); return; }
      m.cerrar(); toast('Venta de prueba borrada ✓ · stock devuelto'); if (window.empujarStock) empujarStock(e); $('#q').focus();
    };
  }

  // ================= Gift card =================
  // Se vende a precio de lista (como en la web): una de $25.000 sale $20.000 pagando de contado y vale $25.000.
  // El código lo elige quien vende (o la clienta). Con la web conectada, al cobrar se crea el cupón de descuento con ese código.
  const listaBase = () => (listas.find(x => x.predeterminada) || listas[0] || {}).id;
  const conWeb = () => (pctx.listas || []).some(l => l.canal === 'tiendanube');
  const normCod = c => String(c || '').trim().toUpperCase().replace(/\s+/g, '');
  function venderGift(v, l0) {
    const g = (l0 && l0.gift) || {};
    const m = modal(`<h2>🎁 Gift card</h2><p class="sub">Vale lo que dice, a <b>precio de lista</b>${conWeb() ? ' (como en la web: con el mismo código se crea el cupón de descuento)' : ''}.</p>
      <div class="campo" style="margin-top:10px"><label>Valor</label><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${[20000, 25000, 30000, 40000, 50000, 100000].map(x => `<button type="button" class="btn chico" data-val="${x}">${fmt.pesos(x)}</button>`).join('')}</div>
        <input id="gc-val" type="number" min="0" step="1000" value="${g.valor || ''}" placeholder="Otro valor" style="font:700 20px var(--f-mono);max-width:200px"></div>
      <div id="gc-paga" class="sub" style="margin:-4px 0 10px"></div>
      <div class="campo"><label>Código <small class="sub">(lo elige la clienta o vos)</small></label><div style="display:flex;gap:6px"><input id="gc-cod" value="${esc(g.codigo || '')}" placeholder="Ej. #FELIZCUMPLE" autocomplete="off" style="text-transform:uppercase;font-family:var(--f-mono);flex:1"><button type="button" class="btn" data-inventar>Inventar uno</button></div><div id="gc-cod-msg" class="sub" style="margin-top:4px">Ideal: de 6 a 12 letras o números, ej. <b>#FELIZCUMPLE</b>.</div></div>
      <div class="fila c2"><div class="campo"><label>Para</label><input id="gc-para" value="${esc(g.para || '')}" placeholder="Opcional"></div><div class="campo"><label>De</label><input id="gc-de" value="${esc(g.de || '')}" placeholder="Opcional"></div></div>
      <div class="campo"><label>Mensaje</label><input id="gc-msg" value="${esc(g.mensaje || '')}" placeholder="Opcional (ej. ¡Feliz cumple!)" maxlength="120"></div>
      <div class="pie"><button class="btn" data-no>Cancelar</button><button class="btn primario" data-si>${l0 ? 'Guardar' : 'Agregar al ticket'}</button></div>`);
    const val = $('#gc-val', m), cod = $('#gc-cod', m), msg = $('#gc-cod-msg', m); let libre = false, tq = null;
    // cuánto paga según el medio (la gift card vale lo mismo: el valor de lista)
    const pintarPaga = () => {
      const x = +val.value || 0, caja_ = $('#gc-paga', m); if (!x) { caja_.textContent = ''; return; }
      const ids = [...new Set(formas.map(f => (listaDeForma(f) || {}).id || carrito.lista))], vv = Object.assign({}, v, { precio: x });
      caja_.innerHTML = 'Paga: ' + listas.filter(L => ids.includes(L.id)).map(L => [L.nombre, precioLista(vv, L.id)]).sort((a, b) => a[1] - b[1]).map(([n, p]) => `${esc(n)} <b>${fmt.pesos(p)}</b>`).join(' · ');
    };
    const revisar = async () => {
      const c = normCod(cod.value); libre = false;
      if (!c) { msg.innerHTML = 'Ideal: de 6 a 12 letras o números, ej. <b>#FELIZCUMPLE</b>.'; return; }
      if (!/^[A-Z0-9#/_.\-ÑÁÉÍÓÚ]{3,30}$/.test(c)) { msg.innerHTML = '<span style="color:var(--error)">De 3 a 30 letras o números (puede llevar # - / . _)</span>'; return; }
      if (carrito.lineas.some(l => l.gift && l !== l0 && l.gift.codigo === c)) { msg.innerHTML = '<span style="color:var(--error)">Ya está en este ticket</span>'; return; }
      const { data, error } = await sb.rpc('credito_codigo_libre', { e, p_codigo: c });
      if (error) { msg.textContent = ''; libre = true; return; }   // sin internet: lo revisa la base al cobrar
      libre = !!data; msg.innerHTML = data ? '<span style="color:var(--ok)">✓ Libre</span>' + (c.length > 12 ? ' · <span style="color:var(--aviso)">es largo: se va a ver más chico (ideal hasta 12)</span>' : c.length < 6 ? ' · <span style="color:var(--aviso)">es corto: mejor de 6 a 12</span>' : ' · ' + c.length + ' caracteres') : '<span style="color:var(--error)">Ese código ya existe: elegí otro</span>';
    };
    $$('[data-val]', m).forEach(b => b.onclick = () => { val.value = b.dataset.val; pintarPaga(); cod.focus(); });
    val.oninput = pintarPaga; cod.oninput = () => { clearTimeout(tq); tq = setTimeout(revisar, 300); };
    $('[data-inventar]', m).onclick = () => { cod.value = '#' + Math.random().toString(36).slice(2, 8).toUpperCase(); revisar(); };
    $('[data-no]', m).onclick = () => m.cerrar();
    $('[data-si]', m).onclick = async () => {
      const x = Math.round(+val.value || 0); if (x <= 0) { toast('Poné el valor de la gift card', 'error'); return; }
      await revisar(); const c = normCod(cod.value);
      if (!c) { toast('Poné el código (o tocá Inventar uno)', 'error'); return; }
      if (!libre) { toast('Revisá el código', 'error'); return; }
      const gift = { valor: x, codigo: c, para: $('#gc-para', m).value.trim(), de: $('#gc-de', m).value.trim(), mensaje: $('#gc-msg', m).value.trim() };
      const vv = Object.assign({}, v, { precio: x });
      if (l0) Object.assign(l0, { variante: vv, gift }); else carrito.lineas.push({ variante: vv, cantidad: 1, descPct: 0, gift });
      m.cerrar(); pintar(); $('#q').focus();
    };
    pintarPaga(); if (g.valor) cod.focus(); else val.focus();
  }

  // ================= Retirar una seña =================
  // Con el ticket vacío, el botón de la seña la retira: se busca por número (el del comprobante), clienta o teléfono y se cobra
  // lo que falta. Como en los cambios, lo que falta vale lo mismo en otra lista: una seña de Contado con $12.000 de saldo son
  // $15.000 pagando con tarjeta (la diferencia queda como recargo de la venta).
  const datosSena = s => ({ numero: s.numero, fecha: s.fecha, total: +s.total, pagado: +s.pagado, saldo: +s.saldo, lista_id: s.lista_id, lineas: s.lineas || [], estado: s.estado || 'senada' });
  const saldoEn = (s, f) => { const ls = listasDe(f), dest = !ls || ls.includes(s.lista_id) ? s.lista_id : ls[0]; return { lista: dest, monto: dest === s.lista_id || !s.lista_id ? +s.saldo : Math.round(+s.saldo * pctLista(dest) / pctLista(s.lista_id)) }; };
  async function retirarSena(q0) {
    if (!turno) { toast('Primero abrí la caja', 'error'); abrirTurno(); return; }
    const m = modal(`<h2>🎟️ Retirar una seña</h2><p class="sub">Buscá por el número del comprobante, el nombre o el teléfono de la clienta.</p>
      <input id="rs-q" class="pick-busca" placeholder="Ej. 75, María, 358…" autocomplete="off" value="${esc(q0 || '')}">
      <div id="rs-lista" style="margin-top:10px;max-height:52vh;overflow:auto"></div><div id="rs-det"></div>`, { fijo: true });
    { const md = $('.modal', m); if (md) md.style.maxWidth = '660px'; }
    const qIn = $('#rs-q', m), lista = $('#rs-lista', m), det = $('#rs-det', m); let filas = [], tq = null;
    const pintarLista = () => { lista.innerHTML = filas.map((x, i) => `<button type="button" class="cv-fila" data-i="${i}"><span class="cv-num">#${String(x.numero).padStart(6, '0')}</span><span class="cv-info"><b>${esc(x.cliente || 'Sin clienta')}</b><small>${esc((x.lineas || []).map(l => (+l.cantidad) + '× ' + l.descripcion).join(' | '))}</small></span><span class="cv-der"><b>Falta ${fmt.pesos(x.saldo)}</b><small>${fmt.fechaHora(x.fecha)}</small></span></button>`).join('') || '<div class="vacio">No hay señas pendientes con eso.</div>';
      $$('[data-i]', lista).forEach(b => b.onclick = () => abrir(filas[+b.dataset.i])); };
    const buscar = async () => { const { data, error } = await sb.rpc('senas_buscar', { e, q: qIn.value.trim() }); if (error) { lista.innerHTML = `<div class="vacio">${esc(mensajeError(error))}</div>`; return; } filas = data || []; pintarLista(); if (filas.length === 1 && qIn.value.trim()) abrir(filas[0]); };
    qIn.addEventListener('input', () => { clearTimeout(tq); tq = setTimeout(buscar, 220); });
    function abrir(s0) {
      lista.hidden = true; qIn.hidden = true;
      // precios congelados 15 días: después, lo que falta sale del precio de hoy de cada prenda (a la lista de la seña)
      const hasta = window.SENA ? SENA.hasta(s0, { empresa: APP.empresa }) : null, vencida = hasta && Date.now() > hasta;
      const totalHoy = vencida ? r2((s0.lineas || []).reduce((t, l) => { const v = l.variante_id && catalogo.find(x => x.id === l.variante_id); return t + (v ? precioLista(v, s0.lista_id) * +l.cantidad : +l.total); }, 0)) : +s0.total;
      const s = vencida && totalHoy !== +s0.total ? Object.assign({}, s0, { total: totalHoy, saldo: Math.max(0, r2(totalHoy - s0.pagado)) }) : s0;
      const ver = [...new Map(formas.map(f => { const x = saldoEn(s, f); return [x.lista, x]; })).values()].sort((a, b) => a.monto - b.monto);
      det.innerHTML = `<div class="nc-vista" style="width:auto;margin:6px 0 10px">${window.SENA ? SENA.html(datosSena(s0), { empresa: APP.empresa, listas, formas, clienta: s0.cliente }) : ''}</div>
        ${s !== s0 ? `<div class="aviso-caja error" style="margin-bottom:8px">⏰ <b>Pasaron más de ${SENA.dias({ empresa: APP.empresa })} días</b> (los precios estaban congelados hasta el ${hasta.toLocaleDateString('es-AR')}): se cobra al precio de hoy. Total ${fmt.pesos(s0.total)} → <b>${fmt.pesos(s.total)}</b>.</div>` : ''}
        ${ver.length > 1 ? `<div class="aviso-caja info"><b>Lo que falta, según con qué pague:</b> ${ver.map(x => `precio ${esc(nombreLista(x.lista))} <b>${fmt.pesos(x.monto)}</b>`).join(' · ')}</div>` : ''}
        <p class="sub" style="margin:10px 0 6px">Tocá con qué paga lo que falta:</p>
        ${window.MEDIOS ? MEDIOS.botonera(formas, usosFormas, listaDeForma) : `<div class="formas">${formas.map(f => `<button data-f="${f.id}">${esc(f.nombre)}</button>`).join('')}</div>`}
        <div class="resto" id="rs-resto"></div>
        <div class="pie"><button class="btn" data-volver style="margin-right:auto">← Otra seña</button><button class="btn" data-no>Cancelar</button><button class="btn primario" data-si disabled>Cobrar y entregar</button></div>`;
      $$('[data-cred]', det).forEach(b => b.remove());
      let elegido = null;
      $$('[data-f]', det).forEach(b => b.onclick = () => {
        const f = formas.find(x => x.id === b.dataset.f); elegido = { f, ...saldoEn(s, f) };
        $$('[data-f]', det).forEach(x => x.classList.toggle('on', x === b));
        const r = $('#rs-resto', det); r.className = 'resto ok'; r.innerHTML = `<span>${esc(f.nombre)}</span><span>${fmt.pesos(elegido.monto)}</span>`;
        $('[data-si]', det).disabled = false; $('[data-si]', det).textContent = 'Cobrar ' + fmt.pesos(elegido.monto) + ' y entregar';
      });
      $('[data-volver]', det).onclick = () => { det.innerHTML = ''; lista.hidden = false; qIn.hidden = false; qIn.focus(); };
      $('[data-no]', det).onclick = () => m.cerrar();
      $('[data-si]', det).onclick = async () => {
        if (!elegido) return; const b = $('[data-si]', det); b.disabled = true; b.textContent = 'Registrando…';
        const { data, error } = await sb.rpc('caja_completar_sena', { p: { empresa_id: e, venta_id: s.id, turno_id: turno.id, recargo: r2(elegido.monto - s0.saldo),
          pagos: [{ forma_pago_id: elegido.f.id, monto: elegido.monto, cuotas: elegido.f.cuotas || 1, recargo_pct: 0 }] } });
        if (error) { b.disabled = false; b.textContent = 'Cobrar y entregar'; toast(mensajeError(error), 'error'); return; }
        m.cerrar(); fx.sonido('venta'); toast(`✓ Seña #${String(s.numero).padStart(6, '0')} retirada`);
        const fin = modal(`<h2>✓ Seña #${String(s.numero).padStart(6, '0')} retirada</h2><div style="font:800 30px var(--f-titulo);letter-spacing:-.03em;margin:6px 0">Cobrado ${fmt.pesos(elegido.monto)}</div>
          <p class="sub">${esc(s.cliente || 'La clienta')} ya pagó todo: entregale las prendas.</p>
          <div class="aviso-caja info" style="margin-top:8px">${(s.lineas || []).filter(l => +l.cantidad > 0).map(l => `${+l.cantidad}× <b>${esc(l.descripcion)}</b> ${esc([l.talle, l.color].filter(Boolean).join(' · '))}`).join('<br>')}</div>
          <div class="pie"><button class="btn primario" data-ok>Listo</button></div>`);
        $('[data-ok]', fin).onclick = () => { fin.cerrar(); $('#q').focus(); };
      };
    }
    buscar(); qIn.focus();
  }

  // ================= Cambio / devolución =================
  $('#btn-cambio').onclick = () => {
    const m = modal(`<h2>Cambio o devolución</h2><p class="sub">Buscá la venta por número (o parte), clienta, fecha (27/10, oct), prenda, talle, color o total. <a href="../ayuda/instructivo.html#cambios-pasos" target="_blank">¿Cómo se hace un cambio?</a></p>
      <input class="cv-busca" id="cv-q" placeholder="Ej. 123 · maría · 27/10 · conjunto negro 95" autocomplete="off">
      <div id="cv-lista" class="cv-lista"></div><div id="cv-res"></div>
      <div class="sin-ticket"><span><b>¿No tiene ticket?</b>Se carga lo que trae tocándolo o escaneándolo, al precio de hoy.</span><button class="btn" data-sin-ticket>Devolver sin ticket</button></div>`);
    $('.modal', m).style.maxWidth = '720px';
    $('[data-sin-ticket]', m).onclick = () => { carrito.cambio = carrito.cambio || { id: null, numero: null }; carrito.devolviendo = true; m.cerrar(); pintar(); $('#q').focus(); };
    const qIn = $('#cv-q', m), lista = $('#cv-lista', m), det = $('#cv-res', m);
    let filas = [], marcada = 0, pedido = 0, tq;
    const pintarLista = () => {
      lista.innerHTML = filas.map((x, i) => `<button type="button" class="cv-fila${i === marcada ? ' on' : ''}" data-i="${i}"><span class="cv-num">${esc(x.mostrar)}</span><span class="cv-info"><b>${esc(x.cliente || 'Sin clienta')}${x.tipo === 'cambio' ? ' <span class="chip gris">cambio</span>' : ''}</b><small>${esc(x.resumen || '')}</small></span><span class="cv-der"><b>${fmt.pesos(x.total)}</b><small>${fmt.fechaHora(x.fecha)}</small></span></button>`).join('')
        || `<div class="vacio">${qIn.value.trim() ? 'No encontré ventas con eso.' : 'Sin ventas.'}</div>`;
      $$('.cv-fila', lista).forEach(b => b.onclick = () => abrir(filas[+b.dataset.i].mostrar));
      const on = $('.cv-fila.on', lista); if (on) on.scrollIntoView({ block: 'nearest' });
    };
    const buscar = async () => {
      const q = qIn.value.trim(), yo = ++pedido;
      if (/^r\s*-?\s*\d+$/i.test(q)) { lista.innerHTML = '<div class="vacio">Enter para abrir la venta reservada.</div>'; filas = []; return; }   // las reservadas: solo por número exacto
      const { data, error } = await sb.rpc('ventas_buscar_cambio', { e, q });
      if (yo !== pedido) return;   // llegó tarde: ya se escribió otra cosa
      if (error) { filas = []; lista.innerHTML = '<div class="vacio">Escribí el número de ticket y Enter.</div>'; return; }   // sin el buscador nuevo: como antes
      filas = data || []; marcada = 0; pintarLista();
    };
    // la venta elegida: se marca lo que devuelve
    const abrir = async n => {
      const { data: v } = await sb.rpc('venta_para_cambio', { e, p_numero: n });
      if (!v) { det.innerHTML = '<div class="vacio">No existe ese ticket.</div>'; return; }
      if (v.estado === 'anulada') { det.innerHTML = '<div class="vacio">Esa venta está anulada.</div>'; return; }
      const ls = v.lineas || [];
      lista.hidden = true; qIn.hidden = true;
      det.innerHTML = `<p class="sub" style="margin:8px 0">Venta <b>${esc(v.mostrar)}</b> · ${fmt.fechaHora(v.fecha)} · ${fmt.pesos(v.total)}. Marcá lo que devuelve:</p>
        <table class="lista">${ls.map(l => `<tr><td><input type="checkbox" data-l="${l.id}"></td><td>${esc(l.descripcion)}<br><small>${esc([l.talle, l.color].filter(Boolean).join(' · '))}</small></td><td class="num">${l.cantidad}× ${fmt.pesos(l.precio_unit)}</td></tr>`).join('')}</table>
        <div class="pie"><button class="btn" data-volver style="margin-right:auto">← Volver a buscar</button><button class="btn" data-no>Cancelar</button><button class="btn primario" data-si>Cargar al ticket <kbd>Enter</kbd></button></div>`;
      $('[data-volver]', m).onclick = () => { det.innerHTML = ''; lista.hidden = false; qIn.hidden = false; qIn.focus(); };
      $('[data-no]', m).onclick = () => m.cerrar();
      $('[data-si]', m).onclick = () => {
        const sel = $$('input[data-l]:checked', m).map(i => ls.find(l => String(l.id) === i.dataset.l));
        if (!sel.length) { toast('Marcá al menos una prenda', 'error'); return; }
        const lo = listaPagada(v);   // la lista con que pagó: lo que devuelve se valora ahí
        carrito.cambio = { id: v.id, numero: v.numero, pagos: v.pagos || [] }; carrito.lista = lo;
        sel.forEach(l => { const v2 = catalogo.find(x => x.id === l.variante_id) || { id: l.variante_id, producto_id: l.producto_id, producto_nombre: l.descripcion, talle_nombre: l.talle, color_nombre: l.color, precio: l.precio_lista, costo: l.costo_unit };
          carrito.lineas.push({ variante: v2, cantidad: -l.cantidad, descPct: 0, devuelta: true, precioFijo: l.precio_unit, listaOrigen: lo }); });
        m.cerrar(); pintar(); toast('Agregá ahora lo que se lleva, o cobrá para devolver el dinero / emitir nota de crédito'); $('#q').focus();
      };
      // una sola prenda: ya queda marcada · Espacio marca o desmarca · Enter carga
      const cks = $$('input[data-l]', m); if (cks.length === 1) cks[0].checked = true; if (cks[0]) cks[0].focus();
      det.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); $('[data-si]', m).click(); } };
    };
    qIn.addEventListener('input', () => { clearTimeout(tq); tq = setTimeout(buscar, 220); });
    qIn.addEventListener('keydown', ev => {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); if (!filas.length) return; marcada = Math.max(0, Math.min(filas.length - 1, marcada + (ev.key === 'ArrowDown' ? 1 : -1))); pintarLista(); }
      else if (ev.key === 'Enter') { ev.preventDefault(); const q = qIn.value.trim(); if (filas[marcada]) abrir(filas[marcada].mostrar); else if (/^(r\s*-?\s*|#)?\d+$/i.test(q)) abrir(q); }
    });
    buscar();   // al abrir: las últimas ventas
  };
  // las líneas devueltas se valoran a lo que se pagó (no al precio de hoy), en la lista con que se pagó: si el ticket está en otra
  // lista, lo equivalente (valorDevuelta). Mismo modelo y mismo color en otro talle: se cambia sin diferencia, aunque el precio haya subido.
  // Otro color ya es otra prenda: paga la diferencia como cualquier cambio.
  const calcularBase = calcular;
  calcular = function () { carrito.lineas.forEach(l => { if (l.gift && l.cantidad > 1) l.cantidad = 1; }); const c = calcularBase();
    c.lineas.forEach(l => { l.conv = null; if (l.devuelta && l.precioFijo != null) { const val = valorDevuelta(l, carrito.lista); l.conv = val !== l.precioFijo && !l.parte ? { pago: l.precioFijo, de: l.listaOrigen } : null; l.precioLista = val; l.precioUnit = val; l.promo = null; l.descPromo = 0; l.precioFinal = val; l.total = r2(val * l.cantidad); } });
    const pool = new Map(), clave = v => v.producto_id + '|' + String(v.color_nombre || '').trim().toLowerCase();
    c.lineas.forEach(l => { if (l.devuelta && !l.parte && l.precioFijo != null) { const k = clave(l.variante); if (!pool.has(k)) pool.set(k, []); pool.get(k).push({ val: l.precioFinal, n: -l.cantidad }); } });
    c.lineas.forEach(l => {
      l.mismoModelo = 0; if (l.devuelta || l.parte || l.canje || l.falla || l.precioManual != null || l.cantidad <= 0) return;
      const p = pool.get(clave(l.variante)); if (!p) return;
      let n = 0, suma = 0; for (const u of p) while (u.n > 0 && n < l.cantidad) { u.n--; n++; suma += u.val; }
      if (!n) return;
      if (n === l.cantidad) { l.promo = null; l.descPromo = 0; }
      l.mismoModelo = n; l.total = r2(suma + (l.cantidad - n) * l.precioFinal); l.precioFinal = r2(l.total / l.cantidad);
    });
    let subtotal = 0, costo = 0; c.lineas.forEach(l => { subtotal += l.total; costo += (+l.variante.costo || 0) * l.cantidad; });
    c.subtotal = r2(subtotal); c.descuento = r2(subtotal * (carrito.descPct || 0) / 100); c.total = r2(c.subtotal - c.descuento); c.costo = r2(costo); return c; };

  // ================= Número de ticket desde que empieza la venta =================
  // Se reserva al abrir el punto de venta y se ve arriba del ticket (para etiquetar el paquete, por ejemplo un cambio).
  // Si se vacía el ticket, el número sigue para la próxima venta; el equipo lo recuerda aunque se recargue la página.
  let numeroRes = null;
  async function reservarNumero(nuevo) {
    let actual = null;
    try { if (nuevo) localStorage.removeItem(LS('numero')); else actual = +localStorage.getItem(LS('numero')) || null; } catch (_) { }
    try { const { data, error } = await sb.rpc('venta_numero_reservar', { e, p_actual: actual }); if (error) throw error; numeroRes = data || null; if (numeroRes) localStorage.setItem(LS('numero'), numeroRes); }
    catch (_) { numeroRes = null; }   // sin internet: se numera al cobrar
    pintarNumero();
  }
  function pintarNumero() {
    const t = document.getElementById('ticket-titulo'); if (!t) return;
    t.innerHTML = reservado ? 'Ticket <span class="nro-ticket">reservado</span>' : numeroRes ? `Ticket <span class="nro-ticket" title="Número de esta venta: ya se puede anotar en la etiqueta">#${String(numeroRes).padStart(6, '0')}</span>` : 'Ticket';
  }

  // ================= Arranque =================
  // lo que el POS (pos.js) necesita de la caja: catálogo en memoria, carrito y acciones
  APP.caja = { get catalogo() { return catalogo; }, get productos() { return productos; }, get carrito() { return carrito; }, get turno() { return turno; }, get listas() { return listas; },
    agregar, elegirProducto, pintar, precioLista, precioProducto, retirarSena, cambiarPrecio, cobrar, calcular: () => calcular(), buscar, abrirTurno, cerrarTurno, movimientoCaja, pintarEstado, colaPendiente, sincronizar, buscadorPick, pintarAvisosStock, revisarStock };
  // Recordatorio: prendas vendidas sin stock en el sistema (o sin marcar la falla) que hay que corregir
  // Pendientes (prendas sin definir, stock para revisar): la píldora va en el ticket porque el POS no tiene barra superior
  function pintarAvisosStock() {
    if (!document.getElementById('aviso-stock')) { const sub = document.getElementById('ticket-sub'); if (!sub) return; sub.insertAdjacentHTML('afterend', '<button id="aviso-stock" class="pildora-pend" data-pendientes hidden>📌 <b></b> pendientes</button>'); }
    if (APP.pendientes) APP.pendientes.refrescar();
  }
  reservarNumero(); await cargarBase(); await cargarTurno(); pintar(); pintarRecientes(); sincronizar(); pintarAvisosStock();
  if (APP.caja.alCargar) APP.caja.alCargar();
  const params = new URLSearchParams(location.search); if (params.get('cambio')) { $('#btn-cambio').click(); }
  if (params.get('sena')) setTimeout(() => retirarSena(params.get('sena')), 600);
});
