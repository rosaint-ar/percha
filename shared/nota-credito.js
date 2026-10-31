/* Percha · Nota de crédito: el comprobante que se le da a la clienta (80 mm), distinto de un ticket de venta.
   Código grande, saldo a favor, de qué cambio salió y cuánto vale según con qué pague (la NC recuerda su lista:
   una de Contado vale más pagando con tarjeta). Lo usan la caja (al emitirla) y Ventas (ver y reimprimir). */
(function () {
  const h = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const pesos = n => window.fmt ? fmt.pesos(n) : '$ ' + Math.round(n).toLocaleString('es-AR');
  const listaDe = f => (f.listas && f.listas.length ? f.listas[0] : f.lista_id) || null;
  const PALABRA = { efectivo: 'efectivo', transferencia: 'transferencia', debito: 'débito', credito: 'tarjeta', mercadopago: 'Mercado Pago' };
  // con qué se paga a precio de esa lista, en palabras de la clienta: "efectivo o transferencia", "débito", "tarjeta o Mercado Pago"
  function medios(listaId, formas) {
    const ws = [...new Set((formas || []).filter(f => listaDe(f) === listaId).map(f => PALABRA[f.tipo]).filter(Boolean))];
    return ws.length > 1 ? ws.slice(0, -1).join(', ') + ' o ' + ws[ws.length - 1] : ws[0] || '';
  }
  // cuánto vale el saldo pagando con cada medio: [{ texto, valor }], primero el de su propia lista
  function valores(nc, listas, formas) {
    const saldo = nc.saldo != null ? +nc.saldo : +nc.monto, pct = id => +((listas || []).find(l => l.id === id) || {}).porcentaje || 100;
    if (!nc.lista_id) return [{ texto: '', valor: saldo }];
    const ids = [...new Set((formas || []).map(listaDe).filter(Boolean))].filter(id => id !== nc.lista_id && (listas || []).some(l => l.id === id));
    return [{ texto: medios(nc.lista_id, formas), valor: saldo }]
      .concat(ids.map(id => ({ texto: medios(id, formas), valor: Math.round(saldo * pct(id) / pct(nc.lista_id)) })).filter(x => x.texto).sort((a, b) => a.valor - b.valor));
  }
  const css = `.nc .nc-tit{font:800 17px var(--f-ui,sans-serif);letter-spacing:.12em;text-align:center;border:2px solid #000;padding:5px 0;margin:8px 0 6px}
    .nc .nc-cod{font:800 24px var(--f-mono,monospace);letter-spacing:.18em;text-align:center;border:1.5px dashed #000;padding:6px 0 4px;margin:0 4mm}
    .nc .nc-cod small{display:block;font:500 10px var(--f-ui,sans-serif);letter-spacing:0;margin-top:2px}
    .nc .nc-sec{font-weight:700;font-size:11px;letter-spacing:.06em;margin:6px 0 2px}
    .nc .nc-monto{display:flex;justify-content:space-between;align-items:baseline;border-top:2px solid #000;border-bottom:2px solid #000;padding:6px 0;margin:8px 0 6px;font-weight:800}
    .nc .nc-monto b{font-size:20px}
    .nc .nc-vale{margin:2px 0}.nc .nc-chico{font-size:10.5px}
    .nc-vista{background:#fff;color:#000;width:76mm;max-width:100%;margin:10px auto 4px;padding:4mm;font:12px/1.35 var(--f-mono,monospace);box-shadow:0 1px 3px rgba(0,0,0,.12),0 8px 24px rgba(0,0,0,.08);border-radius:4px}
    .nc-vista h2{font:700 15px var(--f-ui,sans-serif);margin:0 0 2px}.nc-vista .c{text-align:center}.nc-vista .r{text-align:right}
    .nc-vista table{width:100%;border-collapse:collapse}.nc-vista td{padding:2px 0;vertical-align:top}.nc-vista hr{border:0;border-top:1px dashed #000;margin:6px 0}`;
  function estilos() { if (document.getElementById('nc-css')) return; const s = document.createElement('style'); s.id = 'nc-css'; s.textContent = css; document.head.appendChild(s); }
  /* nc: { codigo, tipo, monto, saldo, creado, vence, lista_id, estado }
     o:  { empresa, listas, formas, clienta, ticket (número del cambio), origen (número del ticket original), devuelve: [lineas], lleva: [lineas], reimpresion } */
  function html(nc, o) {
    estilos(); o = o || {};
    const emp = o.empresa || {}, gift = nc.tipo === 'gift_card', saldo = nc.saldo != null ? +nc.saldo : +nc.monto, vs = valores(nc, o.listas, o.formas);
    const num = n => n ? '#' + String(n).padStart(6, '0') : '';
    const fila = l => `<tr><td>${Math.abs(l.cantidad)}× ${h(l.descripcion)}<br><small>${h([l.talle, l.color].filter(Boolean).join(' · '))}</small></td><td class="r">${pesos(Math.abs(l.total))}</td></tr>`;
    const fecha = new Date(nc.creado || Date.now()).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `<div class="nc">${emp.logo_url ? `<div class="c"><img src="${h(emp.logo_url)}" alt="" style="max-width:42mm;max-height:20mm;margin:0 auto 4px;display:block"></div>` : ''}<h2 class="c">${h(emp.nombre)}</h2>
      <div class="c">${h([emp.domicilio, emp.localidad].filter(Boolean).join(' · '))}${emp.telefono ? '<br>' + h(emp.telefono) : ''}</div>
      <div class="nc-tit">${gift ? 'GIFT CARD' : 'NOTA DE CRÉDITO'}</div>
      <div class="nc-cod">${h(nc.codigo)}<small>código para usarla</small></div>
      <table style="margin-top:8px"><tr><td>Fecha</td><td class="r">${fecha}${o.reimpresion ? ' (copia)' : ''}</td></tr>${o.clienta ? `<tr><td>Clienta</td><td class="r">${h(o.clienta)}</td></tr>` : ''}${o.ticket || o.origen ? `<tr><td>Por</td><td class="r">${o.origen ? 'cambio del ticket ' + num(o.origen) : 'devolución'}${o.ticket ? '<br><small>comprobante ' + num(o.ticket) + '</small>' : ''}</td></tr>` : ''}</table>
      ${(o.devuelve || []).length ? `<hr><div class="nc-sec">DEVOLVIÓ</div><table>${o.devuelve.map(fila).join('')}</table>` : ''}
      ${(o.lleva || []).length ? `<div class="nc-sec">SE LLEVÓ</div><table>${o.lleva.map(fila).join('')}</table>` : ''}
      <div class="nc-monto"><span>SALDO A FAVOR</span><b>${pesos(saldo)}</b></div>
      ${saldo < +nc.monto ? `<div class="nc-chico">Monto original ${pesos(nc.monto)} · ya usado ${pesos(+nc.monto - saldo)}</div>` : ''}
      ${vs[0].texto ? `<div class="nc-vale">Vale <b>${pesos(vs[0].valor)}</b> pagando con ${h(vs[0].texto)}.</div>${vs.length > 1 ? `<div class="nc-vale nc-chico">${vs.slice(1).map(x => `Con ${h(x.texto)}: <b>${pesos(x.valor)}</b>`).join(' · ')}</div>` : ''}` : ''}
      <div class="nc-vale nc-chico">${nc.vence ? 'Vence el ' + new Date(nc.vence + 'T12:00').toLocaleDateString('es-AR') : 'Sin vencimiento'}${nc.estado && nc.estado !== 'vigente' ? ' · <b>' + h(nc.estado.toUpperCase()) + '</b>' : ''}</div>
      <hr><div class="c nc-chico">Presentá este código en tu próxima compra.<br>Se puede usar en partes.<br>Documento no válido como factura.</div></div>`;
  }
  // texto para mandar por WhatsApp
  function texto(nc, o) {
    const vs = valores(nc, (o || {}).listas, (o || {}).formas), emp = ((o || {}).empresa || {}).nombre || '';
    return `${emp} · *Nota de crédito ${nc.codigo}*\nSaldo a favor: ${pesos(nc.saldo != null ? nc.saldo : nc.monto)}` + (vs[0].texto ? `\nVale ${pesos(vs[0].valor)} pagando con ${vs[0].texto}` + vs.slice(1).map(x => `\nCon ${x.texto}: ${pesos(x.valor)}`).join('') : '') + '\nPresentá este código en tu próxima compra.';
  }
  window.NOTA_CREDITO = { html, texto, valores, medios };
})();
