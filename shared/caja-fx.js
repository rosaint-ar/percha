/* Percha · Caja más amigable: sonidos (generados en el navegador, sin archivos), telón animado al abrir y cerrar la caja,
   y contador de billetes. Los sonidos se apagan o prenden por equipo (localStorage 'percha_sonido').
   Los sonidos imitan una caja registradora, pero suaves (volumen bajo, para no molestar en el local):
   CAJAFX.sonido('venta'|'abrir'|'cerrar'|'pedido'|'ok'|'error') · CAJAFX.sonidoActivo() · CAJAFX.alternarSonido()
   CAJAFX.telon({ tipo:'abrir'|'cerrar', emoji, titulo, texto, monto, botones:[[texto, fn, primario]] , auto:ms }) → Promise
   CAJAFX.billetes(elemento, alCambiar) → { total() }  (cuenta billetes por denominación) */
(function () {
  const KEY = 'percha_sonido';
  const sonidoActivo = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch (_) { return true; } };
  const alternarSonido = () => { const on = !sonidoActivo(); try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (_) { } if (on) sonido('ok'); return on; };
  let ctx = null, salida = null, ruidoBuf = null;
  const VOL = 0.55;   // volumen general: bajo a propósito
  function nota(f, t0, dur, tipo, vol, ataque) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = tipo || 'sine'; o.frequency.setValueAtTime(f, t0);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + (ataque || 0.006)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(salida); o.start(t0); o.stop(t0 + dur + 0.03);
  }
  // campanita metálica: fundamental + parciales inarmónicos (suena a timbre de caja registradora)
  function campana(f, t0, dur, vol) { [[1, 1], [2.76, 0.45], [5.4, 0.18], [8.93, 0.07]].forEach(([k, v]) => nota(f * k, t0, dur / Math.sqrt(k), 'sine', vol * v, 0.003)); }
  // ruido filtrado: el "cha" metálico y el deslizar del cajón
  function ruido(t0, dur, filtro, f0, f1, q, vol) {
    if (!ruidoBuf) { ruidoBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = ruidoBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = ruidoBuf; fl.type = filtro; fl.Q.value = q; fl.frequency.setValueAtTime(f0, t0); fl.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.02, dur / 3)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(fl).connect(g).connect(salida); s.start(t0); s.stop(t0 + dur + 0.02);
  }
  // golpe sordo: el cajón que hace tope
  function golpe(t0, vol) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(150, t0); o.frequency.exponentialRampToValueAtTime(55, t0 + 0.12);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16); o.connect(g).connect(salida); o.start(t0); o.stop(t0 + 0.2); }
  function sonido(tipo) {
    if (!sonidoActivo()) return;
    try {
      if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); salida = ctx.createGain(); salida.gain.value = VOL; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000; salida.connect(lp).connect(ctx.destination); }
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime + 0.02;
      if (tipo === 'venta') {            // ¡cha-ching! suave: el "cha" metálico y la campanita
        ruido(t, 0.07, 'bandpass', 5200, 3800, 1.4, 0.12); ruido(t + 0.05, 0.05, 'bandpass', 4200, 3000, 1.4, 0.08);
        campana(1568, t + 0.1, 0.9, 0.09); campana(2093, t + 0.13, 1.1, 0.07);
      } else if (tipo === 'abrir') {     // el cajón que se abre (desliza y hace tope) y un "ding" de bienvenida
        ruido(t, 0.28, 'lowpass', 900, 2400, 0.8, 0.07); golpe(t + 0.26, 0.22); ruido(t + 0.26, 0.06, 'bandpass', 3000, 2000, 2, 0.05);
        campana(1318.5, t + 0.42, 1.2, 0.08); campana(1975.5, t + 0.58, 1.4, 0.06);
      } else if (tipo === 'cerrar') {    // el cajón que se cierra (desliza, clac) y dos notas que bajan, tranquilas
        ruido(t, 0.24, 'lowpass', 2400, 800, 0.8, 0.07); golpe(t + 0.22, 0.26); ruido(t + 0.22, 0.05, 'bandpass', 2500, 1800, 2, 0.06);
        campana(1046.5, t + 0.45, 1.3, 0.07); campana(784, t + 0.7, 1.8, 0.07);
      } else if (tipo === 'pedido') {    // llegó un pedido online: dos notas de marimba hacia arriba
        nota(784, t, 0.35, 'sine', 0.12); nota(1568, t, 0.12, 'sine', 0.03); nota(1174.7, t + 0.13, 0.55, 'sine', 0.12); nota(2349, t + 0.13, 0.15, 'sine', 0.03);
      } else if (tipo === 'ok') { nota(1046.5, t, 0.18, 'sine', 0.06); nota(1568, t + 0.07, 0.3, 'sine', 0.05); }
      else if (tipo === 'error') { nota(330, t, 0.18, 'triangle', 0.06); nota(262, t + 0.16, 0.28, 'triangle', 0.06); }
    } catch (_) { }
  }

  // ---------- telón ----------
  const css = `
  .cfx-telon{position:fixed;inset:0;z-index:9000;display:grid;place-items:center;overflow:hidden;color:#fff;cursor:default}
  .cfx-telon .persiana{position:absolute;inset:0;background:repeating-linear-gradient(180deg,rgba(255,255,255,.07) 0 3px,transparent 3px 26px),linear-gradient(160deg,var(--acento),#2c2346);}
  .cfx-telon.abrir .persiana{animation:persiana-sube 1.1s cubic-bezier(.7,0,.3,1) .9s forwards}
  .cfx-telon.cerrar .persiana{transform:translateY(-100%);animation:persiana-baja .9s cubic-bezier(.6,0,.2,1) forwards}
  .cfx-telon .caja-tx{position:relative;text-align:center;padding:24px;max-width:520px;animation:tx-entra .6s ease-out both}
  .cfx-telon.cerrar .caja-tx{animation-delay:.7s}
  .cfx-telon .emoji{font-size:64px;line-height:1;display:inline-block;animation:emoji-salta 1s ease-out .2s both}
  .cfx-telon h2{color:#fff;font-size:30px;margin:14px 0 6px;letter-spacing:-.03em}
  .cfx-telon p{color:rgba(255,255,255,.85);font-size:15px;margin:0}
  .cfx-telon .monto{font:800 44px var(--f-titulo);letter-spacing:-.04em;margin:12px 0 2px;font-variant-numeric:tabular-nums}
  .cfx-telon .botones{display:flex;gap:10px;justify-content:center;margin-top:22px;flex-wrap:wrap}
  .cfx-telon .botones button{border:1px solid rgba(255,255,255,.4);background:rgba(255,255,255,.12);color:#fff;font:700 14px var(--f-ui);padding:11px 20px;border-radius:12px;cursor:pointer}
  .cfx-telon .botones button.primario{background:#fff;color:var(--acento);border-color:#fff}
  .cfx-telon.abrir .caja-tx{animation:tx-sale .5s ease-in .75s forwards, tx-entra .5s ease-out both}
  .cfx-telon .chispa{position:absolute;font-size:22px;animation:chispa 1.6s ease-out forwards;opacity:0}
  @keyframes persiana-sube{to{transform:translateY(-100%)}}
  @keyframes persiana-baja{from{transform:translateY(-100%)}to{transform:none}}
  @keyframes tx-entra{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}
  @keyframes tx-sale{to{opacity:0;transform:translateY(-30px)}}
  @keyframes emoji-salta{0%{transform:scale(.3) rotate(-20deg)}60%{transform:scale(1.15) rotate(6deg)}100%{transform:none}}
  @keyframes chispa{0%{opacity:0;transform:translate(0,0) scale(.6)}15%{opacity:1}100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(1.1) rotate(var(--r))}}
  @keyframes pop{0%{transform:scale(.7);opacity:0}60%{transform:scale(1.08);opacity:1}100%{transform:none}}
  .festejo-pop{animation:pop .5s cubic-bezier(.3,1.6,.5,1) both;display:inline-block}
  @keyframes brillo{0%,100%{box-shadow:var(--sombra-flotante)}50%{box-shadow:var(--sombra-flotante),0 0 0 5px rgba(var(--acento-rgb),.16),0 0 36px rgba(var(--acento-rgb),.4)}}
  .cfx-brillo{animation:brillo 1.6s ease-in-out 2}
  @media (prefers-reduced-motion:reduce){.cfx-telon *,.festejo-pop,.cfx-brillo{animation-duration:.01ms!important;animation-delay:0s!important}}
  /* contador de billetes */
  .billetes{display:grid;grid-template-columns:repeat(2,1fr);gap:6px 14px;margin:8px 0 4px}
  .billetes .bl{display:grid;grid-template-columns:72px auto 1fr;gap:8px;align-items:center;font-size:13px}
  .billetes .bl b{font:700 13px var(--f-mono)}
  .billetes .paso{display:inline-flex;align-items:center;border:1px solid var(--linea);border-radius:9px;overflow:hidden}
  .billetes .paso button{border:0;background:var(--relleno);width:28px;height:28px;cursor:pointer;font:700 15px var(--f-ui)}
  .billetes .paso input{width:42px;border:0;text-align:center;font:600 13px var(--f-mono);background:transparent;padding:0}
  .billetes .sub-bl{text-align:right;color:var(--tinta-3);font:500 12px var(--f-mono)}
  .billetes .bl.monedas{grid-column:1/-1;grid-template-columns:72px 1fr}
  @media (max-width:560px){.billetes{grid-template-columns:1fr}}`;
  let cssPuesto = false;
  const ponerCss = () => { if (cssPuesto) return; cssPuesto = true; const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); };
  const pesos = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function telon(o) {
    ponerCss();
    return new Promise(resolve => {
      const el = document.createElement('div'); el.className = 'cfx-telon ' + (o.tipo || 'abrir');
      el.innerHTML = `<div class="persiana"></div><div class="caja-tx"><span class="emoji">${o.emoji || '✨'}</span><h2>${esc(o.titulo || '')}</h2>
        ${o.monto != null ? '<div class="monto">$ 0</div>' : ''}<p>${o.texto || ''}</p>${(o.botones || []).length ? '<div class="botones"></div>' : ''}</div>`;
      document.body.appendChild(el);
      const fin = v => { if (!el.isConnected) return; el.remove(); resolve(v); };
      (o.botones || []).forEach(([t, fn, prim]) => { const b = document.createElement('button'); b.textContent = t; if (prim) b.className = 'primario'; b.onclick = () => { if (fn) fn(); if (!b.dataset.queda) fin(t); }; el.querySelector('.botones').appendChild(b); });
      // chispas
      const em = o.tipo === 'cerrar' ? ['⭐', '✨', '💜'] : ['✨', '🪙', '💜', '⭐'];
      for (let i = 0; i < 14; i++) { const c = document.createElement('span'); c.className = 'chispa'; c.textContent = em[i % em.length];
        c.style.left = '50%'; c.style.top = '46%'; const a = Math.random() * Math.PI * 2, d = 140 + Math.random() * 180;
        c.style.setProperty('--dx', Math.cos(a) * d + 'px'); c.style.setProperty('--dy', Math.sin(a) * d + 'px'); c.style.setProperty('--r', (Math.random() * 120 - 60) + 'deg');
        c.style.animationDelay = (o.tipo === 'cerrar' ? 0.9 : 0.15) + Math.random() * 0.3 + 's'; el.appendChild(c); }
      // el monto sube de 0 al total
      const mEl = el.querySelector('.monto');
      if (mEl) { const t0 = performance.now() + (o.tipo === 'cerrar' ? 800 : 200), dur = 1100;
        const paso = now => { const k = Math.min(1, Math.max(0, (now - t0) / dur)), ease = 1 - Math.pow(1 - k, 3); mEl.textContent = pesos(Math.round(o.monto * ease)); if (k < 1 && el.isConnected) requestAnimationFrame(paso); };
        requestAnimationFrame(paso); }
      sonido(o.tipo === 'cerrar' ? 'cerrar' : 'abrir');
      if (o.auto) setTimeout(() => fin(null), o.auto);
      if (!(o.botones || []).length) el.onclick = () => fin(null);
    });
  }

  // ---------- contador de billetes ----------
  const DENOM = [20000, 10000, 2000, 1000, 500, 200, 100];
  function billetes(cont, alCambiar) {
    ponerCss();
    cont.innerHTML = `<div class="billetes">${DENOM.map(d => `<div class="bl" data-d="${d}"><b>${pesos(d)}</b><span class="paso"><button type="button" data-m>−</button><input inputmode="numeric" value="0"><button type="button" data-p>+</button></span><span class="sub-bl">$ 0</span></div>`).join('')}
      <div class="bl monedas"><b>Monedas</b><input type="number" min="0" step="10" value="0" placeholder="Monedas y otros" style="max-width:160px"></div></div>`;
    const total = () => DENOM.reduce((s, d) => s + d * (+cont.querySelector(`[data-d="${d}"] input`).value || 0), 0) + (+cont.querySelector('.monedas input').value || 0);
    const act = () => { DENOM.forEach(d => { cont.querySelector(`[data-d="${d}"] .sub-bl`).textContent = pesos(d * (+cont.querySelector(`[data-d="${d}"] input`).value || 0)); }); if (alCambiar) alCambiar(total()); };
    cont.querySelectorAll('.bl[data-d]').forEach(r => { const i = r.querySelector('input');
      r.querySelector('[data-m]').onclick = () => { i.value = Math.max(0, (+i.value || 0) - 1); act(); };
      r.querySelector('[data-p]').onclick = () => { i.value = (+i.value || 0) + 1; act(); };
      i.oninput = () => { i.value = i.value.replace(/\D/g, ''); act(); }; });
    cont.querySelector('.monedas input').oninput = act;
    return { total };
  }

  window.CAJAFX = { sonido, sonidoActivo, alternarSonido, telon, billetes, pop: el => { if (!el) return; ponerCss(); el.classList.remove('festejo-pop'); void el.offsetWidth; el.classList.add('festejo-pop'); },
    brillo: el => { if (!el) return; ponerCss(); el.classList.remove('cfx-brillo'); void el.offsetWidth; el.classList.add('cfx-brillo'); } };
})();
