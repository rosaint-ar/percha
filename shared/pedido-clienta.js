/* Percha · Lo que piden y no hay: la ventanita para anotar un pedido de una clienta (desde la caja o desde "Lo que piden").
   Se busca la prenda en el catálogo (y, si se sabe, el talle y el color) o se escribe lo que pidió si no la tenemos.
   PEDIDO_CLIENTA.anotar({ texto, alGuardar }) → abre la ventanita (texto = lo que se buscó en la caja). */
(function () {
  function anotar(op) {
    op = op || {};
    const { modal, $, $$, esc, toast, mensajeError } = APP, e = APP.empresa.id;
    let prod = null, vars = [], vSel = null, tq = null;
    const m = modal(`<h2>📝 Lo pidieron y no hay</h2><p class="sub">Anotalo así se puede conseguir o reponer, y avisarle a la clienta cuando llegue.</p>
      <div class="campo" style="margin-top:10px"><label>¿Qué pidió?</label><input id="pc-q" value="${esc(op.texto || '')}" placeholder="Buscá la prenda o escribí lo que pidió" autocomplete="off">
        <div id="pc-sug" style="display:flex;flex-direction:column;gap:4px;margin-top:6px"></div><div id="pc-elegido" class="sub" style="margin-top:4px"></div></div>
      <div id="pc-vars" style="display:flex;gap:6px;flex-wrap:wrap;margin:-2px 0 8px"></div>
      <div class="fila c2"><div class="campo"><label>Talle</label><input id="pc-talle" placeholder="Opcional"></div><div class="campo"><label>Color</label><input id="pc-color" placeholder="Opcional"></div></div>
      <div class="fila c2"><div class="campo"><label>Clienta</label><input id="pc-cli" placeholder="Opcional"></div><div class="campo"><label>Teléfono</label><input id="pc-tel" placeholder="Para avisarle cuando llegue" inputmode="tel"></div></div>
      <div class="fila c2"><div class="campo"><label>Cantidad</label><input id="pc-cant" type="number" min="1" value="1"></div><div class="campo"><label>Nota</label><input id="pc-nota" placeholder="Opcional (ej. lo necesita para el sábado)"></div></div>
      <div class="pie"><button class="btn" data-no>Cancelar</button><button class="btn primario" data-si>Anotar</button></div>`);
    const q = $('#pc-q', m), sug = $('#pc-sug', m), eleg = $('#pc-elegido', m), pv = $('#pc-vars', m);
    const pintarElegido = () => {
      eleg.innerHTML = prod ? `✓ Del catálogo: <b>${esc(prod.nombre)}</b> · <a href="#" data-sacar>es otra cosa</a>` : (q.value.trim() ? 'No está en el catálogo: se anota como lo escribiste.' : '');
      const a = $('[data-sacar]', eleg); if (a) a.onclick = ev => { ev.preventDefault(); prod = null; vars = []; vSel = null; pv.innerHTML = ''; pintarElegido(); q.focus(); };
    };
    // talles y colores de esa prenda (con cuántas hay): tocando uno se completa
    const pintarVars = () => {
      pv.innerHTML = vars.filter(v => v.talle_nombre || v.color_nombre).slice(0, 40).map(v => `<button type="button" class="btn chico${vSel === v ? ' primario' : ''}" data-v="${v.id}" title="${+v.stock > 0 ? 'Hay ' + v.stock : 'No hay'}">${esc([v.talle_nombre, v.color_nombre].filter(Boolean).join(' · '))}${+v.stock > 0 ? ' <small>(' + v.stock + ')</small>' : ''}</button>`).join('');
      $$('[data-v]', pv).forEach(b => b.onclick = () => { vSel = vars.find(v => v.id === b.dataset.v); $('#pc-talle', m).value = vSel.talle_nombre || ''; $('#pc-color', m).value = vSel.color_nombre || ''; pintarVars(); });
    };
    const elegir = async p => {
      prod = p; sug.innerHTML = ''; q.value = p.nombre; vSel = null; pintarElegido();
      const { data } = await sb.from('v_variantes').select('id,talle_nombre,color_nombre,stock,talle_orden').eq('producto_id', p.id).eq('activa', true).order('talle_orden');
      vars = data || []; pintarVars();
    };
    const buscar = async () => {
      const t = q.value.trim(); if (prod && t !== prod.nombre) { prod = null; vars = []; vSel = null; pv.innerHTML = ''; }
      pintarElegido(); if (t.length < 2 || prod) { sug.innerHTML = ''; return; }
      const ws = t.split(/\s+/).filter(Boolean); let c = sb.from('productos').select('id,nombre,codigo').eq('empresa_id', e).eq('activo', true).eq('es_generico', false);
      ws.forEach(w => { c = c.ilike('nombre', '%' + w + '%'); });
      const { data } = await c.order('nombre').limit(6);
      sug.innerHTML = (data || []).map(p => `<button type="button" class="btn chico" style="justify-content:flex-start" data-p="${p.id}">${esc(p.nombre)}</button>`).join('');
      $$('[data-p]', sug).forEach(b => b.onclick = () => elegir((data || []).find(p => p.id === b.dataset.p)));
    };
    q.addEventListener('input', () => { clearTimeout(tq); tq = setTimeout(buscar, 250); });
    ['#pc-talle', '#pc-color'].forEach(s => $(s, m).addEventListener('input', () => { vSel = null; pintarVars(); }));
    $('[data-no]', m).onclick = () => m.cerrar();
    $('[data-si]', m).onclick = async () => {
      const desc = (prod ? prod.nombre : q.value.trim()); if (!desc) { toast('Escribí qué pidió', 'error'); q.focus(); return; }
      // talle y color escritos a mano que existen en la prenda: se vinculan solos (así el aviso de "ya hay" es exacto)
      const n_ = s => String(s || '').trim().toLowerCase(), tl = n_($('#pc-talle', m).value), cl = n_($('#pc-color', m).value);
      if (prod && !vSel && (tl || cl)) vSel = vars.find(v => n_(v.talle_nombre) === tl && n_(v.color_nombre) === cl) || null;
      const b = $('[data-si]', m); b.disabled = true;
      const { error } = await sb.from('pedidos_clientas').insert(APP.conEmpresa({ producto_id: prod ? prod.id : null, variante_id: vSel ? vSel.id : null, descripcion: desc,
        talle: $('#pc-talle', m).value.trim() || null, color: $('#pc-color', m).value.trim() || null, cantidad: Math.max(1, parseInt($('#pc-cant', m).value) || 1),
        cliente_nombre: $('#pc-cli', m).value.trim() || null, telefono: $('#pc-tel', m).value.trim() || null, nota: $('#pc-nota', m).value.trim() || null }));
      if (error) { b.disabled = false; toast(mensajeError(error), 'error'); return; }
      m.cerrar(); toast('📝 Anotado: lo ven en "Lo que piden"'); if (op.alGuardar) op.alGuardar();
    };
    buscar(); q.focus();
  }
  window.PEDIDO_CLIENTA = { anotar };
})();
