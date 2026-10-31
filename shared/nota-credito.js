/* Percha · Comprobantes tipo cupón (80 mm y foto para WhatsApp), distintos de un ticket de venta:
   · Nota de crédito: código grande, saldo a favor, de qué cambio salió y cuánto vale según con qué pague (la NC recuerda su lista:
     una de Contado vale más pagando con tarjeta).
   · Seña: el número para retirar, las prendas reservadas, lo que pagó y lo que falta según con qué pague el resto.
   Los dos se arman como un "doc" (título, código, monto, renglones) y se dibujan igual en papel y en foto.
   Lo usan la caja (al emitirlos) y Ventas (ver, reimprimir y reenviar). */
(function () {
  const h = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const pesos = n => window.fmt ? fmt.pesos(n) : '$ ' + Math.round(n).toLocaleString('es-AR');
  const listaDe = f => (f.listas && f.listas.length ? f.listas[0] : f.lista_id) || null;
  const PALABRA = { efectivo: 'efectivo', transferencia: 'transferencia', debito: 'débito', credito: 'tarjeta', mercadopago: 'Mercado Pago' };
  const num = n => n ? '#' + String(n).padStart(6, '0') : '';
  // con qué se paga a precio de esa lista, en palabras de la clienta: "efectivo o transferencia", "débito", "tarjeta o Mercado Pago"
  function medios(listaId, formas) {
    const ws = [...new Set((formas || []).filter(f => listaDe(f) === listaId).map(f => PALABRA[f.tipo]).filter(Boolean))];
    return ws.length > 1 ? ws.slice(0, -1).join(', ') + ' o ' + ws[ws.length - 1] : ws[0] || '';
  }
  // cuánto vale un monto de una lista pagando con cada medio: [{ texto, valor, lista_id }], primero el de su propia lista
  function valores(x, listas, formas) {
    const saldo = x.saldo != null ? +x.saldo : +x.monto, pct = id => +((listas || []).find(l => l.id === id) || {}).porcentaje || 100;
    if (!x.lista_id) return [{ texto: '', valor: saldo, lista_id: null }];
    const ids = [...new Set((formas || []).map(listaDe).filter(Boolean))].filter(id => id !== x.lista_id && (listas || []).some(l => l.id === id));
    return [{ texto: medios(x.lista_id, formas), valor: saldo, lista_id: x.lista_id }]
      .concat(ids.map(id => ({ texto: medios(id, formas), valor: Math.round(saldo * pct(id) / pct(x.lista_id)), lista_id: id })).filter(v => v.texto).sort((a, b) => a.valor - b.valor));
  }
  const fechaTxt = f => new Date(f || Date.now()).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

  // ================= Los dos comprobantes como "doc" =================
  /* nc: { codigo, tipo, monto, saldo, creado, vence, lista_id, estado }
     o:  { empresa, listas, formas, clienta, ticket (número del cambio), origen (número del ticket original), devuelve: [lineas], lleva: [lineas], reimpresion } */
  function docNC(nc, o) {
    o = o || {}; const saldo = nc.saldo != null ? +nc.saldo : +nc.monto, vs = valores(nc, o.listas, o.formas);
    return { empresa: o.empresa, titulo: nc.tipo === 'gift_card' ? 'GIFT CARD' : 'NOTA DE CRÉDITO', codigo: nc.codigo, codigoNota: 'código para usarla',
      montoNota: 'SALDO A FAVOR', monto: saldo, extra: saldo < +nc.monto ? `Monto original ${pesos(nc.monto)} · ya usado ${pesos(+nc.monto - saldo)}` : '',
      principal: vs[0].texto ? [`Vale `, pesos(vs[0].valor), ` pagando con ${vs[0].texto}.`] : null, otros: vs.slice(1),
      pares: [['Fecha', fechaTxt(nc.creado) + (o.reimpresion ? ' (copia)' : '')]].concat(o.clienta ? [['Clienta', o.clienta]] : [], o.ticket || o.origen ? [['Por', o.origen ? 'cambio del ticket ' + num(o.origen) : 'devolución', o.ticket ? 'comprobante ' + num(o.ticket) : '']] : []),
      grupos: [['DEVOLVIÓ', o.devuelve], ['SE LLEVÓ', o.lleva]], conPrecios: true,
      vence: (nc.vence ? 'Vence el ' + new Date(nc.vence + 'T12:00').toLocaleDateString('es-AR') : 'Sin vencimiento') + (nc.estado && nc.estado !== 'vigente' ? ' · ' + nc.estado.toUpperCase() : ''),
      pie: ['Presentá este código en tu próxima compra.', 'Documento no válido como factura.'] };
  }
  /* Gift card: siempre a precio de lista (lo que dice es lo que vale en la web). nc.dedicatoria = { para, de, mensaje }.
     o.web = true si la tienda tiene la web conectada (la gift card también es un cupón de descuento ahí). */
  function docGift(nc, o) {
    o = o || {}; const saldo = nc.saldo != null ? +nc.saldo : +nc.monto, ded = nc.dedicatoria || {};
    return { empresa: o.empresa, titulo: 'GIFT CARD', codigo: nc.codigo, codigoNota: 'tu código', dedicatoria: ded,
      montoNota: saldo < +nc.monto ? 'SALDO' : 'VALE', monto: saldo, extra: saldo < +nc.monto ? `De ${pesos(nc.monto)} · ya usado ${pesos(+nc.monto - saldo)}` : '',
      principal: null, otros: [], pares: [['Fecha', fechaTxt(nc.creado) + (o.reimpresion ? ' (copia)' : '')]], grupos: [], conPrecios: false,
      vence: (nc.vence ? 'Vence el ' + new Date(nc.vence + 'T12:00').toLocaleDateString('es-AR') : 'Sin vencimiento') + (nc.estado && nc.estado !== 'vigente' ? ' · ' + nc.estado.toUpperCase() : ''),
      pie: [o.web ? 'Usala en el local o como cupón de descuento en la tienda online.' : 'Presentá este código en el local.', 'Documento no válido como factura.'] };
  }
  /* s: { numero, fecha, total, pagado, saldo, lista_id, lineas: [{ cantidad, descripcion, talle, color, total }], estado }
     o: { empresa, listas, formas, clienta, reimpresion } */
  // los precios de una seña quedan congelados 15 días (o lo que diga la empresa en config.sena_dias); después se cobra al precio de hoy
  const senaDias = o => +(((o || {}).empresa || {}).config || {}).sena_dias || 15;
  const senaHasta = (s, o) => new Date(new Date(s.fecha || Date.now()).getTime() + senaDias(o) * 864e5);
  function docSena(s, o) {
    o = o || {}; const vs = valores({ saldo: s.saldo, lista_id: s.lista_id }, o.listas, o.formas), retirada = s.estado && s.estado !== 'senada';
    return { empresa: o.empresa, titulo: 'SEÑA', codigo: num(s.numero), codigoNota: 'número para retirar',
      montoNota: retirada ? 'YA RETIRADA' : 'FALTA PAGAR', monto: retirada ? 0 : +s.saldo, extra: '',
      principal: retirada || !vs[0].texto ? null : [`Pagando con ${vs[0].texto}: `, pesos(vs[0].valor), '.'], otros: retirada ? [] : vs.slice(1),
      pares: [['Fecha', fechaTxt(s.fecha) + (o.reimpresion ? ' (copia)' : '')]].concat(o.clienta ? [['Clienta', o.clienta]] : [], [['Total', pesos(s.total)], ['Pagó de seña', pesos(s.pagado)]]),
      grupos: [['PRENDAS RESERVADAS', (s.lineas || []).filter(l => +l.cantidad > 0)]], conPrecios: true,
      vence: (() => { const d = senaHasta(s, o); return retirada ? '' : `Precios congelados hasta el ${d.toLocaleDateString('es-AR')}` + (Date.now() > d ? ' (ya venció: se cobra al precio de hoy)' : ''); })(),
      pie: ['Presentá este comprobante para retirar tus prendas.', 'Documento no válido como factura.'] };
  }

  // ================= En papel (80 mm) =================
  const css = `.nc .nc-tit{font:800 17px var(--f-ui,sans-serif);letter-spacing:.12em;text-align:center;border:2px solid #000;padding:5px 0;margin:8px 0 6px}
    .nc .nc-cod{font:800 24px var(--f-mono,monospace);letter-spacing:.18em;text-align:center;border:1.5px dashed #000;border-radius:6px;padding:10px 4px 8px;margin:4px 3mm;word-break:break-all;line-height:1.1}
    .nc .nc-cod.largo{font-size:18px;letter-spacing:.08em}
    .nc .nc-cod small{display:block;font:600 9.5px var(--f-ui,sans-serif);letter-spacing:.08em;text-transform:uppercase;margin-top:8px}
    .nc .nc-sec{font-weight:700;font-size:11px;letter-spacing:.06em;margin:6px 0 2px}
    .nc .nc-monto{display:flex;justify-content:space-between;align-items:baseline;border-top:2px solid #000;border-bottom:2px solid #000;padding:6px 0;margin:8px 0 6px;font-weight:800}
    .nc .nc-monto b{font-size:20px}
    .nc .nc-vale{margin:2px 0}.nc .nc-chico{font-size:10.5px}
    .nc-vista{background:#fff;color:#000;width:76mm;max-width:100%;margin:10px auto 4px;padding:4mm;font:12px/1.35 var(--f-mono,monospace);box-shadow:0 1px 3px rgba(0,0,0,.12),0 8px 24px rgba(0,0,0,.08);border-radius:4px}
    .nc-vista h2{font:700 15px var(--f-ui,sans-serif);margin:0 0 2px}.nc-vista .c{text-align:center}.nc-vista .r{text-align:right}
    .nc-vista table{width:100%;border-collapse:collapse}.nc-vista td{padding:2px 0;vertical-align:top}.nc-vista hr{border:0;border-top:1px dashed #000;margin:6px 0}`;
  function estilos() { if (document.getElementById('nc-css')) return; const s = document.createElement('style'); s.id = 'nc-css'; s.textContent = css; document.head.appendChild(s); }
  const dedHtml = x => x && (x.para || x.de || x.mensaje) ? `<div class="c" style="margin:4px 0 8px">${x.para ? 'Para <b>' + h(x.para) + '</b>' : ''}${x.para && x.de ? '<br>' : ''}${x.de ? 'De <b>' + h(x.de) + '</b>' : ''}${x.mensaje ? '<br><i>“' + h(x.mensaje) + '”</i>' : ''}</div>` : '';
  function htmlDoc(d) {
    estilos(); const emp = d.empresa || {};
    const fila = l => `<tr><td>${Math.abs(l.cantidad)}× ${h(l.descripcion)}<br><small>${h([l.talle, l.color].filter(Boolean).join(' · '))}</small></td>${d.conPrecios ? `<td class="r">${pesos(Math.abs(l.total))}</td>` : ''}</tr>`;
    return `<div class="nc">${emp.logo_url ? `<div class="c"><img src="${h(emp.logo_url)}" alt="" style="max-width:42mm;max-height:20mm;margin:0 auto 4px;display:block"></div>` : ''}<h2 class="c">${h(emp.nombre)}</h2>
      <div class="c">${h([emp.domicilio, emp.localidad].filter(Boolean).join(' · '))}${emp.telefono ? '<br>' + h(emp.telefono) : ''}</div>
      <div class="nc-tit">${h(d.titulo)}</div>
      ${dedHtml(d.dedicatoria)}
      <div class="nc-cod${String(d.codigo).length > 12 ? ' largo' : ''}">${h(d.codigo)}<small>${h(d.codigoNota)}</small></div>
      <table style="margin-top:8px">${d.pares.map(p => `<tr><td>${h(p[0])}</td><td class="r">${h(p[1])}${p[2] ? '<br><small>' + h(p[2]) + '</small>' : ''}</td></tr>`).join('')}</table>
      ${d.grupos.filter(g => (g[1] || []).length).map((g, i) => `${i ? '' : '<hr>'}<div class="nc-sec">${h(g[0])}</div><table>${g[1].map(fila).join('')}</table>`).join('')}
      <div class="nc-monto"><span>${h(d.montoNota)}</span><b>${pesos(d.monto)}</b></div>
      ${d.extra ? `<div class="nc-chico">${h(d.extra)}</div>` : ''}
      ${d.principal ? `<div class="nc-vale">${h(d.principal[0])}<b>${h(d.principal[1])}</b>${h(d.principal[2])}</div>${d.otros.length ? `<div class="nc-vale nc-chico">${d.otros.map(x => `Con ${h(x.texto)}: <b>${pesos(x.valor)}</b>`).join(' · ')}</div>` : ''}` : ''}
      ${d.vence ? `<div class="nc-vale nc-chico">${h(d.vence)}</div>` : ''}
      <hr><div class="c nc-chico">${d.pie.map(h).join('<br>')}</div></div>`;
  }
  function textoDoc(d) {
    return `${(d.empresa || {}).nombre || ''} · *${d.titulo.charAt(0) + d.titulo.slice(1).toLowerCase()} ${d.codigo}*\n${d.montoNota.charAt(0) + d.montoNota.slice(1).toLowerCase()}: ${pesos(d.monto)}`
      + (d.principal ? '\n' + d.principal.join('') + d.otros.map(x => `\nCon ${x.texto}: ${pesos(x.valor)}`).join('') : '') + '\n' + d.pie[0];
  }

  // ================= Como foto (PNG), para mandarla por WhatsApp =================
  const cargarImg = url => new Promise(r => { if (!url) return r(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => r(i); i.onerror = () => r(null); i.src = url; setTimeout(() => r(null), 4000); });
  async function imagenDoc(d) {
    const emp = d.empresa || {};
    const raiz = getComputedStyle(document.documentElement), UI = raiz.getPropertyValue('--f-ui').trim() || 'sans-serif', MONO = raiz.getPropertyValue('--f-mono').trim() || 'monospace';
    const AC = raiz.getPropertyValue('--acento').trim() || '#5B4B8A', TINTA = '#1d1a24', GRIS = '#6e6878', LINEA = '#e4dfeb';
    try { await document.fonts.ready; } catch (_) {}
    let logo = await cargarImg(emp.logo_url);
    const W = 600, P = 40, S = 2;
    // se dibuja dos veces: la primera solo mide el alto
    const dibujar = (ctx, medir) => {
      let y = 0;
      const txt = (t, x, f, c, al) => { if (!medir) { ctx.font = f; ctx.fillStyle = c; ctx.textAlign = al || 'left'; ctx.fillText(t, x, y); } };
      const partir = (t, f, ancho) => { ctx.font = f; const ps = String(t).split(' '), ls = []; let l = ''; ps.forEach(p => { const n = l ? l + ' ' + p : p; if (ctx.measureText(n).width > ancho && l) { ls.push(l); l = p; } else l = n; }); if (l) ls.push(l); return ls; };
      const rect = (x, yy, w, hh, r, fill, stroke, dash) => { if (medir) return; ctx.beginPath(); ctx.roundRect(x, yy, w, hh, r); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.setLineDash(dash || []); ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); } };
      if (!medir) { ctx.fillStyle = '#f3f0f7'; ctx.fillRect(0, 0, W, ctx.canvas.height / S); }
      y = 20; rect(20, 20, W - 40, (ctx.__alto || 0) - 40, 22, '#fff');
      // encabezado: logo (o el nombre) y dirección
      y += 30;
      if (logo) { const hh = 64, w = Math.min(260, logo.width * hh / logo.height); if (!medir) ctx.drawImage(logo, (W - w) / 2, y, w, hh); y += hh + 22; }
      else { y += 26; txt(emp.nombre || '', W / 2, `800 28px ${UI}`, TINTA, 'center'); y += 24; }
      const dir = [emp.domicilio, emp.localidad].filter(Boolean).join(' · ') + (emp.telefono ? ' · ' + emp.telefono : '');
      if (dir) { txt(dir, W / 2, `500 14px ${UI}`, GRIS, 'center'); y += 26; }
      // franja del título
      rect(20, y, W - 40, 50, 0, AC); y += 33; txt(d.titulo.split('').join(' '), W / 2, `800 19px ${UI}`, '#fff', 'center'); y += 45;
      const dd = d.dedicatoria || {};
      if (dd.para || dd.de || dd.mensaje) {
        if (dd.para) { txt('Para ' + dd.para, W / 2, `700 22px ${UI}`, TINTA, 'center'); y += 30; }
        if (dd.de) { txt('De ' + dd.de, W / 2, `500 17px ${UI}`, GRIS, 'center'); y += 26; }
        if (dd.mensaje) partir('“' + dd.mensaje + '”', `italic 500 16px ${UI}`, W - 2 * P - 40).forEach(l => { txt(l, W / 2, `italic 500 16px ${UI}`, TINTA, 'center'); y += 23; });
        y += 18;
      }
      // el código, con aire: recuadro de 112, el código arriba y "tu código" abajo, separados
      rect(P + 30, y, W - 2 * P - 60, 112, 18, '#faf8fc', AC, [10, 7]);
      { const cd = String(d.codigo), ancho = W - 2 * P - 120; let fs_ = 42;
        // espacio entre letras proporcional a la letra; si no entra, se achica todo junto
        const poner = () => { ctx.font = `800 ${fs_}px ${MONO}`; ctx.letterSpacing = Math.round(fs_ * (cd.length <= 8 ? 0.32 : cd.length <= 12 ? 0.16 : 0.06)) + 'px'; return ctx.measureText(cd).width; };
        while (fs_ > 18 && poner() > ancho) fs_ -= 2;
        y += 62; txt(cd, W / 2, `800 ${fs_}px ${MONO}`, TINTA, 'center'); ctx.letterSpacing = '0px'; }
      y += 30; txt(d.codigoNota.toUpperCase(), W / 2, `700 11px ${UI}`, GRIS, 'center'); y += 20 + 40;
      // el monto
      txt(d.montoNota, W / 2, `700 13px ${UI}`, GRIS, 'center'); y += 52;
      txt(pesos(d.monto), W / 2, `800 50px ${UI}`, AC, 'center'); y += 34;
      if (d.principal) {
        partir(d.principal.join(''), `600 16px ${UI}`, W - 2 * P - 20).forEach(l => { txt(l, W / 2, `600 16px ${UI}`, TINTA, 'center'); y += 23; });
        d.otros.forEach(x => { txt(`Con ${x.texto}: ${pesos(x.valor)}`, W / 2, `500 14px ${UI}`, GRIS, 'center'); y += 21; });
      }
      if (d.extra) { txt(d.extra, W / 2, `500 13px ${UI}`, GRIS, 'center'); y += 20; }
      if (d.vence) { y += 4; txt(d.vence, W / 2, `500 13px ${UI}`, GRIS, 'center'); y += 18; }
      // el detalle
      y += 14; if (!medir) { ctx.fillStyle = LINEA; ctx.fillRect(P, y, W - 2 * P, 1.5); } y += 30;
      d.pares.forEach(p => { txt(p[0], P, `500 14px ${UI}`, GRIS); txt(p[1], W - P, `600 14px ${UI}`, TINTA, 'right'); y += 24; });
      d.grupos.forEach(([t, ls]) => { if (!(ls || []).length) return; y += 10; txt(t, P, `700 12px ${UI}`, AC); y += 22;
        ls.forEach(l => { const s = `${Math.abs(l.cantidad)}× ${l.descripcion}` + ([l.talle, l.color].filter(Boolean).length ? ' · ' + [l.talle, l.color].filter(Boolean).join(' · ') : ''); partir(s, `500 14px ${UI}`, W - 2 * P - 110).forEach((x, i) => { txt(x, P, `500 14px ${UI}`, TINTA); if (!i && d.conPrecios) txt(pesos(Math.abs(l.total)), W - P, `600 14px ${UI}`, TINTA, 'right'); y += 21; }); }); });
      y += 16; if (!medir) { ctx.fillStyle = LINEA; ctx.fillRect(P, y, W - 2 * P, 1.5); } y += 30;
      txt(d.pie[0], W / 2, `600 14px ${UI}`, TINTA, 'center'); y += 21;
      d.pie.slice(1).forEach(l => { txt(l, W / 2, `500 12px ${UI}`, GRIS, 'center'); y += 19; }); y += 21;
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
  async function compartirDoc(d, telefono) {
    const nombre = `${d.titulo.toLowerCase().replace(/[^a-zñ]+/g, '-')}-${String(d.codigo).replace(/\W/g, '')}.png`, prom = imagenDoc(d);
    const tactil = window.matchMedia && matchMedia('(pointer:coarse)').matches;
    const abrirWsp = () => { const t = telWsp(telefono); location.href = 'whatsapp://send' + (t ? '?phone=' + t : ''); };
    if (!tactil && navigator.clipboard && window.ClipboardItem) {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': prom })]); abrirWsp(); return 'copiada'; } catch (_) {}
    }
    const blob = await prom, file = new File([blob], nombre, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: d.titulo + ' ' + d.codigo }); return 'compartida'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelada'; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); return 'descargada';
  }
  const AVISO = { copiada: 'La foto quedó copiada: en WhatsApp pegala con Ctrl+V', descargada: 'La foto se descargó: adjuntala en WhatsApp' };
  const doc = (nc, o) => nc.tipo === 'gift_card' ? docGift(nc, o) : docNC(nc, o);
  // el cupón de la web de una gift card (función tn-cupon): accion 'crear' | 'sincronizar'
  async function cupon(empresa_id, credito_id, accion) {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(`${SUPABASE_URL}/functions/v1/tn-cupon`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ empresa_id, credito_id, accion: accion || 'crear' }) });
    const j = await r.json().catch(() => ({ error: 'La web no respondió (' + r.status + ')' }));
    if (!r.ok || j.error) throw new Error(j.error || 'Error ' + r.status);
    return j;
  }
  window.NOTA_CREDITO = { html: (nc, o) => htmlDoc(doc(nc, o)), texto: (nc, o) => textoDoc(doc(nc, o)), imagen: (nc, o) => imagenDoc(doc(nc, o)), compartir: (nc, o, t) => compartirDoc(doc(nc, o), t), cupon, valores, medios, AVISO };
  window.SENA = { dias: senaDias, hasta: senaHasta, html: (s, o) => htmlDoc(docSena(s, o)), texto: (s, o) => textoDoc(docSena(s, o)), imagen: (s, o) => imagenDoc(docSena(s, o)), compartir: (s, o, t) => compartirDoc(docSena(s, o), t), valores, AVISO };
})();
