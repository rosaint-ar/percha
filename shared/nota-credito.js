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
      <hr><div class="c nc-chico">Presentá este código en tu próxima compra.<br>Documento no válido como factura.</div></div>`;
  }
  // texto para mandar por WhatsApp
  function texto(nc, o) {
    const vs = valores(nc, (o || {}).listas, (o || {}).formas), emp = ((o || {}).empresa || {}).nombre || '';
    return `${emp} · *Nota de crédito ${nc.codigo}*\nSaldo a favor: ${pesos(nc.saldo != null ? nc.saldo : nc.monto)}` + (vs[0].texto ? `\nVale ${pesos(vs[0].valor)} pagando con ${vs[0].texto}` + vs.slice(1).map(x => `\nCon ${x.texto}: ${pesos(x.valor)}`).join('') : '') + '\nPresentá este código en tu próxima compra.';
  }
  // ================= La nota como foto (PNG), para mandarla por WhatsApp =================
  const cargarImg = url => new Promise(r => { if (!url) return r(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => r(i); i.onerror = () => r(null); i.src = url; setTimeout(() => r(null), 4000); });
  async function imagen(nc, o) {
    o = o || {}; const emp = o.empresa || {}, vs = valores(nc, o.listas, o.formas), saldo = nc.saldo != null ? +nc.saldo : +nc.monto;
    const raiz = getComputedStyle(document.documentElement), UI = raiz.getPropertyValue('--f-ui').trim() || 'sans-serif', MONO = raiz.getPropertyValue('--f-mono').trim() || 'monospace';
    const AC = raiz.getPropertyValue('--acento').trim() || '#5B4B8A', TINTA = '#1d1a24', GRIS = '#6e6878', LINEA = '#e4dfeb';
    try { await document.fonts.ready; } catch (_) {}
    let logo = await cargarImg(emp.logo_url);
    const W = 600, P = 40, S = 2, num = n => '#' + String(n).padStart(6, '0');
    const fecha = new Date(nc.creado || Date.now()).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    // se dibuja dos veces: la primera solo mide el alto
    const dibujar = (ctx, medir) => {
      let y = 0;
      const txt = (t, x, f, c, al) => { if (!medir) { ctx.font = f; ctx.fillStyle = c; ctx.textAlign = al || 'left'; ctx.fillText(t, x, y); } };
      const partir = (t, f, ancho) => { ctx.font = f; const ps = String(t).split(' '), ls = []; let l = ''; ps.forEach(p => { const n = l ? l + ' ' + p : p; if (ctx.measureText(n).width > ancho && l) { ls.push(l); l = p; } else l = n; }); if (l) ls.push(l); return ls; };
      const rect = (x, yy, w, h, r, fill, stroke, dash) => { if (medir) return; ctx.beginPath(); ctx.roundRect(x, yy, w, h, r); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.setLineDash(dash || []); ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); } };
      if (!medir) { ctx.fillStyle = '#f3f0f7'; ctx.fillRect(0, 0, W, ctx.canvas.height / S); }
      const card0 = 20; y = card0;
      const cardAlto = ctx.__alto || 0; rect(20, card0, W - 40, cardAlto - card0 - 20, 22, '#fff');
      // encabezado: logo (o el nombre) y dirección
      y += 30;
      if (logo) { const h = 64, w = Math.min(260, logo.width * h / logo.height); if (!medir) ctx.drawImage(logo, (W - w) / 2, y, w, h); y += h + 22; }
      else { y += 26; txt(emp.nombre || '', W / 2, `800 28px ${UI}`, TINTA, 'center'); y += 24; }
      const dir = [emp.domicilio, emp.localidad].filter(Boolean).join(' · ') + (emp.telefono ? ' · ' + emp.telefono : '');
      if (dir) { txt(dir, W / 2, `500 14px ${UI}`, GRIS, 'center'); y += 26; }
      // franja del título
      rect(20, y, W - 40, 50, 0, AC); y += 33; txt(nc.tipo === 'gift_card' ? 'G I F T   C A R D' : 'N O T A   D E   C R É D I T O', W / 2, `800 19px ${UI}`, '#fff', 'center'); y += 45;
      // el código
      rect(P + 40, y, W - 2 * P - 80, 84, 16, '#faf8fc', AC, [10, 7]); y += 56;
      txt(String(nc.codigo).split('').join(' '), W / 2, `800 40px ${MONO}`, TINTA, 'center'); y += 20;
      txt('código para usarla', W / 2, `600 12px ${UI}`, GRIS, 'center'); y += 46;
      // el saldo
      txt('SALDO A FAVOR', W / 2, `700 13px ${UI}`, GRIS, 'center'); y += 52;
      txt(pesos(saldo), W / 2, `800 50px ${UI}`, AC, 'center'); y += 34;
      if (vs[0].texto) {
        partir(`Vale ${pesos(vs[0].valor)} pagando con ${vs[0].texto}`, `600 16px ${UI}`, W - 2 * P - 20).forEach(l => { txt(l, W / 2, `600 16px ${UI}`, TINTA, 'center'); y += 23; });
        vs.slice(1).forEach(x => { txt(`Con ${x.texto}: ${pesos(x.valor)}`, W / 2, `500 14px ${UI}`, GRIS, 'center'); y += 21; });
      }
      if (saldo < +nc.monto) { txt(`Monto original ${pesos(nc.monto)} · ya usado ${pesos(+nc.monto - saldo)}`, W / 2, `500 13px ${UI}`, GRIS, 'center'); y += 20; }
      // el detalle
      y += 14; if (!medir) { ctx.fillStyle = LINEA; ctx.fillRect(P, y, W - 2 * P, 1.5); } y += 30;
      const par = (a, b) => { txt(a, P, `500 14px ${UI}`, GRIS); txt(b, W - P, `600 14px ${UI}`, TINTA, 'right'); y += 24; };
      par('Fecha', fecha); if (o.clienta) par('Clienta', o.clienta);
      if (o.origen) par('Por', 'cambio del ticket ' + num(o.origen)); else if (o.ticket) par('Comprobante', num(o.ticket));
      par('Vence', nc.vence ? new Date(nc.vence + 'T12:00').toLocaleDateString('es-AR') : 'sin vencimiento');
      const grupo = (t, ls) => { if (!(ls || []).length) return; y += 10; txt(t, P, `700 12px ${UI}`, AC); y += 22;
        ls.forEach(l => { const d = `${Math.abs(l.cantidad)}× ${l.descripcion}` + ([l.talle, l.color].filter(Boolean).length ? ' · ' + [l.talle, l.color].filter(Boolean).join(' · ') : ''); partir(d, `500 14px ${UI}`, W - 2 * P - 110).forEach((x, i) => { txt(x, P, `500 14px ${UI}`, TINTA); if (!i) txt(pesos(Math.abs(l.total)), W - P, `600 14px ${UI}`, TINTA, 'right'); y += 21; }); }); };
      grupo('DEVOLVIÓ', o.devuelve); grupo('SE LLEVÓ', o.lleva);
      y += 16; if (!medir) { ctx.fillStyle = LINEA; ctx.fillRect(P, y, W - 2 * P, 1.5); } y += 30;
      txt('Presentá este código en tu próxima compra.', W / 2, `600 14px ${UI}`, TINTA, 'center'); y += 21;
      txt('Documento no válido como factura.', W / 2, `500 12px ${UI}`, GRIS, 'center'); y += 40;
      return y + 20;
    };
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
    cv.width = W * S; cv.height = 10; const alto = dibujar(ctx, true);
    cv.height = alto * S; ctx.scale(S, S); ctx.__alto = alto;
    try { dibujar(ctx, false); return await new Promise((r, x) => cv.toBlob(b => b ? r(b) : x(new Error('sin imagen')), 'image/png')); }
    catch (_) { logo = null; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.scale(S, S); dibujar(ctx, false); return await new Promise(r => cv.toBlob(r, 'image/png')); }   // logo sin permiso: sin logo
  }
  // Mandarla como foto. Celular: el menú de compartir (elegís WhatsApp y el chat). Compu: la foto queda copiada y se abre
  // WhatsApp (en el chat de la clienta si tiene teléfono) para pegarla con Ctrl+V. Si nada de eso se puede, se descarga.
  function telWsp(t) { let d = String(t || '').replace(/\D/g, '').replace(/^0+/, ''); if (!d) return ''; if (d.startsWith('54')) return d; if (d.length === 10) return '549' + d; return d.length > 10 ? d : ''; }
  async function compartir(nc, o, telefono) {
    const nombre = `nota-credito-${nc.codigo}.png`, prom = imagen(nc, o);
    const tactil = window.matchMedia && matchMedia('(pointer:coarse)').matches;
    const abrirWsp = () => { const t = telWsp(telefono); location.href = 'whatsapp://send' + (t ? '?phone=' + t : ''); };
    if (!tactil && navigator.clipboard && window.ClipboardItem) {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': prom })]); abrirWsp(); return 'copiada'; } catch (_) {}
    }
    const blob = await prom, file = new File([blob], nombre, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Nota de crédito ' + nc.codigo }); return 'compartida'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelada'; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); return 'descargada';
  }
  const AVISO = { copiada: 'La foto de la nota quedó copiada: en WhatsApp pegala con Ctrl+V', descargada: 'La foto de la nota se descargó: adjuntala en WhatsApp' };
  window.NOTA_CREDITO = { html, texto, valores, medios, imagen, compartir, AVISO };
})();
