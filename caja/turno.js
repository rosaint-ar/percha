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
        <p class="sub">${queda ? `Al cerrar quedaron <b>${fmt.pesos(queda)}</b> en la caja. Si está igual, tocá Abrir.` : 'Contá el efectivo con el que arrancás.'}</p>
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
          <div class="pie"><button class="btn" data-no>Cancelar</button><button class="btn primario" data-ir="2">Contar la plata →</button></div></div>
        <div data-paso="2" hidden>
          <h2>🧮 Contá lo que hay</h2><p class="sub">Anotá lo que contaste en cada medio. Si coincide, queda en verde.</p>
          <table class="lista" style="margin-top:10px"><tr><th>Medio</th><th class="num">Debería haber</th><th class="num">Contaste</th><th class="num">Diferencia</th></tr>
          ${filas.map(f => `<tr data-id="${f.forma_pago_id}" data-esp="${f.esperado}" data-tipo="${f.tipo}"><td>${esc(f.nombre)}${f.tipo === 'efectivo' ? ` <small style="color:var(--tinta-3)">(arrancó con ${fmt.pesos(esp.efectivo_inicial)}${esp.movimientos ? ', ' + (esp.movimientos > 0 ? '+' : '') + fmt.pesos(esp.movimientos) + ' de ingresos/retiros' : ''})</small>` : ''}</td><td class="num">${fmt.pesos(f.esperado)}</td><td class="num"><input type="number" step="1" value="${Math.round(f.esperado)}" style="width:120px;text-align:right;font-family:var(--f-mono);border:1px solid var(--linea);border-radius:7px;padding:4px 6px"></td><td class="num dif">—</td></tr>`).join('')}</table>
          ${efv ? '<button class="btn chico" type="button" id="c-contar" style="margin-top:8px">🧮 Contar billetes del efectivo</button><div id="c-bil" hidden></div>' : ''}
          <div class="aviso-caja" id="c-veredicto" style="margin-top:12px"></div>
          <div class="pie"><button class="btn" data-ir="1">← Volver</button><button class="btn primario" data-ir="3">${efv ? 'Seguir →' : 'Cerrar caja'}</button></div></div>
        <div data-paso="3" hidden>
          <h2>💵 ¿Cuánto queda en la caja?</h2><p class="sub">Lo que dejás para arrancar mañana. El resto es lo que retirás.</p>
          <div class="fila c2" style="margin-top:12px"><div class="campo"><label>Queda en la caja</label><input id="c-queda" type="number" min="0" step="100" style="font:700 20px var(--f-mono)"></div>
            <div class="campo"><label>Retirás</label><div id="c-retira" style="font:800 24px var(--f-titulo);padding-top:6px">—</div></div></div>
          <div class="campo"><label>Notas (opcional)</label><input id="c-notas" placeholder="Algo para recordar de hoy"></div>
          <div class="pie"><button class="btn" data-ir="2">← Volver</button><button class="btn primario" data-si>🌙 Cerrar caja</button></div></div>`, { fijo: true });
      const contadoEfectivo = () => { const tr = $('tr[data-tipo="efectivo"]', m); return tr ? +$('input', tr).value || 0 : 0; };
      const retira = () => { const q = +$('#c-queda', m).value || 0, c = contadoEfectivo(); $('#c-retira', m).textContent = fmt.pesos(Math.max(0, c - q)); $('#c-retira', m).style.color = q > c ? 'var(--error)' : ''; };
      const ir = n => { $$('[data-paso]', m).forEach(p => p.hidden = p.dataset.paso !== String(n)); if (n === 3) { const q = $('#c-queda', m); if (q.value === '') q.value = Math.min(contadoEfectivo(), Math.round(+esp.efectivo_inicial || 0)); q.focus(); retira(); } };
      const calc = () => {
        let falta = 0, sobra = 0;
        $$('tr[data-id]', m).forEach(tr => { const d = (+$('input', tr).value || 0) - +tr.dataset.esp; const td = $('.dif', tr); td.textContent = Math.abs(d) < 1 ? '✓' : (d > 0 ? '+' : '') + fmt.pesos(d); td.style.color = Math.abs(d) < 1 ? 'var(--ok)' : 'var(--error)'; if (d <= -1) falta -= d; if (d >= 1) sobra += d; });
        const v = $('#c-veredicto', m);
        v.className = 'aviso-caja ' + (!falta && !sobra ? 'ok' : 'error');
        v.innerHTML = !falta && !sobra ? '🎉 <b>¡Cuadra perfecto!</b>' : [falta ? `Faltan <b>${fmt.pesos(falta)}</b>` : '', sobra ? `Sobran <b>${fmt.pesos(sobra)}</b>` : ''].filter(Boolean).join(' · ') + '. Revisá antes de cerrar (o anotalo en las notas).';
      };
      $$('tr[data-id] input', m).forEach(i => i.addEventListener('input', calc)); calc();
      const cb = $('#c-contar', m); if (cb) cb.onclick = () => { const c = $('#c-bil', m); c.hidden = !c.hidden; if (!c.hidden && !c.innerHTML) fx().billetes(c, t => { $('input', $('tr[data-tipo="efectivo"]', m)).value = t; calc(); }); };
      $('#c-queda', m).oninput = retira;
      $('[data-no]', m).onclick = () => { m.cerrar(); resolve(false); };
      $$('[data-ir]', m).forEach(b => b.onclick = () => { const n = +b.dataset.ir; if (n === 3 && !efv) $('[data-si]', m).click(); else ir(n); });
      $('[data-si]', m).onclick = async () => {
        const b = $('[data-si]', m); b.disabled = true;
        const arqueo = $$('tr[data-id]', m).map(tr => ({ forma_pago_id: tr.dataset.id, nombre: $('td', tr).textContent.trim().split(' (')[0], esperado: +tr.dataset.esp, declarado: +$('input', tr).value || 0, diferencia: r2((+$('input', tr).value || 0) - +tr.dataset.esp) }));
        const queda = efv ? Math.max(0, +$('#c-queda', m).value || 0) : null;
        const r = await sb.from('caja_turnos').update({ estado: 'cerrado', cerrado: new Date().toISOString(), cerrado_por: APP.user.id, arqueo, efectivo_queda: queda, notas: $('#c-notas', m).value.trim() || null }).eq('id', turno.id);
        if (r.error) { b.disabled = false; fx().sonido('error'); toast(mensajeError(r.error), 'error'); return; }
        m.cerrar(); resolve(true);
        const dif = arqueo.reduce((s, a) => s + a.diferencia, 0);
        fx().telon({ tipo: 'cerrar', emoji: '🌙', titulo: `¡Buen trabajo${nombrePila() ? ', ' + nombrePila() : ''}!`, monto: +esp.total,
          texto: `${esp.ventas} venta${esp.ventas === 1 ? '' : 's'} en este turno${Math.abs(dif) < 1 ? ' · la caja cuadró perfecto ✓' : ''}${queda != null ? ' · quedan ' + fmt.pesos(queda) + ' para mañana' : ''}.`,
          botones: [['Imprimir resumen', () => imprimirCierre(caja, Object.assign({}, turno, { cerrado: new Date().toISOString() }), Object.assign({}, esp, { medios: filas.filter(f => f.ventas).map(f => ({ nombre: f.nombre, monto: f.tipo === 'efectivo' ? f.esperado - esp.efectivo_inicial - esp.movimientos : f.esperado })) }), arqueo, queda, nombrePila())], ['Listo', null, true]] });
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
      <table><tr><td><b>Medio</b></td><td class="r"><b>Esperado</b></td><td class="r"><b>Contado</b></td></tr>${(arqueo || []).map(a => `<tr><td>${esc(a.nombre)}</td><td class="r">${fmt.pesos(a.esperado)}</td><td class="r">${fmt.pesos(a.declarado)}${Math.abs(a.diferencia) >= 1 ? ' (' + (a.diferencia > 0 ? '+' : '') + fmt.pesos(a.diferencia) + ')' : ''}</td></tr>`).join('')}</table>
      ${queda != null ? `<hr><table><tr><td>Queda en caja</td><td class="r">${fmt.pesos(queda)}</td></tr></table>` : ''}`;
    setTimeout(() => window.print(), 50);
  }

  window.TURNO = { cajaDe, abierto, abrir, movimiento, cerrar, imprimirCierre };
})();
