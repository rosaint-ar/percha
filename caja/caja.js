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
    pintarEstado();
    if (!turno) abrirTurno();
  }
  function pintarEstado() {
    const cola = colaPendiente().length;
    $('#estado-caja').innerHTML = turno
      ? `<span class="punto" id="punto-red"></span><span class="chip ok">Caja abierta</span><span style="font-size:12.5px;color:var(--tinta-3)">${esc(caja.nombre)} · desde ${fmt.fechaHora(turno.abierto)}</span>
         <button class="btn chico" id="btn-mov">Ingreso / retiro</button><button class="btn chico" id="btn-cerrar">Cerrar caja</button><a class="btn chico" href="ventas.html">Ventas del día</a>
         ${cola ? `<button class="btn chico suave" id="btn-sync">${cola} venta${cola > 1 ? 's' : ''} por subir</button>` : ''}`
      : `<span class="punto off"></span><span class="chip aviso">Caja cerrada</span><button class="btn chico primario" id="btn-abrir">Abrir caja</button><a class="btn chico" href="ventas.html">Ventas</a>`;
    const b = $('#btn-abrir'); if (b) b.onclick = abrirTurno;
    const m = $('#btn-mov'); if (m) m.onclick = movimientoCaja;
    const c = $('#btn-cerrar'); if (c) c.onclick = cerrarTurno;
    const s = $('#btn-sync'); if (s) s.onclick = sincronizar;
    actualizarRed();
  }
  function abrirTurno() {
    const m = modal(`<h2>Abrir caja</h2><p class="sub">Contá el efectivo con el que arrancás.</p>
      <div class="campo" style="margin-top:12px"><label>Efectivo inicial</label><input id="t-ini" type="number" min="0" step="100" value="0"></div>
      <div class="pie"><button class="btn" data-no>Después</button><button class="btn primario" data-si>Abrir</button></div>`, { fijo: true });
    $('[data-no]', m).onclick = () => m.cerrar();
    $('[data-si]', m).onclick = async () => {
      const r = await sb.from('caja_turnos').insert(APP.conEmpresa({ caja_id: caja.id, efectivo_inicial: +$('#t-ini', m).value || 0 })).select().single();
      if (r.error) { toast(mensajeError(r.error), 'error'); return; }
      turno = r.data; m.cerrar(); pintarEstado(); toast('Caja abierta');
    };
  }
  function movimientoCaja() {
    const m = modal(`<h2>Ingreso o retiro de efectivo</h2>
      <div class="fila c2" style="margin-top:12px"><div class="campo"><label>Tipo</label><select id="m-tipo"><option value="retiro">Retiro (sale plata)</option><option value="ingreso">Ingreso (entra plata)</option></select></div><div class="campo"><label>Monto</label><input id="m-monto" type="number" min="1" step="100"></div></div>
      <div class="campo"><label>Concepto</label><input id="m-con" placeholder="Pago proveedor, cambio, etc."></div>
      <div class="pie"><button class="btn" data-no>Cancelar</button><button class="btn primario" data-si>Registrar</button></div>`);
    $('[data-no]', m).onclick = () => m.cerrar();
    $('[data-si]', m).onclick = async () => {
      const monto = +$('#m-monto', m).value; if (!monto) return;
      const r = await sb.from('caja_movimientos').insert(APP.conEmpresa({ turno_id: turno.id, tipo: $('#m-tipo', m).value, monto, concepto: $('#m-con', m).value.trim() || null }));
      if (r.error) { toast(mensajeError(r.error), 'error'); return; } m.cerrar(); toast('Registrado');
    };
  }
  async function cerrarTurno() {
    if (colaPendiente().length) { toast('Primero subí las ventas pendientes', 'error'); return; }
    const { data: esp, error } = await sb.rpc('caja_esperado', { p_turno: turno.id });
    if (error) { toast(mensajeError(error), 'error'); return; }
    const filas = (esp.formas || []).filter(f => f.esperado || f.ventas || f.tipo === 'efectivo');
    const m = modal(`<h2>Cerrar caja</h2><p class="sub">${esp.ventas} ventas · ${fmt.pesos(esp.total)} vendidos. Contá lo que hay y anotalo por medio de pago.</p>
      <table class="lista" style="margin-top:10px"><tr><th>Medio</th><th class="num">Esperado</th><th class="num">Contado</th><th class="num">Dif.</th></tr>
      ${filas.map(f => `<tr data-id="${f.forma_pago_id}" data-esp="${f.esperado}"><td>${esc(f.nombre)}${f.tipo === 'efectivo' ? ' <small style="color:var(--tinta-3)">(inicial ' + fmt.pesos(esp.efectivo_inicial) + ' ' + (esp.movimientos >= 0 ? '+' : '') + fmt.pesos(esp.movimientos) + ' mov.)</small>' : ''}</td><td class="num">${fmt.pesos(f.esperado)}</td><td class="num"><input type="number" step="1" value="${Math.round(f.esperado)}" style="width:110px;text-align:right;font-family:var(--f-mono);border:1px solid var(--linea);border-radius:7px;padding:4px 6px"></td><td class="num dif">—</td></tr>`).join('')}</table>
      <div class="campo" style="margin-top:12px"><label>Notas</label><input id="c-notas"></div>
      <div class="pie"><button class="btn" data-no>Cancelar</button><button class="btn primario" data-si>Cerrar caja</button></div>`, { fijo: true });
    const calc = () => $$('tr[data-id]', m).forEach(tr => { const d = (+$('input', tr).value || 0) - +tr.dataset.esp; const td = $('.dif', tr); td.textContent = (d > 0 ? '+' : '') + fmt.pesos(d); td.style.color = Math.abs(d) < 1 ? 'var(--ok)' : 'var(--error)'; });
    $$('input', m).forEach(i => i.addEventListener('input', calc)); calc();
    $('[data-no]', m).onclick = () => m.cerrar();
    $('[data-si]', m).onclick = async () => {
      const arqueo = $$('tr[data-id]', m).map(tr => ({ forma_pago_id: tr.dataset.id, nombre: $('td', tr).textContent.trim().split(' (')[0], esperado: +tr.dataset.esp, declarado: +$('input', tr).value || 0, diferencia: r2((+$('input', tr).value || 0) - +tr.dataset.esp) }));
      const r = await sb.from('caja_turnos').update({ estado: 'cerrado', cerrado: new Date().toISOString(), cerrado_por: APP.user.id, arqueo, notas: $('#c-notas', m).value.trim() || null }).eq('id', turno.id);
      if (r.error) { toast(mensajeError(r.error), 'error'); return; }
      m.cerrar(); turno = null; pintarEstado(); toast('Caja cerrada');
    };
  }

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
      return `<div class="res" data-pid="${pid}"><div class="nom">${esc(v0.producto_nombre)}</div><div class="cod">${esc(v0.producto_codigo)} · ${unico ? 'único' : vars.length + ' variantes'}</div><div class="pre">${fmt.pesos(precioLista(v0))}</div><span class="st chip ${st > 0 ? 'ok' : 'gris'}">${fmt.num(st)}</span></div>`;
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
        const otra = carrito.lineas.find(x => x !== l && x.variante.id === v.id && !x.devuelta);
        if (otra) { otra.cantidad += l.cantidad; carrito.lineas.splice(carrito.lineas.indexOf(l), 1); }
        else { l.variante = v; l.falla = false; delete l.fallaU; delete l.componentes; delete l.componentes_ok; }
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
    reservado = pin; document.body.classList.add('reservado');
    const emi = vendedoras.find(v => /^emi/i.test(v.nombre || '')); vendedoraAntes = carrito.vendedora;
    if (emi) { carrito.vendedora = emi.user_id; const sv = $('#sel-vendedora'); if (sv) sv.value = emi.user_id; }
    document.body.insertAdjacentHTML('beforeend', '<div id="barra-reservado"><span>🔒 Modo reservado</span><button type="button" id="btn-reservadas">Ventas reservadas</button><small>Para salir: la clave + Enter en el buscador</small></div>');
    $('#btn-reservadas').onclick = verReservadas;
    pintar(); $('#q').focus();
  }
  function salirReservado() {
    reservado = null; document.body.classList.remove('reservado');
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
    if (ev.key === '/' && document.activeElement !== q && !ev.target.closest('.modal')) { ev.preventDefault(); q.focus(); }
    if (ev.key === 'Enter' && ev.ctrlKey && !ev.target.closest('.modal')) { ev.preventDefault(); $('#btn-cobrar').click(); }   // por el botón: el POS puede interceptarlo
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
  function agregar(v, cantidad) {
    if (!v) return;
    if (cantidad == null) cantidad = (APP.caja && APP.caja.tomarCantidad && APP.caja.tomarCantidad()) || 1;   // el teclado del POS puede dejar una cantidad lista
    const ya = carrito.lineas.find(l => l.variante.id === v.id && !l.devuelta);
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
    cont.innerHTML = items.length ? `<h3>Recientes</h3><div class="resultados">${items.map(v0 => `<div class="res" data-pid="${v0.producto_id}"><div class="nom">${esc(v0.producto_nombre)}</div><div class="cod">${esc(v0.producto_codigo)}</div><div class="pre">${fmt.pesos(precioLista(v0))}</div></div>`).join('')}</div>` : '';
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
    const lineas = carrito.lineas.map(l => { const pc = precioDe(l.variante), pl = pc.precio, df = l.falla ? descFalla(l) : 0; const pu = r2(pl * (1 - Math.max(l.descPct || 0, df) / 100)); return Object.assign(l, { precioLista: pl, precioBase: pc.base, rebaja: pc.rebaja, precioUnit: pu, descFalla: df, promo: null, descPromo: 0 }); });
    promos.forEach(p => {
      const grupo = lineas.filter(l => l.cantidad > 0 && promoAplica(p, l.variante));
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
    const c = calcular(), cont = $('#lineas');
    if (!c.lineas.length) cont.innerHTML = '<div class="vacio-ticket">Escaneá o buscá una prenda para empezar.</div>';
    else cont.innerHTML = c.lineas.map((l, i) => `<div class="linea">
      <div><div class="n">${l.devuelta ? esc(l.variante.producto_nombre) : `<span class="cambiable" data-cambiar="${i}" title="Tocá para cambiar el talle, el color o la prenda">${esc(l.variante.producto_nombre)} <span class="lapiz">✎</span></span>`}${l.devuelta ? ' <span class="chip error">devuelve</span>' : ''}</div><div class="v">${l.devuelta ? esc([l.variante.talle_nombre, l.variante.color_nombre].filter(Boolean).join(' · ') || l.variante.sku || '') : `<span class="cambiable" data-cambiar="${i}">${esc([l.variante.talle_nombre, l.variante.color_nombre].filter(Boolean).join(' · ') || 'único')}</span>`} · ${fmt.pesos(l.precioLista)}${l.descPct ? ' −' + l.descPct + '%' : ''}${!l.devuelta && controlaStock(l.variante) && llevando(l.variante) > Math.max(+l.variante.stock || 0, 0) ? '<span class="sinstock-chip" title="El sistema dice que no hay suficiente">⚠ sin stock</span>' : ''}</div>${l.rebaja && !l.devuelta ? `<div class="promo">▼ ${esc(l.rebaja.nombre)} · antes ${fmt.pesos(l.precioBase)}</div>` : ''}${l.promo ? `<div class="promo">★ ${esc(l.promo.nombre)} · −${fmt.pesos(l.descPromo)}/u</div>` : ''}${(+l.variante.fallas > 0 || l.falla) && !l.devuelta ? `<button class="falla ${l.falla ? 'on' : ''}" data-falla="${i}" title="${l.falla ? 'Tocá para desmarcar' : esc(l.variante.falla_nota || '')}">${l.falla ? '◆ Con falla' + (l.fallaU && l.fallaU.nota ? ': ' + esc(l.fallaU.nota) : '') + (l.descFalla ? ' · ' + fmt.dec(l.descFalla) + '% off' : '') : '◆ Hay ' + fmt.num(l.variante.fallas) + ' con falla · ¿es esta?'}</button>` : ''}</div>
      <div class="t">${fmt.pesos(l.total)}</div>
      <div class="ctrl"><button data-i="${i}" data-d="-1">−</button><input data-i="${i}" data-q value="${l.cantidad}"><button data-i="${i}" data-d="1">+</button><span class="desc">desc % <input data-i="${i}" data-desc type="number" min="0" max="100" value="${l.descPct || 0}"></span><button class="quitar" data-i="${i}" data-x title="Quitar">×</button></div></div>`).join('');
    $$('[data-d]', cont).forEach(b => b.onclick = () => { const l = carrito.lineas[+b.dataset.i]; l.cantidad += +b.dataset.d * (l.devuelta ? -1 : 1); if ((l.devuelta ? -l.cantidad : l.cantidad) <= 0) carrito.lineas.splice(+b.dataset.i, 1); pintar(); });
    $$('[data-q]', cont).forEach(i => i.onchange = () => { const n = parseInt(i.value) || 0; const l = carrito.lineas[+i.dataset.i]; if (n === 0) carrito.lineas.splice(+i.dataset.i, 1); else l.cantidad = l.devuelta ? -Math.abs(n) : Math.abs(n); pintar(); });
    $$('[data-desc]', cont).forEach(i => i.onchange = () => { if (!APP.puede('descuentos') && +i.value > 0) { toast('Los descuentos los habilita administración', 'error'); i.value = 0; return; } carrito.lineas[+i.dataset.i].descPct = Math.min(100, Math.max(0, +i.value || 0)); pintar(); });
    $$('[data-x]', cont).forEach(b => b.onclick = () => { carrito.lineas.splice(+b.dataset.i, 1); pintar(); });
    $$('[data-cambiar]', cont).forEach(el => el.onclick = ev => { ev.stopPropagation(); cambiarLinea(+el.dataset.cambiar); });
    $$('[data-falla]', cont).forEach(b => b.onclick = ev => { ev.stopPropagation(); const l = carrito.lineas[+b.dataset.falla]; if (l.falla) { l.falla = false; delete l.fallaU; pintar(); } else marcarFalla(l); });
    $('#listas').innerHTML = listas.map(l => `<button class="${l.id === carrito.lista ? 'on' : ''}" data-l="${l.id}" title="${+l.porcentaje === 100 ? 'Precio de lista' : (+l.porcentaje < 100 ? '−' + fmt.dec(100 - l.porcentaje) : '+' + fmt.dec(l.porcentaje - 100)) + '% sobre Lista'}">${esc(l.nombre)}</button>`).join('');
    $$('#listas button').forEach(b => b.onclick = () => { carrito.lista = b.dataset.l; pintar(); });
    $('#totales').innerHTML = `<div><span>Subtotal</span><span class="mono">${fmt.pesos(c.subtotal)}</span></div>${c.descuento ? `<div><span>Descuento ${carrito.descPct}%</span><span class="mono">−${fmt.pesos(c.descuento)}</span></div>` : ''}<div class="gran"><span>Total</span><span>${fmt.pesos(c.total)}</span></div>`;
    $('#ticket-sub').textContent = carrito.cambio ? `Cambio sobre la venta #${carrito.cambio.numero}` : (c.lineas.length ? `${c.lineas.reduce((s, l) => s + Math.abs(l.cantidad), 0)} prendas` : 'Nueva venta');
    $('#btn-cobrar').disabled = !c.lineas.length;
    $('#btn-sena').disabled = !c.lineas.length || !!carrito.cambio;
  }
  $('#btn-vaciar').onclick = async () => { if (!carrito.lineas.length || await confirmar('¿Vaciar el ticket?', 'Vaciar')) { carrito.lineas = []; carrito.cambio = null; carrito.envio = null; pintarEntrega(); carrito.descPct = 0; $('#desc-general').value = 0; $('#nota').value = ''; pintar(); } };
  $('#desc-general').onchange = ev => { if (!APP.puede('descuentos') && +ev.target.value > 0) { toast('Los descuentos los habilita administración', 'error'); ev.target.value = 0; } carrito.descPct = Math.min(100, Math.max(0, +ev.target.value || 0)); pintar(); };
  $('#sel-vendedora').onchange = ev => carrito.vendedora = ev.target.value;

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
    if (!(await revisarStock())) return;
    const pagos = []; let creditoUsado = null;
    const total = () => { const cc = calcular(); const recargo = pagos.reduce((s, p) => s + r2(p.monto * (p.recargo_pct || 0) / 100), 0); return { ...cc, recargo: r2(recargo), aPagar: r2(cc.total + recargo) }; };
    const m = modal(`<h2>${modoSena ? 'Dejar seña' : (c.total < 0 ? 'Devolver dinero' : 'Cobrar')} <span class="mono" id="cb-total" style="float:right"></span></h2>
      <p class="sub">${modoSena ? 'Pago a cuenta; el resto queda como saldo.' : 'Tocá un medio de pago: se completa con lo que falta. Podés combinar varios.'}</p>
      ${window.MEDIOS ? MEDIOS.botonera(formas, usosFormas, listaDeForma) : `<div class="formas" style="margin-top:12px">${formas.map(f => `<button data-f="${f.id}">${esc(f.nombre)}</button>`).join('')}<button data-cred>Nota de crédito / gift card</button></div>`}
      <div class="pagos-lista" id="cb-pagos"></div>
      <div class="resto" id="cb-resto"></div>
      <div class="pie"><button class="btn" data-no>Cancelar</button><button class="btn primario" data-si disabled>Confirmar</button></div>`, { fijo: true });
    { const caja_ = $('.modal', m); if (caja_ && window.MEDIOS) caja_.style.maxWidth = '660px'; }
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
    $$('[data-f]', m).forEach(b => b.onclick = () => {
      const f = formas.find(x => x.id === b.dataset.f);
      // si el medio tiene lista propia y es el primer pago, el ticket pasa a esa lista
      const lf = listaDeForma(f); if (lf && !pagos.length && carrito.lista !== lf.id) { carrito.lista = lf.id; pintar(); }
      const t = total(); const pagado = pagos.reduce((s, p) => s + p.monto, 0);
      let monto = r2(t.aPagar - pagado); if (f.recargo_pct) monto = r2((t.total + pagos.reduce((s, p) => s + r2(p.monto * (p.recargo_pct || 0) / 100), 0) - pagado) / (1 + f.recargo_pct / 100));
      if (modoSena && !pagos.length) monto = r2(Math.round(t.aPagar / 2 / 100) * 100);
      pagos.push({ forma_pago_id: f.id, nombre: f.nombre, tipo: f.tipo, cuotas: f.cuotas, recargo_pct: +f.recargo_pct || 0, monto: t.aPagar < 0 ? Math.min(0, monto) : Math.max(0, monto) }); pintarPagos();
    });
    $('[data-cred]', m).onclick = () => {
      const m2 = modal(`<h2>Pagar con crédito</h2><div class="campo" style="margin-top:12px"><label>Código de la nota de crédito o gift card</label><input id="cr-cod" placeholder="8 letras y números" style="text-transform:uppercase;font-family:var(--f-mono)"></div><div class="pie"><button class="btn" data-no>Volver</button><button class="btn primario" data-si>Aplicar</button></div>`);
      $('[data-no]', m2).onclick = () => m2.cerrar();
      $('[data-si]', m2).onclick = async () => {
        const codigo = $('#cr-cod', m2).value.trim().toUpperCase(); if (!codigo) return;
        const { data } = await sb.from('creditos').select('*').eq('empresa_id', e).eq('codigo', codigo).maybeSingle();
        if (!data || data.estado !== 'vigente' || +data.saldo <= 0) { toast('Ese código no tiene saldo vigente', 'error'); return; }
        if (pagos.some(p => p.credito_id === data.id)) { toast('Ese crédito ya está aplicado', 'error'); return; }
        const t = total(); const pagado = pagos.reduce((s, p) => s + p.monto, 0);
        pagos.push({ credito_id: data.id, nombre: `${data.tipo === 'gift_card' ? 'Gift card' : 'Nota de crédito'} ${data.codigo} (saldo ${fmt.pesos(data.saldo)})`, tipo: 'credito', monto: Math.max(0, Math.min(+data.saldo, r2(t.aPagar - pagado))) });
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
        if (Math.abs(devuelto - t.aPagar) > 0.5) { creditos_a_emitir.push({ tipo: 'nota_credito', monto: r2(-t.aPagar - (-devuelto)), cliente_id: carrito.cliente, vence: null, nota: 'Por cambio/devolución' }); }
      }
      const cliente = await resolverCliente();
      const payload = {
        empresa_id: e, offline_id: crypto.randomUUID(), tipo: carrito.cambio ? 'cambio' : 'venta', estado: modoSena ? 'senada' : 'completada',
        caja_id: reservado ? null : caja.id, turno_id: reservado ? null : turno.id, reservada: !!reservado, pin: reservado || undefined, cliente_id: cliente, vendedora_id: carrito.vendedora, lista_id: carrito.lista,
        descuento_pct: carrito.descPct || 0, descuento: t.descuento, recargo: t.recargo, nota: $('#nota').value.trim() || null,
        envio: carrito.envio || null,
        venta_origen_id: carrito.cambio ? carrito.cambio.id : null, origen: ($('#sel-origen') || {}).value || 'local',
        lineas: t.lineas.map(l => ({ variante_id: l.variante.id, producto_id: l.variante.producto_id, descripcion: l.variante.producto_nombre, talle: l.variante.talle_nombre, color: l.variante.color_nombre, cantidad: l.cantidad, precio_lista: l.precioLista, precio_unit: l.precioFinal, descuento_pct: l.descPct || 0, promocion_id: l.promo ? l.promo.id : null, promocion_nombre: l.promo ? l.promo.nombre : null, total: l.total, costo_unit: +l.variante.costo || 0, componentes: l.componentes && l.componentes.length ? l.componentes : null, falla: !!l.falla, falla_id: l.fallaU ? l.fallaU.id : null })),
        pagos: pagosFinal.filter(p => p.monto !== 0).map(p => ({ forma_pago_id: p.forma_pago_id || null, credito_id: p.credito_id || null, monto: p.monto, cuotas: p.cuotas || 1, recargo_pct: p.recargo_pct || 0 })),
        creditos_a_emitir
      };
      // la ventana de cobro queda abierta mientras se registra: si falla, se ve el error y se puede reintentar
      const bSi = $('[data-si]', m); bSi.textContent = 'Registrando…';
      let res;
      try { res = await enviarVenta(payload); }
      catch (err) { bSi.disabled = false; bSi.textContent = 'Confirmar'; const r = $('#cb-resto', m); if (r) { r.className = 'resto falta'; r.innerHTML = `<span>No se pudo registrar: ${esc(mensajeError(err))}</span><span>Probá de nuevo</span>`; } return; }
      m.cerrar();
      const numTxt = res.numero_mostrar || (res.numero ? '#' + String(res.numero).padStart(6, '0') : '');
      toast(res.pendiente ? 'Venta guardada: se sube sola cuando vuelva internet' : `✓ Venta ${numTxt} registrada`);
      try { mostrarTicket(payload, res, { vuelto: vuelto > 0 ? vuelto : 0, pagos: pagosFinal, total: t }); }
      catch (err) { console.error(err); modal(`<h2>✓ Venta ${esc(numTxt)} registrada</h2><div style="font:800 30px var(--f-titulo);margin:6px 0">${fmt.pesos(t.aPagar)}</div>${vuelto > 0 ? `<div class="aviso-caja info">Vuelto: <b>${fmt.pesos(vuelto)}</b></div>` : ''}<div class="pie"><button class="btn primario" onclick="this.closest('.modal-fondo').remove()">Listo</button></div>`); }
      cargarFallas(); setTimeout(pintarAvisosStock, 1200);
      if (carrito.avisos) { toast('Venta hecha. Quedó un aviso para corregir el stock en Inventario', 'error'); carrito.avisos = 0; setTimeout(pintarAvisosStock, 1500); }
      carrito.lineas = []; carrito.cambio = null; carrito.envio = null; pintarEntrega(); carrito.descPct = 0; $('#desc-general').value = 0; $('#nota').value = ''; $('#sel-cliente').value = ''; if ($('#sel-origen')) $('#sel-origen').value = 'local';
      carrito.lista = (listas.find(x => x.predeterminada) || listas[0] || {}).id;   // la próxima venta arranca con la lista base
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
  $('#btn-sena').onclick = () => cobrar(true);

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
    const lineas = p.lineas.map(l => `<tr><td>${l.cantidad}× ${esc(l.descripcion)}${l.falla ? ' ◆' : ''}<br><small>${esc([l.talle, l.color].filter(Boolean).join(' · '))}${l.promocion_nombre ? ' · ' + esc(l.promocion_nombre) : ''}</small></td><td class="r">${fmt.pesos(l.total)}</td></tr>`).join('');
    const pagos = extra.pagos.map(pg => `<tr><td>${esc(pg.nombre)}${pg.cuotas > 1 ? ' (' + pg.cuotas + ' cuotas)' : ''}</td><td class="r">${fmt.pesos(pg.monto)}</td></tr>`).join('');
    const html = `${emp.logo_url ? `<div class="c"><img src="${esc(emp.logo_url)}" alt="" style="max-width:42mm;max-height:20mm;margin:0 auto 4px;display:block"></div>` : ''}<h2 class="c">${esc(emp.nombre)}</h2><div class="c">${esc([emp.domicilio, emp.localidad].filter(Boolean).join(' · '))}<br>${esc(emp.telefono || '')}</div><hr>
      <div>Ticket ${num} · ${new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
      <div>Atendió: ${esc((vendedoras.find(v => v.user_id === p.vendedora_id) || {}).nombre || '')}</div><hr>
      <table>${lineas}</table><hr>
      <table>${extra.total.descuento ? `<tr><td>Descuento ${p.descuento_pct}%</td><td class="r">−${fmt.pesos(extra.total.descuento)}</td></tr>` : ''}${extra.total.recargo ? `<tr><td>Recargo</td><td class="r">${fmt.pesos(extra.total.recargo)}</td></tr>` : ''}<tr><td><b>TOTAL</b></td><td class="r"><b>${fmt.pesos(extra.total.aPagar)}</b></td></tr>${pagos}${extra.vuelto ? `<tr><td>Vuelto</td><td class="r">${fmt.pesos(extra.vuelto)}</td></tr>` : ''}${p.estado === 'senada' ? `<tr><td><b>SEÑA · saldo</b></td><td class="r"><b>${fmt.pesos(r2(extra.total.aPagar - extra.pagos.reduce((s, x) => s + x.monto, 0)))}</b></td></tr>` : ''}</table>
      ${(res.creditos || []).map(c => `<hr><div class="c"><b>${c.tipo === 'gift_card' ? 'GIFT CARD' : 'NOTA DE CRÉDITO'}</b><br>Código <b>${c.codigo}</b> · ${fmt.pesos(c.monto)}</div>`).join('')}
      ${p.nota ? `<hr><div>${esc(p.nota)}</div>` : ''}<hr><div class="c">Cambios con este ticket dentro de los 30 días.<br>¡Gracias por tu compra!</div>`;
    $('#impresion').innerHTML = html;
    const texto = encodeURIComponent(`${emp.nombre} · Ticket ${num}\n` + p.lineas.map(l => `${l.cantidad}× ${l.descripcion} ${[l.talle, l.color].filter(Boolean).join(' ')} ${fmt.pesos(l.total)}`).join('\n') + `\nTOTAL ${fmt.pesos(extra.total.aPagar)}` + (p.estado === 'senada' ? `\nSeña: saldo ${fmt.pesos(r2(extra.total.aPagar - extra.pagos.reduce((s, x) => s + x.monto, 0)))}` : '') + `\n¡Gracias por tu compra!`);
    const m = modal(`<h2>${res.pendiente ? 'Venta guardada (se sube al volver internet)' : '✓ Venta ' + num + ' registrada'}</h2>
      <div style="font:800 30px var(--f-titulo);letter-spacing:-.03em;margin:6px 0">${fmt.pesos(extra.total.aPagar)}</div>
      ${extra.vuelto ? `<div class="aviso-caja info">Vuelto: <b>${fmt.pesos(extra.vuelto)}</b></div>` : ''}
      ${(res.creditos || []).map(c => `<div class="aviso-caja ok">${c.tipo === 'gift_card' ? 'Gift card' : 'Nota de crédito'} emitida · código <b class="mono">${c.codigo}</b> · ${fmt.pesos(c.monto)}</div>`).join('')}
      <div class="pie" style="justify-content:space-between"><div style="display:flex;gap:8px;flex-wrap:wrap">${res.id && p.estado === 'completada' && !p.reservada && !res.reservada && window.FACTURA ? '<button class="btn" data-facturar hidden>Facturar</button>' : ''}<button class="btn" data-print>Imprimir ticket</button><a class="btn" target="_blank" href="https://wa.me/?text=${texto}">WhatsApp</a></div><button class="btn primario" data-ok>Nueva venta</button></div>`, { fijo: true });
    $('[data-print]', m).onclick = () => window.print();
    const bf = $('[data-facturar]', m);
    if (bf) FACTURA.config(e).then(c => { if (c.estado !== 'listo') return; bf.hidden = false; bf.onclick = () => FACTURA.abrir({ id: res.id, numero: res.numero, total: extra.total.aPagar, cliente_id: p.cliente_id || null, cliente_nombre: null }, { alTerminar: c2 => { if (c2 && c2.estado === 'autorizado') { bf.textContent = '✓ ' + c2.nombre_tipo + ' ' + c2.numero_mostrar; bf.onclick = () => window.open(FACTURA.urlFactura(c2.id), '_blank'); } } }); });
    $('[data-ok]', m).onclick = () => { m.cerrar(); $('#q').focus(); };
  }

  // ================= Cambio / devolución =================
  $('#btn-cambio').onclick = () => {
    const m = modal(`<h2>Cambio o devolución</h2><p class="sub">Buscá la venta original por número de ticket.</p>
      <div class="campo" style="margin-top:12px"><label>Número de ticket</label><input id="cv-num" placeholder="Ej. 1234 o R-12" autofocus></div>
      <div id="cv-res"></div>`);
    const buscarVenta = async () => {
      const n = $('#cv-num', m).value.trim(); if (!n) return;
      // por función: la vendedora encuentra el ticket aunque no vea el listado de ventas viejas (también los R- en efectivo)
      const { data: v } = await sb.rpc('venta_para_cambio', { e, p_numero: n });
      if (!v) { $('#cv-res', m).innerHTML = '<div class="vacio">No existe ese ticket.</div>'; return; }
      if (v.estado === 'anulada') { $('#cv-res', m).innerHTML = '<div class="vacio">Esa venta está anulada.</div>'; return; }
      const ls = v.lineas || [];
      $('#cv-res', m).innerHTML = `<p class="sub" style="margin:8px 0">Venta ${v.mostrar} · ${fmt.fechaHora(v.fecha)} · ${fmt.pesos(v.total)}. Marcá lo que devuelve:</p>
        <table class="lista">${(ls || []).map(l => `<tr><td><input type="checkbox" data-l="${l.id}"></td><td>${esc(l.descripcion)}<br><small>${esc([l.talle, l.color].filter(Boolean).join(' · '))}</small></td><td class="num">${l.cantidad}× ${fmt.pesos(l.precio_unit)}</td></tr>`).join('')}</table>
        <div class="pie"><button class="btn" data-no>Cancelar</button><button class="btn primario" data-si>Cargar al ticket</button></div>`;
      $('[data-no]', m).onclick = () => m.cerrar();
      $('[data-si]', m).onclick = () => {
        const sel = $$('input[data-l]:checked', m).map(i => (ls || []).find(l => String(l.id) === i.dataset.l));
        if (!sel.length) { toast('Marcá al menos una prenda', 'error'); return; }
        carrito.cambio = { id: v.id, numero: v.numero }; carrito.lista = v.lista_id || carrito.lista;
        sel.forEach(l => { const v2 = catalogo.find(x => x.id === l.variante_id) || { id: l.variante_id, producto_id: l.producto_id, producto_nombre: l.descripcion, talle_nombre: l.talle, color_nombre: l.color, precio: l.precio_lista, costo: l.costo_unit };
          carrito.lineas.push({ variante: v2, cantidad: -l.cantidad, descPct: 0, devuelta: true, precioFijo: l.precio_unit }); });
        m.cerrar(); pintar(); toast('Agregá ahora lo que se lleva, o cobrá para devolver el dinero / emitir nota de crédito'); $('#q').focus();
      };
    };
    $('#cv-num', m).addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); buscarVenta(); } });
    $('#cv-num', m).addEventListener('change', buscarVenta);
  };
  // las líneas devueltas se valoran a lo que se pagó, no al precio de hoy
  const calcularBase = calcular;
  calcular = function () { const c = calcularBase(); c.lineas.forEach(l => { if (l.devuelta && l.precioFijo != null) { l.precioLista = l.precioFijo; l.precioUnit = l.precioFijo; l.promo = null; l.descPromo = 0; l.precioFinal = l.precioFijo; l.total = r2(l.precioFijo * l.cantidad); } });
    let subtotal = 0, costo = 0; c.lineas.forEach(l => { subtotal += l.total; costo += (+l.variante.costo || 0) * l.cantidad; });
    c.subtotal = r2(subtotal); c.descuento = r2(subtotal * (carrito.descPct || 0) / 100); c.total = r2(c.subtotal - c.descuento); c.costo = r2(costo); return c; };

  // ================= Arranque =================
  // lo que el POS (pos.js) necesita de la caja: catálogo en memoria, carrito y acciones
  APP.caja = { get catalogo() { return catalogo; }, get productos() { return productos; }, get carrito() { return carrito; }, get turno() { return turno; }, get listas() { return listas; },
    agregar, elegirProducto, pintar, precioLista, cobrar, calcular: () => calcular(), buscar, abrirTurno, cerrarTurno, movimientoCaja, pintarEstado, colaPendiente, sincronizar, buscadorPick, pintarAvisosStock, revisarStock };
  // Recordatorio: prendas vendidas sin stock en el sistema (o sin marcar la falla) que hay que corregir
  // Pendientes (prendas sin definir, stock para revisar): la píldora va en el ticket porque el POS no tiene barra superior
  function pintarAvisosStock() {
    if (!document.getElementById('aviso-stock')) { const sub = document.getElementById('ticket-sub'); if (!sub) return; sub.insertAdjacentHTML('afterend', '<button id="aviso-stock" class="pildora-pend" data-pendientes hidden>📌 <b></b> pendientes</button>'); }
    if (APP.pendientes) APP.pendientes.refrescar();
  }
  await cargarBase(); await cargarTurno(); pintar(); pintarRecientes(); sincronizar(); pintarAvisosStock();
  if (APP.caja.alCargar) APP.caja.alCargar();
  const params = new URLSearchParams(location.search); if (params.get('cambio')) { $('#btn-cambio').click(); }
});
