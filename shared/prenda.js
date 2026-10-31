/* Percha · Ventana de una prenda (un talle·color): la MISMA desde Catálogo, Inventario y los avisos de la caja.
   Stock con − / +, prendas con falla una por una (nota, descuento y a qué listas), motivo del cambio,
   avisos pendientes, código de barras, precio propio, etiquetas y sus últimos movimientos.
   Uso: PRENDA.abrir(varianteId, { alGuardar(), desdeFicha: true }) */
(function () {
  const MOTIVOS = ['Rotura o falla', 'Faltante / robo', 'Regalo o canje', 'Uso interno', 'Error de carga', 'Devolución de clienta', 'Devolución a proveedor', 'Recuento', 'Otro'];
  const TIPOS = { venta: 'Venta', devolucion: 'Devolución', ajuste: 'Ajuste', recuento: 'Recuento', compra: 'Compra', inicial: 'Carga inicial', transferencia: 'Traspaso' };
  let listasCache = null, pctxCache = null;

  const css = `
  .pr-cab{display:flex;gap:14px;align-items:center}
  .pr-foto{width:64px;height:64px;border-radius:14px;object-fit:cover;flex:none;background:var(--relleno)}
  .pr-foto.sf{display:grid;place-items:center;font:700 16px var(--f-titulo);color:var(--acento);background:linear-gradient(145deg,rgba(var(--acento-rgb),.16),rgba(var(--acento-rgb),.05))}
  .pr-cab h2{margin:0;font-size:18px;line-height:1.2}.pr-cab .sub{margin:3px 0 0}
  .pr-cab a{font:600 12px var(--f-ui);color:var(--acento);text-decoration:none}
  .pr-aviso{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;border-radius:12px;padding:9px 12px;margin-top:12px;font-size:13px;background:#fdecee;color:#8f2a24;border:1px solid #f3c2c7}
  .pr-aviso.azul{background:#eef4ff;border-color:#c9dbff;color:#1b4f99}
  .pr-aviso label{display:flex;gap:6px;align-items:center;font-weight:600;cursor:pointer;white-space:nowrap}
  .pr-stock{display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:center;border:1px solid var(--linea);border-radius:16px;padding:14px 16px;margin-top:14px;transition:border-color .15s,background .15s}
  .pr-stock.cambio{border-color:var(--acento);background:var(--lila-suave)}
  .pr-et{font:600 10.5px var(--f-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--tinta-3)}
  .pr-et b{color:var(--acento);letter-spacing:0}
  .pr-stock small{display:block;color:var(--tinta-3);font-size:12px;margin-top:3px}
  .pr-paso{display:flex;align-items:center;gap:6px}
  .pr-paso button{width:46px;height:46px;border-radius:12px;border:1px solid var(--linea);background:var(--superficie-2);font:700 21px var(--f-ui);cursor:pointer;color:var(--tinta-2);transition:background .12s,transform .08s}
  .pr-paso button:hover{background:var(--lila);color:var(--acento)}.pr-paso button:active{transform:scale(.93)}
  .pr-paso input{width:78px;height:50px;border:1px solid var(--linea);border-radius:12px;text-align:center;font:800 25px var(--f-mono);background:var(--superficie-2)}
  .pr-motivo{margin-top:10px;display:grid;gap:8px;animation:aparecer .15s ease-out}
  .pr-motivo[hidden]{display:none}
  .pr-chips{display:flex;flex-wrap:wrap;gap:6px}
  .pr-chip{border:1px solid var(--linea);background:var(--superficie-2);border-radius:999px;padding:7px 12px;font:600 12.5px var(--f-ui);cursor:pointer;color:var(--tinta-2)}
  .pr-chip.on{background:var(--acento);border-color:var(--acento);color:#fff}
  .pr-in{height:38px;border:1px solid var(--linea);border-radius:10px;padding:0 12px;background:var(--superficie-2);width:100%;min-width:0}
  .pr-fallas{margin-top:16px}
  .pr-fallas-cab{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
  .pr-fallas-cab h3{margin:0;font:700 14px var(--f-ui);display:flex;align-items:center;gap:8px}
  .pr-fallas-cab h3 span{font:700 11px var(--f-mono);background:#f6d98a;color:#5a4100;border-radius:999px;padding:2px 8px}
  .pr-unidad{border:1px solid #ecd391;background:#fffaf0;border-radius:14px;padding:10px 12px;margin-bottom:8px;display:grid;gap:8px;animation:aparecer .15s ease-out}
  .pr-unidad.nueva{border-style:dashed}
  .pr-u-fila{display:flex;gap:8px;align-items:center}
  .pr-u-fila .num{font:700 12px var(--f-mono);color:#8a6400;flex:none;width:22px}
  .pr-desc{display:flex;align-items:center;border:1px solid var(--linea);border-radius:10px;background:var(--superficie-2);height:38px;width:168px;flex:none;overflow:hidden}
  .pr-desc select{border:0;border-left:1px solid var(--linea);background:var(--relleno);height:100%;font:600 12px var(--f-ui);color:var(--tinta-2);padding:0 6px;cursor:pointer;outline:0}
  .pr-desc input{width:100%;border:0;outline:0;background:transparent;text-align:right;font:700 14px var(--f-mono);padding:0 4px 0 8px}
  .pr-desc span{padding:0 10px 0 2px;font:600 12px var(--f-ui);color:var(--tinta-3)}
  .pr-u-acc{display:flex;gap:4px;flex:none}
  .pr-u-acc button{height:32px;border-radius:9px;border:1px solid var(--linea);background:var(--superficie-2);font:600 12px var(--f-ui);cursor:pointer;padding:0 10px;color:var(--tinta-2)}
  .pr-u-acc button:hover{border-color:var(--acento);color:var(--acento)}
  .pr-u-precio{font-size:12px;color:#8a6400}
  .pr-u-listas{display:flex;flex-wrap:wrap;gap:5px;align-items:center;font-size:12px;color:var(--tinta-3)}
  .pr-u-listas .pr-chip{padding:4px 10px;font-size:11.5px}
  .pr-mas{margin-top:14px;border-top:1px solid var(--linea-suave);padding-top:10px}
  .pr-mas summary{cursor:pointer;font:600 13px var(--f-ui);color:var(--tinta-2)}
  .pr-movs{font-size:12.5px;margin-top:8px}
  .pr-movs div{display:grid;grid-template-columns:92px minmax(0,1fr) 50px;gap:8px;padding:5px 0;border-top:1px solid var(--linea-suave)}
  .pr-movs span{color:var(--tinta-3);font:500 11.5px var(--f-mono)}
  .pr-movs b{text-align:right;font:700 12.5px var(--f-mono)}
  .pr-movs .pos{color:var(--ok)}.pr-movs .neg{color:var(--error)}
  @media (max-width:560px){.pr-stock{grid-template-columns:1fr;justify-items:center;text-align:center}.pr-u-fila{flex-wrap:wrap}}`;
  function estilos() { if (document.getElementById('estilo-prenda')) return; const s = document.createElement('style'); s.id = 'estilo-prenda'; s.textContent = css; document.head.appendChild(s); }

  function agregarEtiquetas(items) {
    let cola = []; try { cola = JSON.parse(localStorage.getItem('augusta_etiquetas') || '[]'); } catch (_) { }
    items.forEach(it => { const ya = cola.find(c => c.variante_id === it.variante_id); if (ya) ya.cantidad = it.cantidad; else cola.push(it); });
    try { localStorage.setItem('augusta_etiquetas', JSON.stringify(cola)); } catch (_) { }
  }

  async function abrir(varianteId, op = {}) {
    estilos();
    const { fmt, esc, $, $$, toast, modal, mensajeError } = APP, raiz = document.querySelector('meta[name="app-root"]')?.content || '';
    const [{ data: d, error }, listas] = await Promise.all([
      sb.rpc('ventana_prenda', { p_variante: varianteId }),
      listasCache ? Promise.resolve(listasCache) : (window.PRECIOS ? PRECIOS.cargar(sb, APP.empresa.id).then(c => { pctxCache = c; return (listasCache = PRECIOS.delLocal(c)); }) : sb.from('listas_precios').select('id,nombre,porcentaje,predeterminada').eq('empresa_id', APP.empresa.id).eq('activa', true).order('orden').then(r => (listasCache = r.data || [])))]);
    if (error || !d) { toast(error ? mensajeError(error) : 'No se encontró la prenda', 'error'); return; }
    const v = d.variante, pr = d.producto, admin = APP.esAdmin, puede = APP.rol !== 'visor';
    const actual = Math.round(+v.stock || 0);
    const precioBase = +(v.precio != null ? v.precio : pr.precio) || 0;
    // estado editable
    let nuevo = actual, motivo = null;
    const unidades = (d.fallas || []).map(f => ({ id: f.id, nota: f.nota || '', descuento_pct: f.descuento_pct == null ? '' : +f.descuento_pct, precio: f.precio == null ? '' : +f.precio, modo: f.precio != null ? 'precio' : 'pct', listas: f.listas || null, creado: f.creado }));
    const cerrar = [];   // {id, estado}
    const nom = [v.talle_nombre, v.color_nombre].filter(Boolean).join(' · ') || 'Único';
    const m = modal('<div id="pr"></div>');
    $('.modal', m).style.maxWidth = '620px';

    // el precio de cada lista sale de las reglas (shared/precios.js); la falla descuenta sobre eso, como en la caja
    const enLista = l => pctxCache ? PRECIOS.calcular({ id: v.id, producto_id: pr.id, precio: precioBase }, l.id, pctxCache, { categoria_id: pr.categoria_id, tipo: pr.tipo }).precio : Math.round(precioBase * (+l.porcentaje || 100) / 100);
    const lBase0 = () => listas.find(l => l.predeterminada) || listas[0];
    const tieneDesc = u => u.modo === 'precio' ? u.precio !== '' && +u.precio >= 0 : +u.descuento_pct > 0;
    // con precio: ese precio a precio de lista; en las otras listas, la misma proporción (como cualquier prenda)
    const precioCon = (u, l) => u.modo === 'precio' && u.precio !== '' ? (pctxCache ? PRECIOS.calcular({ id: v.id, producto_id: pr.id, precio: +u.precio }, l.id, pctxCache, { categoria_id: pr.categoria_id, tipo: pr.tipo, sinRebajas: true, sinFijo: true }).precio : Math.round(+u.precio * (+l.porcentaje || 100) / 100)) : Math.round(enLista(l) * (1 - (+u.descuento_pct || 0) / 100));
    const pintarUnidad = (u, i) => {
      const ls = u.listas && u.listas.length ? listas.filter(l => u.listas.includes(l.id)) : listas;
      const lBase = listas.find(l => l.predeterminada) || listas[0];
      return `<div class="pr-unidad${u.id ? '' : ' nueva'}" data-u="${i}">
        <div class="pr-u-fila"><span class="num">◆${i + 1}</span><input class="pr-in" data-k="nota" value="${esc(u.nota)}" placeholder="Qué falla tiene (ej. descosido en el bretel)" ${puede ? '' : 'disabled'}>
          ${admin ? `<label class="pr-desc" title="Descuento o precio para esta prenda">${u.modo === 'precio' ? `<input data-k="precio" inputmode="decimal" value="${u.precio === '' ? '' : esc(u.precio)}" placeholder="Precio">` : `<input data-k="descuento_pct" inputmode="decimal" value="${u.descuento_pct === '' ? '' : esc(u.descuento_pct)}" placeholder="0">`}<select data-modo="${i}" title="Descuento en % o un precio"><option value="pct"${u.modo !== 'precio' ? ' selected' : ''}>% off</option><option value="precio"${u.modo === 'precio' ? ' selected' : ''}>$ precio</option></select></label>` : (u.modo === 'precio' && u.precio !== '' ? `<span class="pr-u-precio">a ${fmt.pesos(u.precio)}</span>` : +u.descuento_pct ? `<span class="pr-u-precio">${fmt.dec(u.descuento_pct)}% off</span>` : '')}
          ${puede ? `<div class="pr-u-acc"><button type="button" data-arreglada="${i}" title="Se arregló: vuelve a ser una prenda normal">Arreglada</button></div>` : ''}</div>
        <div class="pr-u-extra">${extraUnidad(u, i)}</div>
      </div>`;
    };
    function extraUnidad(u, i) {
      if (!tieneDesc(u)) return '';
      const ls = u.listas && u.listas.length ? listas.filter(l => u.listas.includes(l.id)) : listas, lBase = listas.find(l => l.predeterminada) || listas[0];
      return `${admin ? `<div class="pr-u-listas">Se aplica en: <button type="button" class="pr-chip${!u.listas || !u.listas.length ? ' on' : ''}" data-todas="${i}">Todas</button>${listas.map(l => `<button type="button" class="pr-chip${u.listas && u.listas.includes(l.id) ? ' on' : ''}" data-lista="${i}:${l.id}">${esc(l.nombre)}</button>`).join('')}</div>` : ''}
        <div class="pr-u-precio">Se vende a ${ls.map(l => `<b>${fmt.pesos(precioCon(u, l))}</b> en ${esc(l.nombre)}`).join(' · ')}${lBase ? ` <span style="color:var(--tinta-3)">(normal ${fmt.pesos(enLista(lBase) || Math.round(precioBase * (+lBase.porcentaje || 100) / 100))})</span>` : ''}</div>`;
    }
    // cambia una falla sin redibujar la ventana (no se pierde lo que se está escribiendo)
    function refrescarUnidad(i) {
      const el = $(`.pr-unidad[data-u="${i}"] .pr-u-extra`, m); if (!el) return;
      el.innerHTML = extraUnidad(unidades[i], i);
      $$('[data-todas]', el).forEach(b => b.onclick = () => { unidades[+b.dataset.todas].listas = null; refrescarUnidad(i); });
      $$('[data-lista]', el).forEach(b => b.onclick = () => { const [k, lid] = b.dataset.lista.split(':'), u = unidades[+k]; let ls = u.listas ? u.listas.slice() : []; ls = ls.includes(lid) ? ls.filter(x => x !== lid) : ls.concat(lid); u.listas = ls.length && ls.length < listas.length ? ls : null; refrescarUnidad(i); });
    }
    // el stock cambia sin redibujar: solo la diferencia, el motivo y los textos
    function refrescarStock() {
      const dif = nuevo - actual, porDep = d.por_deposito || [];
      $('.pr-stock', m).classList.toggle('cambio', !!dif);
      $('.pr-stock .pr-et', m).innerHTML = `Stock ${dif ? `<b>(${dif > 0 ? '+' : ''}${fmt.num(dif)})</b>` : ''}`;
      $('.pr-stock small', m).innerHTML = `${porDep.length > 1 ? porDep.map(x => esc(x.nombre) + ' ' + fmt.num(x.cantidad)).join(' · ') : 'en el local'}${unidades.length ? ` · ${fmt.num(Math.max(0, nuevo - unidades.length))} sin falla y ${fmt.num(unidades.length)} con falla` : ''}`;
      $('#pr-motivo', m).hidden = !dif;
      const mf = $('#pr-mas-falla', m); if (mf) { mf.disabled = unidades.length >= nuevo; mf.title = mf.disabled ? 'No puede haber más con falla que stock' : ''; }
    }
    const pintar = () => {
      const dif = nuevo - actual, porDep = d.por_deposito || [];
      $('#pr', m).innerHTML = `<div class="pr-cab">${v.foto ? `<img class="pr-foto" src="${esc(v.foto)}" alt="">` : `<span class="pr-foto sf">${esc(APP.iniciales(pr.nombre.replace(/[«»\[\]]/g, '')))}</span>`}
          <div style="min-width:0"><h2>${esc(pr.nombre)}</h2><p class="sub">${esc(nom)} · ${esc(v.sku || '')}${v.ean ? ' · ' + esc(v.ean) : ''}${op.desdeFicha ? '' : ` · <a href="${raiz}catalogo/producto.html?id=${pr.id}">ver la ficha</a>`}</p></div></div>
        ${(d.revisar || []).length ? `<div class="pr-aviso"><span>⚠ ${(d.revisar || []).map(r => esc(r.detalle || (r.motivo === 'falla' ? 'Se vendió sin marcar la falla' : 'Se vendió sin stock en el sistema'))).join('<br>')}<br><small>Contá cuántas hay y corregí el stock.</small></span>${puede ? '<label><input type="checkbox" id="pr-visto" checked> Ya lo revisé</label>' : ''}</div>` : ''}
        ${v.chequear ? `<div class="pr-aviso azul"><span>🔎 ${esc(v.chequear)}</span>${admin ? '<label><input type="checkbox" id="pr-chequeado"> Ya está chequeado</label>' : ''}</div>` : ''}
        <div class="pr-stock${dif ? ' cambio' : ''}">
          <div class="pr-paso"><button type="button" data-paso="-1" ${puede ? '' : 'disabled'}>−</button><input id="pr-stock" type="number" inputmode="numeric" value="${nuevo}" ${puede ? '' : 'disabled'}><button type="button" data-paso="1" ${puede ? '' : 'disabled'}>+</button></div>
          <div><span class="pr-et">Stock ${dif ? `<b>(${dif > 0 ? '+' : ''}${fmt.num(dif)})</b>` : ''}</span><small>${porDep.length > 1 ? porDep.map(x => esc(x.nombre) + ' ' + fmt.num(x.cantidad)).join(' · ') : 'en el local'}${unidades.length ? ` · ${fmt.num(Math.max(0, nuevo - unidades.length))} sin falla y ${fmt.num(unidades.length)} con falla` : ''}</small></div>
        </div>
        <div class="pr-motivo" id="pr-motivo" ${dif ? '' : 'hidden'}><span class="pr-et">¿Por qué cambia?</span><div class="pr-chips">${MOTIVOS.map(x => `<button type="button" class="pr-chip${motivo === x ? ' on' : ''}" data-mo="${esc(x)}">${esc(x)}</button>`).join('')}</div>
          <input class="pr-in" id="pr-nota" placeholder="Nota (opcional)"></div>
        <div class="pr-fallas"><div class="pr-fallas-cab"><h3>◆ Con falla ${unidades.length ? `<span>${fmt.num(unidades.length)}</span>` : ''}</h3>${puede ? `<button type="button" class="btn chico" id="pr-mas-falla" ${unidades.length >= nuevo ? 'disabled title="No puede haber más con falla que stock"' : ''}>+ Marcar una con falla</button>` : ''}</div>
          ${unidades.length ? unidades.map(pintarUnidad).join('') : '<p class="sub" style="margin:0">Ninguna. Si una tiene un detalle, marcala: se sigue vendiendo en el local (con su descuento si querés) y no se ofrece en la web.</p>'}</div>
        <details class="pr-mas"${op.abrirMas ? ' open' : ''}><summary>Código de barras, precio de este talle, etiquetas y movimientos</summary>
          <div class="fila c2" style="margin-top:10px">
            <div class="campo"><label>Código de barras</label><input id="pr-ean" value="${esc(v.ean || '')}" ${admin ? '' : 'disabled'}></div>
            <div class="campo"><label>Precio distinto para ${esc(nom)}</label><input id="pr-precio" type="text" inputmode="decimal" value="${v.precio != null && +v.precio !== +pr.precio ? +v.precio : ''}" placeholder="Vacío = ${fmt.pesos(pr.precio)}, como el resto" ${admin ? '' : 'disabled'}><span class="ayuda">Solo si este talle o color vale distinto (ej. el XXL más caro). Vacío: usa el precio del producto.</span></div>
          </div>
          ${porDep.length > 1 && puede ? `<div class="campo"><label>Depósito donde se ajusta</label><select id="pr-dep">${porDep.map(x => `<option value="${x.id}" ${x.principal ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select></div>` : ''}
          <div style="display:flex;gap:8px;align-items:flex-end"><div class="campo" style="margin:0;width:130px"><label>Etiquetas</label><input id="pr-etq" type="number" min="1" value="${Math.max(1, actual)}"></div><button type="button" class="btn" id="pr-etq-b">Agregar a etiquetas</button></div>
          <div class="pr-movs">${(d.movimientos || []).map(x => `<div><span>${fmt.fechaHora(x.fecha)}</span><span style="font-family:var(--f-ui);color:var(--tinta-2)">${x.venta_numero ? 'Venta #' + String(x.venta_numero).padStart(6, '0') : esc(TIPOS[x.tipo] || x.tipo)}${x.motivo && x.motivo !== x.tipo ? ' · ' + esc(x.motivo) : ''}${x.usuario ? ' · ' + esc(x.usuario) : ''}</span><b class="${x.cantidad > 0 ? 'pos' : 'neg'}">${x.cantidad > 0 ? '+' : ''}${fmt.num(x.cantidad)}</b></div>`).join('') || '<p class="sub">Sin movimientos.</p>'}
            <p style="margin:8px 0 0"><a href="${raiz}catalogo/inventario.html?q=${encodeURIComponent(pr.codigo)}#movimientos" style="font:600 12px var(--f-ui);color:var(--acento)">Ver todos los movimientos →</a></p></div>
        </details>
        <div class="pie"><button class="btn" data-cerrar>Cerrar</button>${puede ? '<button class="btn primario" data-guardar>Guardar</button>' : ''}</div>`;
      enganchar();
    };
    const leerUnidades = () => $$('.pr-unidad', m).forEach(el => { const u = unidades[+el.dataset.u]; $$('[data-k]', el).forEach(inp => { const k = inp.dataset.k, t = inp.value.trim(); u[k] = k === 'descuento_pct' ? (t === '' ? '' : Math.min(100, Math.max(0, +t.replace(',', '.') || 0))) : k === 'precio' ? (t === '' ? '' : Math.max(0, Math.round(+t.replace(/\./g, '').replace(',', '.') || 0))) : inp.value; }); });
    const repintar = () => { const nota = ($('#pr-nota', m) || {}).value || ''; const abierto = $('.pr-mas', m) && $('.pr-mas', m).open; pintar(); if ($('#pr-nota', m)) $('#pr-nota', m).value = nota; if (abierto) $('.pr-mas', m).open = true; };
    function enganchar() {
      const iS = $('#pr-stock', m);
      $$('[data-paso]', m).forEach(b => b.onclick = () => { nuevo = Math.round(+iS.value || 0) + +b.dataset.paso; iS.value = nuevo; refrescarStock(); });
      iS.oninput = () => { nuevo = Math.round(+iS.value || 0); refrescarStock(); };
      $$('[data-mo]', m).forEach(b => b.onclick = () => { motivo = b.dataset.mo; $$('[data-mo]', m).forEach(x => x.classList.toggle('on', x === b)); });
      const mf = $('#pr-mas-falla', m); if (mf) mf.onclick = () => { leerUnidades(); unidades.push({ id: null, nota: '', descuento_pct: '', listas: null }); repintar(); const ult = $$('.pr-unidad [data-k="nota"]', m).pop(); if (ult) ult.focus(); };
      $$('[data-arreglada]', m).forEach(b => b.onclick = () => { leerUnidades(); const u = unidades.splice(+b.dataset.arreglada, 1)[0]; if (u.id) cerrar.push({ id: u.id, estado: 'arreglada' }); repintar(); });
      $$('[data-k="descuento_pct"], [data-k="precio"]', m).forEach(inp => inp.oninput = () => { const i = +inp.closest('.pr-unidad').dataset.u; leerUnidades(); refrescarUnidad(i); });
      $$('[data-modo]', m).forEach(sel => sel.onchange = () => { leerUnidades(); const u = unidades[+sel.dataset.modo]; u.modo = sel.value; if (u.modo === 'precio') u.descuento_pct = ''; else u.precio = ''; repintar(); const inp = $(`.pr-unidad[data-u="${sel.dataset.modo}"] .pr-desc input`, m); if (inp) inp.focus(); });
      unidades.forEach((_, i) => refrescarUnidad(i));
      $('#pr-etq-b', m).onclick = () => { agregarEtiquetas([{ variante_id: v.id, cantidad: +$('#pr-etq', m).value || 1 }]); toast('Agregado a la cola de etiquetas'); };
      $('[data-cerrar]', m).onclick = () => m.cerrar();
      const g = $('[data-guardar]', m); if (g) g.onclick = guardar;
    }
    async function guardar() {
      leerUnidades();
      const g = $('[data-guardar]', m), dif = nuevo - actual;
      if (dif && !motivo) { toast('Elegí por qué cambia el stock', 'error'); $('#pr-motivo', m).scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
      if (nuevo < 0) { toast('El stock no puede quedar negativo', 'error'); return; }
      if (unidades.length > nuevo) { toast(`Marcaste ${unidades.length} con falla y el stock queda en ${nuevo}`, 'error'); return; }
      g.disabled = true; g.textContent = 'Guardando…';
      try {
        if (dif) { const dep = $('#pr-dep', m); const r = await sb.rpc('stock_ajustar', { p: { variante_id: v.id, modo: 'fijar', cantidad: nuevo, motivo, nota: ($('#pr-nota', m).value || '').trim(), deposito_id: dep ? dep.value : null } }); if (r.error) throw r.error; }
        const orig = d.fallas || [];
        const cambiadas = unidades.filter(u => !u.id || (() => { const o = orig.find(x => x.id === u.id); return !o || (o.nota || '') !== u.nota || String(o.descuento_pct ?? '') !== String(u.descuento_pct) || String(o.precio ?? '') !== String(u.precio) || JSON.stringify(o.listas || null) !== JSON.stringify(u.listas || null); })());
        if (cambiadas.length || cerrar.length) { const r = await sb.rpc('fallas_guardar', { p: { variante_id: v.id, unidades: cambiadas.map(u => ({ id: u.id, nota: u.nota, descuento_pct: u.modo === 'precio' || u.descuento_pct === '' ? null : u.descuento_pct, precio: u.modo === 'precio' && u.precio !== '' ? u.precio : null, listas: u.listas })), cerrar } }); if (r.error) throw r.error; }
        if (admin) {
          const ean = $('#pr-ean', m).value.trim() || null, pv = $('#pr-precio', m).value.trim(), precio = pv === '' ? null : (window.PRECIOS ? PRECIOS.num(pv) : +pv.replace(/\./g, '').replace(',', '.')), ch = $('#pr-chequeado', m), cambios = {};
          if (ean !== (v.ean || null)) cambios.ean = ean;
          if (precio !== (v.precio != null && +v.precio !== +pr.precio ? +v.precio : null)) cambios.precio = precio;
          if (ch && ch.checked) cambios.chequear = null;
          if (Object.keys(cambios).length) { const r = await sb.from('variantes').update(cambios).eq('id', v.id); if (r.error) throw r.error; }
        }
        const visto = $('#pr-visto', m); if (visto && visto.checked) { const r = await sb.rpc('stock_revisar_visto', { p_variante: v.id, p_nota: dif ? `Corregido: ${actual} → ${nuevo}` : 'Revisado' }); if (r.error) throw r.error; }
      } catch (err) { toast(mensajeError(err), 'error'); g.disabled = false; g.textContent = 'Guardar'; return; }
      m.cerrar(); empujarStock(); toast(dif ? `Stock: ${fmt.num(actual)} → ${fmt.num(nuevo)}` : 'Guardado');
      if (op.alGuardar) op.alGuardar();
    }
    pintar();
    setTimeout(() => { const i = $('#pr-stock', m); if (i && puede) { i.focus(); i.select(); } }, 40);
  }
  window.PRENDA = { abrir, agregarEtiquetas };
})();
