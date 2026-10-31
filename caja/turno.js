/* Percha · Turno de caja: abrir, ingresos/retiros, cerrar (en pasos, con arqueo) e imprimir el cierre.
   Lo usan el Punto de venta (caja.js) y la pantalla Caja (caja.html). Necesita APP listo y, si está, CAJAFX (sonidos y telón).
   TURNO.cajaDe(e) · TURNO.abierto(cajaId) · TURNO.abrir(caja) → turno|null · TURNO.movimiento(turno) → bool
   TURNO.cerrar(caja, turno, { pendientes }) → bool · TURNO.imprimirCierre(caja, turno, esp, arqueo, queda, quien) */
(function () {
  const fx = () => window.CAJAFX || { sonido() { }, telon: async () => { }, billetes: () => ({ total: () => 0 }) };
  const r2 = n => Math.round((+n || 0) * 100) / 100;
  const nombrePila = () => ((APP.miembro && APP.miembro.nombre) || '').split(' ')[0];

  async function cajaDe(e) { const { data } = await sb.from('cajas').select('*').eq('empresa_id', e).eq('activa', true).order('nombre').limit(1); return (data || [])[0] || null; }
  async function abierto(cajaId) { const { data } = await sb.from('caja_turnos').select('*').eq('caja_id', cajaId).eq('estado', 'abierto').order('abierto', { ascending: false }).limit(1); return (data || [])[0] || null; }

  function abrir(caja) {
    const { fmt, esc, $, toast, modal, mensajeError } = APP;
    return new Promise(async resolve => {
      // se propone lo que quedó en la caja al cerrar la última vez
      const { data: ult } = await sb.from('caja_turnos').select('efectivo_queda,cerrado').eq('caja_id', caja.id).eq('estado', 'cerrado').order('cerrado', { ascending: false }).limit(1);
      const queda = ult && ult[0] && ult[0].efectivo_queda != null ? +ult[0].efectivo_queda : 0;
      const h = new Date().getHours(), hola = h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
      const m = modal(`<h2>${h < 13 ? '☀️' : '🌤️'} ${hola}${nombrePila() ? ', ' + esc(nombrePila()) : ''}. Abramos la caja</h2>
        <p class="sub">${queda ? `En el último cierre quedaron <b>${fmt.pesos(queda)}</b> de cambio. Si está igual, tocá Abrir.` : 'Contá el efectivo con el que arrancás.'}</p>
        <div class="campo" style="margin-top:12px"><label>Efectivo para arrancar</label><input id="t-ini" type="number" min="0" step="100" value="${queda}" style="font:700 22px var(--f-mono);max-width:220px"></div>
        <button class="btn chico" type="button" id="t-contar">🧮 Contar billetes</button><div id="t-bil" hidden></div>
        <div class="pie"><button class="btn" data-no>Después</button><button class="btn primario" data-si>🔓 Abrir caja</button></div>`, { fijo: true });
      $('#t-contar', m).onclick = () => { const c = $('#t-bil', m); c.hidden = !c.hidden; if (!c.hidden && !c.innerHTML) fx().billetes(c, t => { $('#t-ini', m).value = t; }); };
      $('[data-no]', m).onclick = () => { m.cerrar(); resolve(null); };
      $('[data-si]', m).onclick = async () => {
        const b = $('[data-si]', m); b.disabled = true;
        const ini = +$('#t-ini', m).value || 0;
        const r = await sb.from('caja_turnos').insert(APP.conEmpresa({ caja_id: caja.id, efectivo_inicial: ini })).select().single();
        if (r.error) { b.disabled = false; fx().sonido('error'); toast(mensajeError(r.error), 'error'); return; }
        m.cerrar(); resolve(r.data);
        fx().telon({ tipo: 'abrir', emoji: '🔓', titulo: '¡Caja abierta!', texto: `Arrancás con ${fmt.pesos(ini)}. ¡Buenas ventas! 🍀`, auto: 2100 }).then(() => { const q = document.getElementById('q'); if (q) q.focus(); });
      };
    });
  }

  function movimiento(turno) {
    const { fmt, $, toast, modal, mensajeError } = APP;
    return new Promise(resolve => {
      const m = modal(`<h2>💵 Ingreso o retiro de efectivo</h2>
        <div class="fila c2" style="margin-top:12px"><div class="campo"><label>Tipo</label><select id="m-tipo"><option value="retiro">Retiro (sale plata)</option><option value="ingreso">Ingreso (entra plata)</option></select></div><div class="campo"><label>Monto</label><input id="m-monto" type="number" min="1" step="100"></div></div>
        <div class="campo"><label>Concepto</label><input id="m-con" placeholder="Pago a proveedor, cambio, retiro de la dueña…"></div>
        <div class="pie"><button class="btn" data-no>Cancelar</button><button class="btn primario" data-si>Registrar</button></div>`);
      $('[data-no]', m).onclick = () => { m.cerrar(); resolve(false); };
      $('[data-si]', m).onclick = async () => {
        const monto = +$('#m-monto', m).value; if (!monto) { toast('Poné el monto', 'error'); return; }
        const tipo = $('#m-tipo', m).value;
        const r = await sb.from('caja_movimientos').insert(APP.conEmpresa({ turno_id: turno.id, tipo, monto, concepto: $('#m-con', m).value.trim() || null, user_id: APP.user.id }));
        if (r.error) { fx().sonido('error'); toast(mensajeError(r.error), 'error'); return; }
        m.cerrar(); fx().sonido('ok'); toast((tipo === 'retiro' ? 'Retiro' : 'Ingreso') + ' de ' + fmt.pesos(monto) + ' registrado'); resolve(true);
      };
    });
  }

  // Ventas fuera de la caja (sql/104): pedidos de la web y ventas cargadas con la caja cerrada, desde el cierre anterior.
  // No van al cajón ni al arqueo: se muestran aparte y suman al total del día.
  const CANAL = { tiendanube: 'Web', whatsapp: 'WhatsApp', local: 'Local', online: 'Online' };
  function fueraHtml(fu) {
    const { fmt, esc } = APP; if (!fu || !+fu.ventas) return '';
    const hora = d => new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `<div class="aviso-caja info" style="margin-top:10px"><b>🌐 Además, ${fu.ventas} venta${fu.ventas > 1 ? 's' : ''} fuera de la caja: ${fmt.pesos(fu.total)}</b><small style="display:block;margin:2px 0 6px">Pedidos de la web o ventas cargadas con la caja cerrada. No van al cajón ni al arqueo.</small>` +
      `<table class="lista">${(fu.lista || []).map(v => `<tr><td class="mono">#${String(v.numero).padStart(6, '0')}</td><td>${esc(CANAL[v.origen] || v.origen || '')}${v.cliente ? ' · ' + esc(v.cliente) : ''}<br><small>${hora(v.fecha)}${v.pagos ? ' · ' + esc(v.pagos) : ''}${v.estado !== 'completada' ? ' · ' + esc(v.estado) : ''}</small></td><td class="num">${fmt.pesos(v.total)}</td></tr>`).join('')}</table></div>`;
  }
  async function cerrar(caja, turno, op) {
    const { fmt, esc, $, $$, toast, modal, mensajeError } = APP;
    if (op && op.pendientes) { toast('Primero subí las ventas que quedaron sin internet (desde el Punto de venta)', 'error'); return false; }
    const { data: esp, error } = await sb.rpc('caja_esperado', { p_turno: turno.id });
    if (error) { toast(mensajeError(error), 'error'); return false; }
    const filas = (esp.formas || []).filter(f => f.esperado || f.ventas || f.tipo === 'efectivo');
    const efv = filas.find(f => f.tipo === 'efectivo');
    return new Promise(resolve => {
      // tres pasos: cómo te fue → contar la plata → qué queda para mañana
      const m = modal(`<div data-paso="1">
          <h2>🌙 Cerrar la caja</h2><p class="sub">Así te fue en este turno${nombrePila() ? ', ' + esc(nombrePila()) : ''}:</p>
          <div class="tiles" style="grid-template-columns:repeat(3,1fr);margin:14px 0 10px">
            <div class="tile"><div class="t">Ventas</div><div class="n">${esp.ventas}</div></div>
            <div class="tile"><div class="t">Vendido</div><div class="n" style="font-size:22px">${fmt.pesos(esp.total)}</div></div>
            <div class="tile"><div class="t">Ticket promedio</div><div class="n" style="font-size:22px">${esp.ventas ? fmt.pesos(esp.total / esp.ventas) : '—'}</div></div></div>
          <table class="lista">${filas.filter(f => f.ventas).map(f => `<tr><td>${esc(f.nombre)}</td><td class="num"><small>${f.ventas} venta${f.ventas > 1 ? 's' : ''}</small></td><td class="num">${fmt.pesos(f.tipo === 'efectivo' ? f.esperado - esp.efectivo_inicial - esp.movimientos : f.esperado)}</td></tr>`).join('') || '<tr><td class="vacio">No hubo cobros en este turno.</td></tr>'}</table>
          ${fueraHtml(esp.fuera)}${esp.fuera && +esp.fuera.ventas ? `<p class="sub" style="margin-top:8px"><b>Total del día: ${fmt.pesos(+esp.total + +esp.fuera.total)}</b> (caja ${fmt.pesos(esp.total)} + fuera de la caja ${fmt.pesos(esp.fuera.total)})</p>` : ''}
          <div class="pie"><button class="btn" data-no>Cancelar</button><button class="btn primario" data-ir="2">Contar la plata →</button></div></div>
        <div data-paso="2" hidden>
          <h2>🧮 Contá lo que hay</h2><p class="sub">Anotá lo que contaste en cada medio. Si coincide, queda en verde.</p>
          <table class="lista" style="margin-top:10px"><tr><th>Medio</th><th class="num">Debería haber</th><th class="num">Contaste</th><th class="num">Diferencia</th></tr>
          ${filas.map(f => `<tr data-id="${f.forma_pago_id}" data-esp="${f.esperado}" data-tipo="${f.tipo}"><td>${esc(f.nombre)}${f.tipo === 'efectivo' ? ` <small style="color:var(--tinta-3)">(arrancó con ${fmt.pesos(esp.efectivo_inicial)}${esp.movimientos ? ', ' + (esp.movimientos > 0 ? '+' : '') + fmt.pesos(esp.movimientos) + ' de ingresos/retiros' : ''})</small>` : ''}</td><td class="num">${fmt.pesos(f.esperado)}</td><td class="num"><input type="number" step="1" value="${Math.round(f.esperado)}" style="width:120px;text-align:right;font-family:var(--f-mono);border:1px solid var(--linea);border-radius:7px;padding:4px 6px"></td><td class="num dif">—</td></tr>`).join('')}</table>
          ${efv ? '<button class="btn chico" type="button" id="c-contar" style="margin-top:8px">🧮 Contar billetes del efectivo</button><div id="c-bil" hidden></div>' : ''}
          <div class="aviso-caja" id="c-veredicto" style="margin-top:12px"></div>
          <div class="pie"><button class="btn" data-ir="1">← Volver</button><button class="btn primario" data-ir="3">${efv ? 'Seguir →' : 'Cerrar caja'}</button></div></div>
        <div data-paso="3" hidden>
          <h2>💸 ¿Cuánto retirás de la caja?</h2><p class="sub">Contaste <b id="c-contado"></b> en efectivo. Lo que no retirás queda de cambio para mañana.</p>
          <div class="fila c2" style="margin-top:12px"><div class="campo"><label>Retirás</label><input id="c-retiro" type="number" min="0" step="100" style="font:700 20px var(--f-mono)"></div>
            <div class="campo"><label>🌅 Cambio para mañana</label><div id="c-queda" style="font:800 24px var(--f-titulo);padding-top:6px">—</div></div></div>
          <div class="campo"><label>Notas (opcional)</label><input id="c-notas" placeholder="Algo para recordar de hoy"></div>
          <div class="pie"><button class="btn" data-ir="2">← Volver</button><button class="btn primario" data-si>🌙 Cerrar caja</button></div></div>`, { fijo: true });
      const contadoEfectivo = () => { const tr = $('tr[data-tipo="efectivo"]', m); return tr ? +$('input', tr).value || 0 : 0; };
      const quedaDe = () => contadoEfectivo() - (+$('#c-retiro', m).value || 0);
      const retira = () => { const q = quedaDe(); $('#c-queda', m).textContent = q < 0 ? 'Retirás más de lo que hay' : fmt.pesos(q); $('#c-queda', m).style.color = q < 0 ? 'var(--error)' : ''; };
      const ir = n => { $$('[data-paso]', m).forEach(p => p.hidden = p.dataset.paso !== String(n)); if (n === 3) { $('#c-contado', m).textContent = fmt.pesos(contadoEfectivo()); const r = $('#c-retiro', m); if (r.value === '') r.value = Math.max(0, contadoEfectivo() - Math.round(+esp.efectivo_inicial || 0)); r.focus(); r.select(); retira(); } };
      const calc = () => {
        let falta = 0, sobra = 0;
        $$('tr[data-id]', m).forEach(tr => { const d = (+$('input', tr).value || 0) - +tr.dataset.esp; const td = $('.dif', tr); td.textContent = Math.abs(d) < 1 ? '✓' : (d > 0 ? '+' : '') + fmt.pesos(d); td.style.color = Math.abs(d) < 1 ? 'var(--ok)' : 'var(--error)'; if (d <= -1) falta -= d; if (d >= 1) sobra += d; });
        const v = $('#c-veredicto', m);
        v.className = 'aviso-caja ' + (!falta && !sobra ? 'ok' : 'error');
        v.innerHTML = !falta && !sobra ? '🎉 <b>¡Cuadra perfecto!</b>' : [falta ? `Faltan <b>${fmt.pesos(falta)}</b>` : '', sobra ? `Sobran <b>${fmt.pesos(sobra)}</b>` : ''].filter(Boolean).join(' · ') + '. Revisá antes de cerrar (o anotalo en las notas).';
      };
      $$('tr[data-id] input', m).forEach(i => i.addEventListener('input', calc)); calc();
      const cb = $('#c-contar', m); if (cb) cb.onclick = () => { const c = $('#c-bil', m); c.hidden = !c.hidden; if (!c.hidden && !c.innerHTML) fx().billetes(c, t => { $('input', $('tr[data-tipo="efectivo"]', m)).value = t; calc(); }); };
      $('#c-retiro', m).oninput = retira;
      $('[data-no]', m).onclick = () => { m.cerrar(); resolve(false); };
      $$('[data-ir]', m).forEach(b => b.onclick = () => { const n = +b.dataset.ir; if (n === 3 && !efv) $('[data-si]', m).click(); else ir(n); });
      $('[data-si]', m).onclick = async () => {
        const b = $('[data-si]', m); b.disabled = true;
        const arqueo = $$('tr[data-id]', m).map(tr => ({ forma_pago_id: tr.dataset.id, nombre: $('td', tr).textContent.trim().split(' (')[0], esperado: +tr.dataset.esp, declarado: +$('input', tr).value || 0, diferencia: r2((+$('input', tr).value || 0) - +tr.dataset.esp) }));
        if (efv && quedaDe() < 0) { toast('Estás retirando más efectivo del que contaste', 'error'); return; }
        const queda = efv ? Math.max(0, quedaDe()) : null;
        const r = await sb.from('caja_turnos').update({ estado: 'cerrado', cerrado: new Date().toISOString(), cerrado_por: APP.user.id, arqueo, efectivo_queda: queda, fuera_caja: esp.fuera || null, notas: $('#c-notas', m).value.trim() || null }).eq('id', turno.id);
        if (r.error) { b.disabled = false; fx().sonido('error'); toast(mensajeError(r.error), 'error'); return; }
        m.cerrar(); resolve(true);
        const dif = arqueo.reduce((s, a) => s + a.diferencia, 0);
        const datos = [caja, Object.assign({}, turno, { cerrado: new Date().toISOString(), notas: $('#c-notas', m).value.trim() || null }), Object.assign({}, esp, { medios: filas.filter(f => f.ventas).map(f => ({ nombre: f.nombre, monto: f.tipo === 'efectivo' ? f.esperado - esp.efectivo_inicial - esp.movimientos : f.esperado })) }), arqueo, queda, nombrePila()];
        fx().telon({ tipo: 'cerrar', emoji: '🌙', titulo: `¡Buen trabajo${nombrePila() ? ', ' + nombrePila() : ''}!`, monto: +esp.total,
          texto: `${esp.ventas} venta${esp.ventas === 1 ? '' : 's'} en este turno${Math.abs(dif) < 1 ? ' · la caja cuadró perfecto ✓' : ''}${queda != null ? ' · mañana arranca con ' + fmt.pesos(queda) + ' de cambio' : ''}.`,
          botones: [['Imprimir resumen', () => imprimirCierre(...datos)], ['Mandar por WhatsApp', () => whatsappCierre(...datos)], ['Listo', null, true]] });
      };
    });
  }

  function imprimirCierre(caja, t, esp, arqueo, queda, quien) {
    const { fmt, esc } = APP;
    const emp = APP.empresa || {}, f = d => new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    let el = document.getElementById('impresion'); if (!el) { el = document.createElement('div'); el.id = 'impresion'; document.body.appendChild(el); }
    el.innerHTML = `<h2 class="c">${esc(emp.nombre || '')}</h2><div class="c">CIERRE DE CAJA · ${esc(caja.nombre)}</div><hr>
      <div>Abrió: ${f(t.abierto)}<br>Cerró: ${f(t.cerrado || new Date())}${quien ? '<br>Responsable: ' + esc(quien) : ''}</div><hr>
      <table><tr><td>Ventas</td><td class="r">${esp.ventas}</td></tr><tr><td><b>Vendido</b></td><td class="r"><b>${fmt.pesos(esp.total)}</b></td></tr><tr><td>Efectivo inicial</td><td class="r">${fmt.pesos(esp.efectivo_inicial)}</td></tr><tr><td>Ingresos/retiros</td><td class="r">${fmt.pesos(esp.movimientos)}</td></tr></table><hr>
      ${(esp.medios || []).length ? `<div><b>Cobrado por medio</b></div><table>${esp.medios.map(x => `<tr><td>${esc(x.nombre)}</td><td class="r">${fmt.pesos(x.monto)}</td></tr>`).join('')}</table><hr>` : ''}
      ${esp.fuera && +esp.fuera.ventas ? `<div><b>Fuera de la caja</b> (web / caja cerrada)</div><table>${(esp.fuera.lista || []).map(v => `<tr><td>#${String(v.numero).padStart(6, '0')} ${esc(CANAL[v.origen] || v.origen || '')}</td><td class="r">${fmt.pesos(v.total)}</td></tr>`).join('')}<tr><td><b>Total del día</b></td><td class="r"><b>${fmt.pesos(+esp.total + +esp.fuera.total)}</b></td></tr></table><hr>` : ''}
      <table><tr><td><b>Medio</b></td><td class="r"><b>Esperado</b></td><td class="r"><b>Contado</b></td></tr>${(arqueo || []).map(a => `<tr><td>${esc(a.nombre)}</td><td class="r">${fmt.pesos(a.esperado)}</td><td class="r">${fmt.pesos(a.declarado)}${Math.abs(a.diferencia) >= 1 ? ' (' + (a.diferencia > 0 ? '+' : '') + fmt.pesos(a.diferencia) + ')' : ''}</td></tr>`).join('')}</table>
      ${queda != null ? (() => { const e = (arqueo || []).find(a => /efectivo/i.test(a.nombre || '')); return `<hr><table>${e ? `<tr><td>Retiro</td><td class="r">${fmt.pesos(Math.max(0, e.declarado - queda))}</td></tr>` : ''}<tr><td><b>Cambio para mañana</b></td><td class="r"><b>${fmt.pesos(queda)}</b></td></tr></table>`; })() : ''}`;
    setTimeout(() => window.print(), 50);
  }

  // resumen del cierre en texto, para mandar por WhatsApp (se elige a quién en WhatsApp)
  function textoCierre(caja, t, esp, arqueo, queda, quien) {
    const { fmt } = APP, emp = APP.empresa || {};
    const dia = new Date(t.cerrado || Date.now()).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
    const hora = d => new Date(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const l = [`*Cierre de caja · ${emp.nombre || ''}*`, `${dia.charAt(0).toUpperCase() + dia.slice(1)} · ${hora(t.abierto)} a ${hora(t.cerrado || Date.now())}${quien ? ' · ' + quien : ''}`, '',
      `🛍️ Ventas: ${esp.ventas} · Vendido: *${fmt.pesos(esp.total)}*`];
    const fu = esp.fuera; if (fu && +fu.ventas) { l.push(`🌐 Fuera de la caja (web / caja cerrada): ${fu.ventas} · ${fmt.pesos(fu.total)}`); (fu.lista || []).forEach(v => l.push(`   • #${String(v.numero).padStart(6, '0')} ${CANAL[v.origen] || v.origen || ''}${v.cliente ? ' · ' + v.cliente : ''} · ${fmt.pesos(v.total)}`)); l.push(`📊 *Total del día: ${fmt.pesos(+esp.total + +fu.total)}*`); }
    if ((esp.medios || []).length) { l.push('', '*Cobrado por medio:*'); esp.medios.forEach(x => l.push(`• ${x.nombre}: ${fmt.pesos(x.monto)}`)); }
    const efv = (arqueo || []).find(a => /efectivo/i.test(a.nombre || ''));
    l.push('', `💵 Efectivo: arrancó con ${fmt.pesos(esp.efectivo_inicial)}${+esp.movimientos ? ', ingresos/retiros ' + fmt.pesos(esp.movimientos) : ''}${efv ? ', se contó ' + fmt.pesos(efv.declarado) : ''}`);
    const dif = (arqueo || []).reduce((s, a) => s + (+a.diferencia || 0), 0);
    if ((arqueo || []).length) l.push(Math.abs(dif) < 1 ? '✅ La caja cuadró' : `⚠️ ${dif < 0 ? 'Faltaron' : 'Sobraron'} ${fmt.pesos(Math.abs(dif))}`);
    if (queda != null) { if (efv) l.push(`💸 Se retiró: ${fmt.pesos(Math.max(0, efv.declarado - queda))}`); l.push('', `🌅 *Mañana arranca con ${fmt.pesos(queda)} de cambio*`); }
    if (t.notas && !/^Traído de TPVsol/.test(t.notas)) l.push('', '📝 ' + t.notas);
    return l.join('\n');
  }
  function whatsappCierre(...a) { APP.whatsapp(textoCierre(...a)); }

  window.TURNO = { fueraHtml, cajaDe, abierto, abrir, movimiento, cerrar, imprimirCierre, textoCierre, whatsappCierre };
})();
