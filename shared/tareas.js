/* Percha · Tareas del local: la rutina (limpiar, vidriera, aire, alarma…) como un juego amable, nunca como una orden.
   · Al abrir la caja: "Para arrancar el día" · al cerrar: "Antes de irte" (no frena el cierre).
   · Durante el día: una tarjetita en la esquina cuando toca una tarea ("Cuando puedas 😊"), con "Listo" o "Más tarde".
   · Sin puntos ni competencias: solo festejos (✨, una frase linda y, con todo hecho, "¡Todo listo por hoy!").
   TAREAS.iniciar({ turno: () => turno }) · TAREAS.momento('apertura' | 'cierre') → Promise · TAREAS.panel() */
(function () {
  const h = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fx = () => window.CAJAFX || { sonido() {}, pop() {}, brillo() {}, telon: () => Promise.resolve() };
  const LINDO = ['¡Gracias! ✨', '¡Qué lindo queda! 💜', '¡Bien ahí! ⭐', '¡Listo! El local te lo agradece 🌷', '¡Genial! 🙌', '¡Impecable! ✨', '¡Sos una genia! 💫'];
  const QUE = { apertura: '☀️ Al abrir', hora: '🕐 Durante el día', cada: '🔁 Cada tanto', cierre: '🌙 Al cerrar' };
  let datos = null, op = {}, reloj = null, tarjeta = null;
  const css = `.tar-lista{display:grid;gap:8px;margin-top:12px}
    .tar{display:grid;grid-template-columns:38px 1fr auto;gap:10px;align-items:center;padding:10px 12px;border:1px solid var(--linea);border-radius:14px;background:var(--superficie-2);transition:all .25s}
    .tar .em{font-size:24px;text-align:center}.tar b{font:600 14.5px var(--f-ui)}.tar small{display:block;color:var(--tinta-3);font-size:12px;margin-top:1px}
    .tar.hecha{background:var(--ok-fondo);border-color:transparent}.tar.hecha b{color:var(--tinta-2)}
    .tar-ok{border:0;border-radius:999px;padding:8px 14px;font:700 13px var(--f-ui);cursor:pointer;background:var(--acento);color:#fff;white-space:nowrap}
    .tar-ok:hover{filter:brightness(1.07)}.tar-listo{color:var(--ok);font:700 13px var(--f-ui);white-space:nowrap;display:flex;gap:6px;align-items:center}
    .tar-listo button{border:0;background:none;color:var(--tinta-4);cursor:pointer;font-size:12px;text-decoration:underline}
    .tar-barra{height:10px;border-radius:99px;background:var(--relleno-2);overflow:hidden;margin:6px 0 2px}.tar-barra i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--acento),#e58fb3);transition:width .6s cubic-bezier(.2,.8,.2,1)}
    .tar-sec{font:700 12px var(--f-ui);color:var(--tinta-3);letter-spacing:.04em;margin:14px 0 -2px;text-transform:uppercase}
    .tar-mas{position:fixed;font:800 18px var(--f-titulo);color:var(--acento);pointer-events:none;z-index:99999;animation:tarSube 1.1s ease-out forwards}
    @keyframes tarSube{0%{opacity:0;transform:translateY(6px) scale(.8)}20%{opacity:1;transform:translateY(-6px) scale(1.1)}100%{opacity:0;transform:translateY(-46px) scale(1)}}
    /* la tarjetita de durante el día: se despega de las tarjetas de productos con un halo de neón suave que late y un borde de color que se mueve */
    .tar-tarjeta{position:fixed;left:18px;bottom:18px;z-index:9000;max-width:360px;background:linear-gradient(140deg,#fff 0%,#f7f1ff 55%,#fdf0f6 100%);border-radius:20px;padding:14px 16px 14px 14px;display:grid;grid-template-columns:52px 1fr;gap:3px 12px;isolation:isolate;animation:tarEntra .5s cubic-bezier(.2,.9,.3,1.2),tarHalo 2.8s ease-in-out .5s infinite}
    .tar-tarjeta::before{content:'';position:absolute;inset:-2px;border-radius:22px;padding:2px;background:linear-gradient(120deg,var(--acento),#e58fb3,#9db4ff,var(--acento));background-size:300% 300%;animation:tarBorde 6s linear infinite;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;z-index:-1}
    .tar-tarjeta .em{font-size:28px;grid-row:span 4;align-self:center;width:48px;height:48px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle,#fff 40%,rgba(var(--acento-rgb),.14));box-shadow:0 0 16px rgba(var(--acento-rgb),.35)}
    .tar-tarjeta .tag{font:800 10.5px var(--f-ui);letter-spacing:.09em;text-transform:uppercase;color:var(--acento)}
    .tar-tarjeta b{font:700 15px var(--f-ui);color:var(--tinta)}.tar-tarjeta small{color:var(--tinta-2);font-size:12.5px}
    .tar-tarjeta .bts{display:flex;gap:6px;margin-top:8px}.tar-tarjeta .bts button{border:0;border-radius:999px;padding:8px 14px;font:700 12.5px var(--f-ui);cursor:pointer}
    .tar-tarjeta .bts .si{background:linear-gradient(180deg,rgba(var(--acento-rgb),1),rgba(var(--acento-rgb),.85));color:#fff;box-shadow:0 4px 14px rgba(var(--acento-rgb),.4)}.tar-tarjeta .bts .luego{background:rgba(255,255,255,.8);color:var(--tinta-2);box-shadow:inset 0 0 0 1px var(--linea)}
    @keyframes tarHalo{0%,100%{box-shadow:0 0 0 3px rgba(var(--acento-rgb),.10),0 0 18px rgba(var(--acento-rgb),.30),0 16px 44px rgba(21,23,28,.22)}50%{box-shadow:0 0 0 6px rgba(var(--acento-rgb),.16),0 0 36px rgba(var(--acento-rgb),.55),0 16px 44px rgba(21,23,28,.22)}}
    @keyframes tarBorde{0%{background-position:0% 50%}100%{background-position:300% 50%}}
    @media (prefers-reduced-motion:reduce){.tar-tarjeta,.tar-tarjeta::before{animation:none}}
    @keyframes tarEntra{from{opacity:0;transform:translateY(20px) scale(.95)}to{opacity:1;transform:none}}
    .tar-chip{display:inline-flex;align-items:center;gap:6px}.tar-chip .anillo{width:18px;height:18px;border-radius:50%;background:conic-gradient(var(--acento) calc(var(--p)*1%),var(--relleno-2) 0)}`;
  function estilos() { if (document.getElementById('tar-css')) return; const s = document.createElement('style'); s.id = 'tar-css'; s.textContent = css; document.head.appendChild(s); }
  const hoyTxt = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const minutos = hhmm => { const [a, b] = String(hhmm || '0:0').split(':'); return +a * 60 + +b; };
  const ahoraMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const hecha = t => (t.hechas || []).length > 0;
  // "Más tarde": no vuelve a aparecer por 30 minutos (en este equipo)
  const LS = id => 'percha_tarea_luego_' + id + '_' + hoyTxt();
  const pospuesta = t => { try { return +(localStorage.getItem(LS(t.id)) || 0) > Date.now(); } catch (_) { return false; } };
  const posponer = t => { try { localStorage.setItem(LS(t.id), String(Date.now() + 30 * 60e3)); } catch (_) {} };

  async function cargar() {
    const { data, error } = await sb.rpc('tareas_hoy', { e: APP.empresa.id });
    if (!error && data) datos = data; pintarChip(); return datos;
  }
  const delDia = () => (datos && datos.tareas) || [];
  const progreso = () => { const ts = delDia(); return { hechas: ts.filter(hecha).length, total: ts.length }; };
  function pintarChip() {
    const b = document.getElementById('btn-tareas'); if (!b) return;
    const p = progreso(); if (!p.total) { b.hidden = true; return; }
    b.hidden = false; const pct = Math.round(100 * p.hechas / p.total);
    b.innerHTML = `<span class="tar-chip"><span class="anillo" style="--p:${pct}"></span>${p.hechas === p.total ? '✨ ¡Todo listo!' : `Tareas ${p.hechas}/${p.total}`}</span>`;
  }
  // un ✨ que sube desde el botón
  function brillito(el) { if (!el) return; const r = el.getBoundingClientRect(), x = document.createElement('div'); x.className = 'tar-mas'; x.textContent = '✨'; x.style.left = (r.left + r.width / 2 - 24) + 'px'; x.style.top = (r.top - 4) + 'px'; document.body.appendChild(x); setTimeout(() => x.remove(), 1200); }
  async function marcar(t, el) {
    const turno = op.turno && op.turno();
    const antes = progreso();
    const { error } = await sb.from('tareas_hechas').insert(APP.conEmpresa({ tarea_id: t.id, puntos: 0, turno_id: turno ? turno.id : null, hecha_por: APP.user.id }));
    if (error) { APP.toast(APP.mensajeError(error), 'error'); return false; }
    fx().sonido('ok'); brillito(el); APP.toast(LINDO[Math.floor(Math.random() * LINDO.length)]);
    await cargar();
    const p = progreso();
    if (p.total && p.hechas === p.total && antes.hechas < antes.total) setTimeout(() => fx().telon({ tipo: 'abrir', emoji: '✨', titulo: '¡Todo listo por hoy!', texto: 'Hicieron que el local brille. ¡Gracias! 💜', auto: 2600 }), 400);
    return true;
  }
  async function deshacer(t) {
    const mia = (t.hechas || []).filter(x => x.mia).pop(); if (!mia) return;
    const { error } = await sb.from('tareas_hechas').delete().eq('id', mia.id);
    if (error) { APP.toast(APP.mensajeError(error), 'error'); return; }
    await cargar();
  }
  const fila = t => {
    const quien = (t.hechas || []).slice(-1)[0];
    const cuando = t.momento === 'hora' ? 'a las ' + t.hora : t.momento === 'cada' ? 'cada ' + (t.cada_min >= 60 ? (t.cada_min / 60) + ' h' : t.cada_min + ' min') : '';
    return `<div class="tar${hecha(t) && t.momento !== 'cada' ? ' hecha' : ''}" data-t="${t.id}"><span class="em">${h(t.emoji)}</span><div><b>${h(t.nombre)}</b><small>${h([t.ayuda, cuando].filter(Boolean).join(' · '))}</small></div>
      ${hecha(t) && t.momento !== 'cada' ? `<span class="tar-listo">✓ ${h(quien && quien.por ? quien.por.split(' ')[0] : 'Hecha')}${quien && quien.mia ? ' <button data-des>deshacer</button>' : ''}</span>`
        : `<button class="tar-ok" data-ok>${t.momento === 'cada' && hecha(t) ? '✓ Otra vez' : '✓ Listo'}</button>`}</div>`;
  };
  function enganchar(cont, alCambiar) {
    cont.querySelectorAll('[data-t]').forEach(r => {
      const t = delDia().find(x => x.id === r.dataset.t); if (!t) return;
      const b = r.querySelector('[data-ok]'); if (b) b.onclick = async () => { b.disabled = true; if (await marcar(t, b)) alCambiar(); else b.disabled = false; };
      const d = r.querySelector('[data-des]'); if (d) d.onclick = async () => { await deshacer(t); alCambiar(); };
    });
  }
  // ---------- al abrir y al cerrar la caja ----------
  async function momento(cual) {
    estilos(); if (!datos) await cargar(); if (!datos) return;
    const ts = delDia().filter(t => t.momento === cual); if (!ts.length || ts.every(hecha)) return;
    return new Promise(resolve => {
      const m = APP.modal(`<h2>${cual === 'apertura' ? '☀️ Para arrancar el día' : '🌙 Antes de irte'}</h2>
        <p class="sub">${cual === 'apertura' ? 'Unas cositas para que el local quede lindo. Marcá las que vas haciendo, a tu ritmo 😊' : 'Lo último del día. Marcá las que ya hiciste; las demás, cuando puedas 💜'}</p>
        <div class="tar-lista" id="tar-l"></div><div class="tar-barra"><i id="tar-b"></i></div><small class="sub" id="tar-p"></small>
        <div class="pie"><button class="btn primario" data-seguir>${cual === 'apertura' ? '¡A vender! 🍀' : 'Seguir al cierre →'}</button></div>`, { fijo: true });
      const pintar = () => { const l = delDia().filter(t => t.momento === cual), n = l.filter(hecha).length; $('#tar-l', m).innerHTML = l.map(fila).join(''); $('#tar-b', m).style.width = Math.round(100 * n / l.length) + '%'; $('#tar-p', m).textContent = n === l.length ? '¡Todo listo! ✨' : `${n} de ${l.length}`; enganchar($('#tar-l', m), pintar); };
      const $ = (s, c) => c.querySelector(s);
      pintar();
      $('[data-seguir]', m).onclick = () => { m.cerrar(); resolve(); };
    });
  }
  // ---------- el panel: todo lo de hoy ----------
  async function panel() {
    estilos(); await cargar(); if (!datos) return;
    const m = APP.modal('<div id="tar-panel"></div>', { fijo: true });
    const md = m.querySelector('.modal'); if (md) md.style.maxWidth = '620px';
    const pintar = () => {
      const p = progreso(), cont = m.querySelector('#tar-panel');
      cont.innerHTML = `<h2>✨ Tareas de hoy</h2><p class="sub">${p.hechas === p.total ? '¡Todo listo por hoy! Gracias por cuidar el local 💜' : `Van ${p.hechas} de ${p.total}. Sin apuro, a tu ritmo 😊`}</p>
        <div class="tar-barra"><i style="width:${p.total ? Math.round(100 * p.hechas / p.total) : 0}%"></i></div>
        ${['apertura', 'hora', 'cada', 'cierre'].map(k => { const l = delDia().filter(t => t.momento === k); return l.length ? `<div class="tar-sec">${QUE[k]}</div><div class="tar-lista" style="margin-top:8px">${l.map(fila).join('')}</div>` : ''; }).join('')}
        <div class="pie"><button class="btn primario" data-cerrar>Listo</button></div>`;
      enganchar(cont, pintar); cont.querySelector('[data-cerrar]').onclick = () => m.cerrar();
    };
    pintar();
  }
  // ---------- durante el día: la tarjetita amable ----------
  function debida(t, turno) {
    if (pospuesta(t)) return false;
    const ahora = ahoraMin();
    if (t.momento === 'hora') return !hecha(t) && ahora >= minutos(t.hora);
    if (t.momento === 'cada') {
      const ult = (t.hechas || []).slice(-1)[0], desde = ult ? new Date(ult.hecha) : turno && turno.abierto ? new Date(turno.abierto) : null;
      return !!desde && (Date.now() - desde.getTime()) / 60e3 >= (t.cada_min || 120);
    }
    return false;
  }
  function mostrarTarjeta(t, prueba) {
    estilos(); if (tarjeta) tarjeta.remove();
    tarjeta = document.createElement('div'); tarjeta.className = 'tar-tarjeta';
    tarjeta.innerHTML = `<span class="em">${h(t.emoji)}</span><span class="tag">✨ Recordatorio</span><b>${h(t.nombre)}</b><small>${t.ayuda ? h(t.ayuda) + ' ' : ''}Cuando puedas 😊</small><div class="bts"><button class="si">✓ Listo</button><button class="luego">Más tarde</button></div>`;
    document.body.appendChild(tarjeta);
    const cerrar = () => { if (tarjeta) { tarjeta.remove(); tarjeta = null; } };
    if (prueba) { tarjeta.querySelector('.si').onclick = ev => { brillito(ev.currentTarget); fx().sonido('ok'); setTimeout(cerrar, 500); }; tarjeta.querySelector('.luego').onclick = cerrar; return; }
    tarjeta.querySelector('.si').onclick = async ev => { const b = ev.currentTarget; b.disabled = true; if (await marcar(t, b)) cerrar(); else b.disabled = false; };
    tarjeta.querySelector('.luego').onclick = () => { posponer(t); cerrar(); };
  }
  async function revisar() {
    const turno = op.turno && op.turno(); if (!turno || tarjeta || document.querySelector('.modal-fondo') || document.hidden) return;
    await cargar(); const t = delDia().find(x => debida(x, turno)); if (t) mostrarTarjeta(t);
  }
  function iniciar(o) {
    op = o || {}; estilos(); cargar();
    const b = document.getElementById('btn-tareas'); if (b) b.onclick = panel;
    if (reloj) clearInterval(reloj); reloj = setInterval(revisar, 60e3); setTimeout(revisar, 20e3);
  }
  window.TAREAS = { iniciar, momento, panel, cargar, pintarChip, revisar, probar: t => mostrarTarjeta(t, true) };
})();
