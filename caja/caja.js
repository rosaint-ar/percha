/* Percha · Caja: búsqueda y lector, ticket, promociones, cobro mixto, señas, cambios, turno y arqueo, cola sin internet. */
APP.ready.then(async () => {
  const { fmt, esc, $, $$, toast, modal, confirmar, mensajeError } = APP, e = APP.empresa.id;
  if (APP.rol === 'visor') { $('main').innerHTML = '<div class="card"><p>Tu usuario es de solo lectura: no puede vender.</p></div>'; return; }
  const LS = k => `percha_${k}_${e}`;
  const hoy = () => new Date().toISOString().slice(0, 10);
  const r2 = n => Math.round((+n || 0) * 100) / 100;

  // ================= Datos base =================
  let catalogo = [], productos = {}, listas = [], formas = [], promos = [], vendedoras = [], caja = null, turno = null, clientes = [];
  let carrito = { lineas: [], lista: null, cliente: null, vendedora: APP.user.id, descPct: 0, nota: '', cambio: null };

  async function paginar(consulta, pagina = 1000) {
    let desde = 0, todo = [];
    while (true) { const { data, error } = await consulta().range(desde, desde + pagina - 1); if (error) throw error; todo = todo.concat(data || []); if (!data || data.length < pagina) break; desde += pagina; }
    return todo;
  }
  async function cargarBase() {
    const [l, f, p, v, c, cl] = await Promise.all([
      sb.from('listas_precios').select('*').eq('empresa_id', e).eq('activa', true).order('orden'),
      sb.from('formas_pago').select('*').eq('empresa_id', e).eq('activa', true).order('orden'),
      sb.from('promociones').select('*').eq('empresa_id', e).eq('activa', true),
      sb.from('empresa_usuarios').select('user_id,nombre,rol').eq('empresa_id', e).eq('activo', true).neq('rol', 'visor').order('nombre'),
      sb.from('cajas').select('*').eq('empresa_id', e).eq('activa', true).order('nombre').limit(1),
      sb.from('clientes').select('id,nombre,telefono,lista_id').eq('empresa_id', e).eq('activo', true).eq('generico', false).order('nombre').limit(1000)
    ]);
    listas = l.data || []; formas = f.data || []; promos = p.data || []; vendedoras = v.data || []; caja = (c.data || [])[0]; clientes = cl.data || [];
    carrito.lista = carrito.lista || (listas.find(x => x.predeterminada) || listas[0] || {}).id;
    try {
      const [vars, prods] = await Promise.all([
        paginar(() => sb.from('v_variantes').select('id,producto_id,producto_codigo,producto_nombre,producto_tipo,sku,ean,talle,talle_nombre,talle_orden,color,color_nombre,color_hex,precio,costo,stock,activa').eq('empresa_id', e).eq('activa', true).order('producto_nombre').order('talle_orden')),
        paginar(() => sb.from('productos').select('id,categoria_id,tipo,activo').eq('empresa_id', e).eq('activo', true))
      ]);
      productos = Object.fromEntries(prods.map(x => [x.id, x]));
      catalogo = vars.filter(x => productos[x.id === undefined ? '' : x.producto_id]);
      localStorage.setItem(LS('catalogo'), JSON.stringify({ t: Date.now(), vars: catalogo, prods }));
    } catch (err) {
      const cache = JSON.parse(localStorage.getItem(LS('catalogo')) || 'null');
      if (cache) { catalogo = cache.vars; productos = Object.fromEntries(cache.prods.map(x => [x.id, x])); toast('Sin conexión: catálogo guardado del ' + fmt.fechaHora(cache.t), 'error'); }
      else { toast('No se pudo cargar el catálogo', 'error'); }
    }
    const selV = $('#sel-vendedora'); selV.innerHTML = vendedoras.map(x => `<option value="${x.user_id}" ${x.user_id === APP.user.id ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('');
    $('#dl-clientes').innerHTML = clientes.map(x => `<option value="${esc(x.nombre)}">${esc(x.telefono || '')}</option>`).join('');
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
    const m = modal(`<h2>${esc(vars[0].producto_nombre)}</h2><p class="sub">Elegí talle y color</p><div class="matriz-pick">${vars.sort((a, b) => (a.talle_orden ?? 999) - (b.talle_orden ?? 999) || String(a.color_nombre).localeCompare(b.color_nombre)).map(v => `<button data-v="${v.id}" class="${+v.stock > 0 ? '' : 'sin'}">${esc([v.talle_nombre, v.color_nombre].filter(Boolean).join(' · ') || 'único')}<small>${fmt.num(v.stock)} u.</small></button>`).join('')}</div>`);
    $$('[data-v]', m).forEach(b => b.onclick = () => { agregar(catalogo.find(v => v.id === b.dataset.v)); m.cerrar(); });
  }
  const q = $('#q'); let tq;
  q.addEventListener('input', () => { clearTimeout(tq); tq = setTimeout(() => { const r = buscar(q.value); if (r.exacta && q.value.trim().length >= 8) { agregar(r.exacta[0]); q.value = ''; pintarResultados(null); } else pintarResultados(r); }, 120); });
  q.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); const r = buscar(q.value); if (r.exacta) { agregar(r.exacta[0]); q.value = ''; pintarResultados(null); } else if (r.productos && r.productos.length) { elegirProducto(r.productos[0][0]); q.value = ''; pintarResultados(null); } }
    if (ev.key === 'Escape') { q.value = ''; pintarResultados(null); }
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === '/' && document.activeElement !== q && !ev.target.closest('.modal')) { ev.preventDefault(); q.focus(); }
    if (ev.key === 'Enter' && ev.ctrlKey && !ev.target.closest('.modal')) { ev.preventDefault(); cobrar(); }
  });

  // ================= Carrito =================
  function precioLista(v, listaId) {
    const l = listas.find(x => x.id === (listaId || carrito.lista)) || { porcentaje: 100 };
    return Math.round((+v.precio || 0) * (+l.porcentaje) / 100);
  }
  function agregar(v, cantidad = 1) {
    if (!v) return;
    const ya = carrito.lineas.find(l => l.variante.id === v.id && !l.devuelta);
    if (ya) ya.cantidad += cantidad; else carrito.lineas.push({ variante: v, cantidad, descPct: 0 });
    recientes(v); pintar(); $('#q').focus();
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
  function promoAplica(p, v) {
    const d = new Date(); const dow = ((d.getDay() + 6) % 7) + 1; const f = hoy();
    if (p.desde && f < p.desde) return false; if (p.hasta && f > p.hasta) return false;
    if (!(p.dias_semana || []).includes(dow)) return false;
    if (p.alcance === 'familias') return (p.familia_ids || []).includes((productos[v.producto_id] || {}).categoria_id);
    if (p.alcance === 'productos') return (p.producto_ids || []).includes(v.producto_id);
    return (productos[v.producto_id] || {}).tipo === 'prenda';
  }
  function calcular() {
    // precio base por lista, descuento de línea, luego la mejor promo por línea (sin acumular)
    const lineas = carrito.lineas.map(l => { const pl = precioLista(l.variante); const pu = r2(pl * (1 - (l.descPct || 0) / 100)); return Object.assign(l, { precioLista: pl, precioUnit: pu, promo: null, descPromo: 0 }); });
    promos.forEach(p => {
      const grupo = lineas.filter(l => l.cantidad > 0 && promoAplica(p, l.variante));
      if (!grupo.length) return;
      const unidades = grupo.reduce((s, l) => s + l.cantidad, 0);
      if (p.tipo === 'porcentaje' || (p.tipo === 'cantidad' && unidades >= p.n)) {
        grupo.forEach(l => { const d = r2(l.precioUnit * (+p.valor) / 100); if (d > l.descPromo) { l.descPromo = d; l.promo = p; } });
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
      <div><div class="n">${esc(l.variante.producto_nombre)}${l.devuelta ? ' <span class="chip error">devuelve</span>' : ''}</div><div class="v">${esc([l.variante.talle_nombre, l.variante.color_nombre].filter(Boolean).join(' · ') || l.variante.sku || '')} · ${fmt.pesos(l.precioLista)}${l.descPct ? ' −' + l.descPct + '%' : ''}</div>${l.promo ? `<div class="promo">★ ${esc(l.promo.nombre)} · −${fmt.pesos(l.descPromo)}/u</div>` : ''}</div>
      <div class="t">${fmt.pesos(l.total)}</div>
      <div class="ctrl"><button data-i="${i}" data-d="-1">−</button><input data-i="${i}" data-q value="${l.cantidad}"><button data-i="${i}" data-d="1">+</button><span class="desc">desc % <input data-i="${i}" data-desc type="number" min="0" max="100" value="${l.descPct || 0}"></span><button class="quitar" data-i="${i}" data-x title="Quitar">×</button></div></div>`).join('');
    $$('[data-d]', cont).forEach(b => b.onclick = () => { const l = carrito.lineas[+b.dataset.i]; l.cantidad += +b.dataset.d * (l.devuelta ? -1 : 1); if ((l.devuelta ? -l.cantidad : l.cantidad) <= 0) carrito.lineas.splice(+b.dataset.i, 1); pintar(); });
    $$('[data-q]', cont).forEach(i => i.onchange = () => { const n = parseInt(i.value) || 0; const l = carrito.lineas[+i.dataset.i]; if (n === 0) carrito.lineas.splice(+i.dataset.i, 1); else l.cantidad = l.devuelta ? -Math.abs(n) : Math.abs(n); pintar(); });
    $$('[data-desc]', cont).forEach(i => i.onchange = () => { if (!APP.esAdmin && +i.value > 0) { toast('Los descuentos los habilita administración', 'error'); i.value = 0; return; } carrito.lineas[+i.dataset.i].descPct = Math.min(100, Math.max(0, +i.value || 0)); pintar(); });
    $$('[data-x]', cont).forEach(b => b.onclick = () => { carrito.lineas.splice(+b.dataset.i, 1); pintar(); });
    $('#listas').innerHTML = listas.map(l => `<button class="${l.id === carrito.lista ? 'on' : ''}" data-l="${l.id}" title="${l.porcentaje}% del precio de lista">${esc(l.nombre)}</button>`).join('');
    $$('#listas button').forEach(b => b.onclick = () => { carrito.lista = b.dataset.l; pintar(); });
    $('#totales').innerHTML = `<div><span>Subtotal</span><span class="mono">${fmt.pesos(c.subtotal)}</span></div>${c.descuento ? `<div><span>Descuento ${carrito.descPct}%</span><span class="mono">−${fmt.pesos(c.descuento)}</span></div>` : ''}<div class="gran"><span>Total</span><span>${fmt.pesos(c.total)}</span></div>`;
    $('#ticket-sub').textContent = carrito.cambio ? `Cambio sobre la venta #${carrito.cambio.numero}` : (c.lineas.length ? `${c.lineas.reduce((s, l) => s + Math.abs(l.cantidad), 0)} prendas` : 'Nueva venta');
    $('#btn-cobrar').disabled = !c.lineas.length;
    $('#btn-sena').disabled = !c.lineas.length || !!carrito.cambio;
  }
  $('#btn-vaciar').onclick = async () => { if (!carrito.lineas.length || await confirmar('¿Vaciar el ticket?', 'Vaciar')) { carrito.lineas = []; carrito.cambio = null; carrito.descPct = 0; $('#desc-general').value = 0; $('#nota').value = ''; pintar(); } };
  $('#desc-general').onchange = ev => { if (!APP.esAdmin && +ev.target.value > 0) { toast('Los descuentos los habilita administración', 'error'); ev.target.value = 0; } carrito.descPct = Math.min(100, Math.max(0, +ev.target.value || 0)); pintar(); };
  $('#sel-vendedora').onchange = ev => carrito.vendedora = ev.target.value;

  // ================= Cobro =================
  function listaDeForma(f) { return f && f.lista_id ? listas.find(l => l.id === f.lista_id) : null; }
  async function cobrar(modoSena) {
    const c = calcular(); if (!c.lineas.length) return;
    if (!turno) { toast('Primero abrí la caja', 'error'); abrirTurno(); return; }
    const pagos = []; let creditoUsado = null;
    const total = () => { const cc = calcular(); const recargo = pagos.reduce((s, p) => s + r2(p.monto * (p.recargo_pct || 0) / 100), 0); return { ...cc, recargo: r2(recargo), aPagar: r2(cc.total + recargo) }; };
    const m = modal(`<h2>${modoSena ? 'Dejar seña' : (c.total < 0 ? 'Devolver dinero' : 'Cobrar')} <span class="mono" id="cb-total" style="float:right"></span></h2>
      <p class="sub">${modoSena ? 'Pago a cuenta; el resto queda como saldo.' : 'Tocá un medio de pago: se completa con lo que falta. Podés combinar varios.'}</p>
      <div class="formas" style="margin-top:12px">${formas.map(f => `<button data-f="${f.id}">${esc(f.nombre)}<small>${f.cuotas > 1 ? f.cuotas + ' cuotas' : ''}${f.recargo_pct ? ' · +' + f.recargo_pct + '%' : ''}${listaDeForma(f) ? ' · ' + listaDeForma(f).nombre : ''}</small></button>`).join('')}<button data-cred>Nota de crédito / gift card<small>con código</small></button></div>
      <div class="pagos-lista" id="cb-pagos"></div>
      <div class="resto" id="cb-resto"></div>
      <div class="pie"><button class="btn" data-no>Cancelar</button><button class="btn primario" data-si disabled>Confirmar</button></div>`, { fijo: true });
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
        caja_id: caja.id, turno_id: turno.id, cliente_id: cliente, vendedora_id: carrito.vendedora, lista_id: carrito.lista,
        descuento_pct: carrito.descPct || 0, descuento: t.descuento, recargo: t.recargo, nota: $('#nota').value.trim() || null,
        venta_origen_id: carrito.cambio ? carrito.cambio.id : null, origen: 'local',
        lineas: t.lineas.map(l => ({ variante_id: l.variante.id, producto_id: l.variante.producto_id, descripcion: l.variante.producto_nombre, talle: l.variante.talle_nombre, color: l.variante.color_nombre, cantidad: l.cantidad, precio_lista: l.precioLista, precio_unit: l.precioFinal, descuento_pct: l.descPct || 0, promocion_id: l.promo ? l.promo.id : null, promocion_nombre: l.promo ? l.promo.nombre : null, total: l.total, costo_unit: +l.variante.costo || 0 })),
        pagos: pagosFinal.filter(p => p.monto !== 0).map(p => ({ forma_pago_id: p.forma_pago_id || null, credito_id: p.credito_id || null, monto: p.monto, cuotas: p.cuotas || 1, recargo_pct: p.recargo_pct || 0 })),
        creditos_a_emitir
      };
      m.cerrar();
      const res = await enviarVenta(payload);
      mostrarTicket(payload, res, { vuelto: vuelto > 0 ? vuelto : 0, pagos: pagosFinal, total: t });
      carrito.lineas = []; carrito.cambio = null; carrito.descPct = 0; $('#desc-general').value = 0; $('#nota').value = ''; $('#sel-cliente').value = '';
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
  $('#btn-cobrar').onclick = () => cobrar(false);
  $('#btn-sena').onclick = () => cobrar(true);

  // ---- envío con cola sin internet ----
  const colaPendiente = () => JSON.parse(localStorage.getItem(LS('cola_ventas')) || '[]');
  async function enviarVenta(payload) {
    try {
      const { data, error } = await sb.rpc('caja_registrar_venta', { p: payload });
      if (error) { if (/fetch|network/i.test(error.message)) throw error; toast(mensajeError(error), 'error'); throw error; }
      return data;
    } catch (err) {
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
    pintarEstado(); if (!colaPendiente().length) toast('Ventas pendientes subidas');
  }
  function actualizarRed() { const p = $('#punto-red'); if (p) p.className = 'punto' + (navigator.onLine ? '' : ' off'); }
  window.addEventListener('online', () => { actualizarRed(); sincronizar(); }); window.addEventListener('offline', actualizarRed);

  // ================= Ticket =================
  function mostrarTicket(p, res, extra) {
    const emp = APP.empresa, num = res.numero ? '#' + String(res.numero).padStart(6, '0') : 'pendiente';
    const lineas = p.lineas.map(l => `<tr><td>${l.cantidad}× ${esc(l.descripcion)}<br><small>${esc([l.talle, l.color].filter(Boolean).join(' · '))}${l.promocion_nombre ? ' · ' + esc(l.promocion_nombre) : ''}</small></td><td class="r">${fmt.pesos(l.total)}</td></tr>`).join('');
    const pagos = extra.pagos.map(pg => `<tr><td>${esc(pg.nombre)}${pg.cuotas > 1 ? ' (' + pg.cuotas + ' cuotas)' : ''}</td><td class="r">${fmt.pesos(pg.monto)}</td></tr>`).join('');
    const html = `<h2 class="c">${esc(emp.nombre)}</h2><div class="c">${esc([emp.domicilio, emp.localidad].filter(Boolean).join(' · '))}<br>${esc(emp.telefono || '')}</div><hr>
      <div>Ticket ${num} · ${new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
      <div>Atendió: ${esc((vendedoras.find(v => v.user_id === p.vendedora_id) || {}).nombre || '')}</div><hr>
      <table>${lineas}</table><hr>
      <table>${extra.total.descuento ? `<tr><td>Descuento ${p.descuento_pct}%</td><td class="r">−${fmt.pesos(extra.total.descuento)}</td></tr>` : ''}${extra.total.recargo ? `<tr><td>Recargo</td><td class="r">${fmt.pesos(extra.total.recargo)}</td></tr>` : ''}<tr><td><b>TOTAL</b></td><td class="r"><b>${fmt.pesos(extra.total.aPagar)}</b></td></tr>${pagos}${extra.vuelto ? `<tr><td>Vuelto</td><td class="r">${fmt.pesos(extra.vuelto)}</td></tr>` : ''}${p.estado === 'senada' ? `<tr><td><b>SEÑA · saldo</b></td><td class="r"><b>${fmt.pesos(r2(extra.total.aPagar - extra.pagos.reduce((s, x) => s + x.monto, 0)))}</b></td></tr>` : ''}</table>
      ${(res.creditos || []).map(c => `<hr><div class="c"><b>${c.tipo === 'gift_card' ? 'GIFT CARD' : 'NOTA DE CRÉDITO'}</b><br>Código <b>${c.codigo}</b> · ${fmt.pesos(c.monto)}</div>`).join('')}
      ${p.nota ? `<hr><div>${esc(p.nota)}</div>` : ''}<hr><div class="c">Cambios con este ticket dentro de los 30 días.<br>¡Gracias por tu compra!</div>`;
    $('#impresion').innerHTML = html;
    const texto = encodeURIComponent(`${emp.nombre} · Ticket ${num}\n` + p.lineas.map(l => `${l.cantidad}× ${l.descripcion} ${[l.talle, l.color].filter(Boolean).join(' ')} ${fmt.pesos(l.total)}`).join('\n') + `\nTOTAL ${fmt.pesos(extra.total.aPagar)}` + (p.estado === 'senada' ? `\nSeña: saldo ${fmt.pesos(r2(extra.total.aPagar - extra.pagos.reduce((s, x) => s + x.monto, 0)))}` : '') + `\n¡Gracias por tu compra!`);
    const m = modal(`<h2>${res.pendiente ? 'Venta guardada (se sube al volver internet)' : 'Venta ' + num + ' registrada'}</h2>
      <div style="font:800 30px var(--f-titulo);letter-spacing:-.03em;margin:6px 0">${fmt.pesos(extra.total.aPagar)}</div>
      ${extra.vuelto ? `<div class="aviso-caja info">Vuelto: <b>${fmt.pesos(extra.vuelto)}</b></div>` : ''}
      ${(res.creditos || []).map(c => `<div class="aviso-caja ok">${c.tipo === 'gift_card' ? 'Gift card' : 'Nota de crédito'} emitida · código <b class="mono">${c.codigo}</b> · ${fmt.pesos(c.monto)}</div>`).join('')}
      <div class="pie" style="justify-content:space-between"><div style="display:flex;gap:8px"><button class="btn" data-print>Imprimir ticket</button><a class="btn" target="_blank" href="https://wa.me/?text=${texto}">WhatsApp</a></div><button class="btn primario" data-ok>Nueva venta</button></div>`, { fijo: true });
    $('[data-print]', m).onclick = () => window.print();
    $('[data-ok]', m).onclick = () => { m.cerrar(); $('#q').focus(); };
  }

  // ================= Cambio / devolución =================
  $('#btn-cambio').onclick = () => {
    const m = modal(`<h2>Cambio o devolución</h2><p class="sub">Buscá la venta original por número de ticket.</p>
      <div class="campo" style="margin-top:12px"><label>Número de ticket</label><input id="cv-num" type="number" placeholder="Ej. 1234" autofocus></div>
      <div id="cv-res"></div>`);
    const buscarVenta = async () => {
      const n = +$('#cv-num', m).value; if (!n) return;
      const { data: v } = await sb.from('ventas').select('*').eq('empresa_id', e).eq('numero', n).maybeSingle();
      if (!v) { $('#cv-res', m).innerHTML = '<div class="vacio">No existe ese ticket.</div>'; return; }
      if (v.estado === 'anulada') { $('#cv-res', m).innerHTML = '<div class="vacio">Esa venta está anulada.</div>'; return; }
      const { data: ls } = await sb.from('venta_lineas').select('*').eq('venta_id', v.id).gt('cantidad', 0);
      $('#cv-res', m).innerHTML = `<p class="sub" style="margin:8px 0">Venta #${v.numero} · ${fmt.fechaHora(v.fecha)} · ${fmt.pesos(v.total)}. Marcá lo que devuelve:</p>
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
  await cargarBase(); await cargarTurno(); pintar(); pintarRecientes(); sincronizar();
  const params = new URLSearchParams(location.search); if (params.get('cambio')) { $('#btn-cambio').click(); }
});
