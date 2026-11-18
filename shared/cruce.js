/* Percha · Ventana para elegir el talle·color de Percha al que se conecta una opción del canal.
   La MISMA en «Cruce de productos» y en «Revisión de la web» (17/11/2026).
   Uso: const r = await CRUCE.elegir({ titulo, sub, q, productoId, quitar: true })
        → { variante } elegida · 'quitar' · null (cancelado). CRUCE.olvidar() vuelve a leer las variantes. */
(function () {
  let cache = null;
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  async function variantes() {
    if (cache) return cache;
    let d = 0, t = [];
    while (true) {
      const { data } = await sb.from('v_variantes').select('id,producto_id,producto_nombre,producto_codigo,sku,talle_nombre,color_nombre,stock,activa').eq('empresa_id', APP.empresa.id).order('producto_nombre').order('talle_orden').order('id').range(d, d + 999);
      t = t.concat(data || []); if (!data || data.length < 1000) break; d += 1000;
    }
    return (cache = t);
  }
  function elegir({ titulo = 'Conectar con una prenda del local', sub = '', q = '', productoId = null, quitar = false } = {}) {
    const { esc, $, $$, modal, fmt, confirmar } = APP;
    return new Promise(async res => {
      const todas = await variantes();
      const m = modal(`<h2>${esc(titulo)}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}
        <div class="campo" style="margin-top:12px"><label>Buscar en el local (nombre, código, SKU, talle o color)</label><input id="cz-q" value="${esc(q)}" autocomplete="off"></div>
        <label style="display:flex;gap:6px;align-items:center;font-size:13px;margin:8px 0 0">${productoId ? `<input type="checkbox" id="cz-prod" checked> Solo esta prenda &nbsp;&nbsp;` : ''}<input type="checkbox" id="cz-apag"> Incluir talles·colores apagados</label>
        <div id="cz-res" style="max-height:340px;overflow:auto;margin-top:10px;border:1px solid var(--linea);border-radius:10px"></div>
        <div class="pie">${quitar ? '<button class="btn" data-quitar style="margin-right:auto">Desconectar</button>' : ''}<button class="btn" data-no>Cancelar</button></div>`);
      m.alCerrar = () => res(null);
      const pintar = () => {
        const pal = norm($('#cz-q', m).value.trim()).split(/\s+/).filter(Boolean), soloProd = productoId && $('#cz-prod', m) && $('#cz-prod', m).checked, apag = $('#cz-apag', m).checked;
        const lista = todas.filter(v => (apag || v.activa) && (!soloProd || v.producto_id === productoId) && pal.every(w => norm(`${v.producto_nombre} ${v.producto_codigo} ${v.sku} ${v.talle_nombre} ${v.color_nombre}`).includes(w))).slice(0, 80);
        $('#cz-res', m).innerHTML = lista.map(v => `<div data-v="${v.id}" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--linea);font-size:13px"><b>${esc(v.producto_nombre)}</b> · ${esc([v.talle_nombre, v.color_nombre].filter(Boolean).join(' · ') || 'sin talle ni color')}${v.activa ? '' : ' <span class="chip gris">apagado</span>'}<br><small style="font-family:var(--f-mono);color:var(--tinta-3)">${esc(v.producto_codigo)} · ${esc(v.sku || '')} · stock ${fmt.num(v.stock)}</small></div>`).join('') || '<div class="vacio" style="padding:14px">Nada. Probá con otra palabra, o destildá «Solo esta prenda».</div>';
        $$('[data-v]', $('#cz-res', m)).forEach(d => { d.onmouseenter = () => d.style.background = 'var(--lila)'; d.onmouseleave = () => d.style.background = ''; d.onclick = () => { m.cerrar(); res({ variante: todas.find(v => v.id === d.dataset.v) }); }; });
      };
      $('#cz-q', m).addEventListener('input', pintar); $('#cz-apag', m).onchange = pintar; if ($('#cz-prod', m)) $('#cz-prod', m).onchange = pintar;
      $('[data-no]', m).onclick = () => { m.cerrar(); res(null); };
      const qt = $('[data-quitar]', m); if (qt) qt.onclick = async () => { if (!await confirmar('¿Desconectar? Esa opción del canal deja de recibir el stock del local.', 'Desconectar')) return; m.cerrar(); res('quitar'); };
      pintar(); $('#cz-q', m).focus(); $('#cz-q', m).select();
    });
  }
  // conectar / desconectar una opción del canal (canal_items.id). Desconectar queda «manual» sin talle·color: si no, la
  // sincronización la vuelve a conectar sola por el código (pasó con JAZMÍN, 18/11)
  async function conectar(itemId, varianteId) {
    const r = await sb.from('canal_items').update(varianteId ? { variante_id: varianteId, cruce: 'manual' } : { variante_id: null, cruce: 'manual' }).eq('id', itemId);
    if (r.error) { APP.toast(APP.mensajeError(r.error), 'error'); return false; }
    return true;
  }
  window.CRUCE = { elegir, conectar, variantes, olvidar: () => { cache = null; } };
})();
