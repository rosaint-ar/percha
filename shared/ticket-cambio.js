/* Percha · Ticket de cambio (para regalo): el número de la venta y las prendas, SIN precios, con hasta cuándo se puede cambiar.
   Quien recibe el regalo lo trae, se busca la venta por ese número y el cambio sigue la regla de siempre (vale lo que se pagó).
   Al tocarlo se eligen qué prendas van de regalo y si sale un ticket por prenda (regalos para personas distintas).
   Lo usan la caja (después de cobrar) y Ventas (al abrir un ticket). */
(function () {
  const h = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const css = `.tc .tc-tit{font:800 16px var(--f-ui,sans-serif);letter-spacing:.12em;text-align:center;border:2px solid #000;padding:5px 0;margin:8px 0 6px}
    .tc .tc-num{font:800 22px var(--f-mono,monospace);letter-spacing:.08em;text-align:center;margin:4px 0 0}
    .tc .tc-chico{font-size:10.5px}.tc .tc-corte{border:0;border-top:1px dashed #000;margin:14px 0;text-align:center}
    .tc .tc-vale{border-top:2px solid #000;border-bottom:2px solid #000;padding:6px 0;margin:8px 0 6px;text-align:center;font-weight:700}`;
  function estilos() { if (document.getElementById('tc-css')) return; const s = document.createElement('style'); s.id = 'tc-css'; s.textContent = css; document.head.appendChild(s); }
  const dd = d => d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  // o: { empresa, numero ('#000072'), fecha, lineas: [{ cantidad, descripcion, talle, color }], dias }
  function uno(o, ls) {
    const emp = o.empresa || {}, f = new Date(o.fecha || Date.now()), hasta = new Date(f.getTime() + (o.dias || 30) * 864e5);
    return `<div class="tc">${emp.logo_url ? `<div class="c"><img src="${h(emp.logo_url)}" alt="" style="max-width:42mm;max-height:20mm;margin:0 auto 4px;display:block"></div>` : ''}<h2 class="c">${h(emp.nombre)}</h2>
      <div class="c">${h([emp.domicilio, emp.localidad].filter(Boolean).join(' · '))}${emp.telefono ? '<br>' + h(emp.telefono) : ''}</div>
      <div class="tc-tit">TICKET DE CAMBIO</div>
      <div class="c tc-chico">Ticket</div><div class="tc-num">${h(o.numero)}</div><div class="c tc-chico">compra del ${dd(f)}</div><hr>
      <table>${ls.map(l => `<tr><td>${Math.abs(l.cantidad)}× ${h(l.descripcion)}<br><small>${h([l.talle, l.color].filter(Boolean).join(' · '))}</small></td></tr>`).join('')}</table>
      <div class="tc-vale">Se puede cambiar hasta el ${dd(hasta)}</div>
      <div class="c tc-chico">Presentá este ticket en el local.<br>Es un regalo: no muestra precios.</div></div>`;
  }
  function html(o, porPrenda) { estilos(); return porPrenda ? o.lineas.map(l => uno(o, [l])).join('<div class="tc"><div class="tc-corte">✂</div></div>') : uno(o, o.lineas); }
  // solo prendas (sin el envío ni lo devuelto)
  const prendas = ls => (ls || []).filter(l => +l.cantidad > 0 && l.variante_id && !/^Env[ií]o\b/i.test(l.descripcion || '') && !/^GIFT CARD/i.test(l.descripcion || ''));
  // ventanita: qué va de regalo · uno por prenda · imprimir
  function elegir(o) {
    const { modal, $, $$, toast } = APP, ls = prendas(o.lineas);
    if (!ls.length) { toast('Esta venta no tiene prendas para regalo', 'error'); return; }
    const m = modal(`<h2>🎁 Ticket de cambio</h2><p class="sub">Para regalo: sale con el número de ticket y las prendas, <b>sin precios</b>. Quien lo recibe lo trae para cambiar.</p>
      <div style="margin-top:10px">${ls.map((l, i) => `<label style="display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid var(--linea-suave);cursor:pointer"><input type="checkbox" data-i="${i}" checked style="width:18px;height:18px"><span>${Math.abs(l.cantidad)}× <b>${h(l.descripcion)}</b> <small class="sub">${h([l.talle, l.color].filter(Boolean).join(' · '))}</small></span></label>`).join('')}</div>
      ${ls.length > 1 ? '<label style="display:flex;gap:10px;align-items:center;margin-top:12px;cursor:pointer"><input type="checkbox" id="tc-uno" style="width:18px;height:18px"><span>Un ticket por cada prenda <small class="sub">(regalos para personas distintas)</small></span></label>' : ''}
      <div class="pie"><button class="btn" data-no>Cancelar</button><button class="btn primario" data-si>Imprimir</button></div>`);
    $('[data-no]', m).onclick = () => m.cerrar();
    $('[data-si]', m).onclick = () => {
      const sel = $$('[data-i]', m).filter(c => c.checked).map(c => ls[+c.dataset.i]);
      if (!sel.length) { toast('Marcá al menos una prenda', 'error'); return; }
      const uno_ = $('#tc-uno', m), dest = document.getElementById('impresion'), antes = dest.innerHTML;
      dest.innerHTML = html(Object.assign({}, o, { lineas: sel }), uno_ && uno_.checked);
      m.cerrar(); window.print();
      setTimeout(() => { dest.innerHTML = antes; }, 1000);   // el ticket de la venta vuelve a quedar listo para imprimir
    };
  }
  window.TICKET_CAMBIO = { html, elegir, prendas };
})();
