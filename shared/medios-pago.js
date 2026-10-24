/* Percha · Medios de pago: reconoce la empresa (Mercado Pago, MODO, NAVE, Naranja…) y el banco,
   los agrupa (efectivo, transferencia, débito, tarjeta y cuotas, billeteras y QR, online, otros)
   y dibuja la botonera de cobro: arriba los más usados y abajo todo ordenado por grupo y empresa. */
(function () {
  const PROV = {
    mercadopago: { n: 'Mercado Pago', t: 'MP', bg: '#009EE3', fg: '#fff', alias: ['mercado pago', 'mpago'] },
    mercadolibre: { n: 'Mercado Libre', t: 'ML', bg: '#FFE600', fg: '#2D3277', alias: ['mercado libre'] },
    tiendanube: { n: 'Tienda Nube', t: 'TN', bg: '#2B3990', fg: '#fff', alias: ['tienda nube', 'pago nube'] },
    modo: { n: 'MODO', t: 'MODO', bg: '#0FA37F', fg: '#fff', alias: ['modo'] },
    nave: { n: 'NAVE', t: 'NAVE', bg: '#FF5F00', fg: '#fff', alias: ['nave'] },
    naranja: { n: 'Naranja X', t: 'NX', bg: '#FE5000', fg: '#fff', alias: ['tarjeta naranja', 'naranja x', 'naranja'] },
    gocuotas: { n: 'GO Cuotas', t: 'GO', bg: '#5B2A86', fg: '#fff', alias: [] },
    payway: { n: 'Payway', t: 'PW', bg: '#00A3E0', fg: '#fff', alias: ['payway'] },
    viumi: { n: 'Viumi', t: 'VI', bg: '#7B3FE4', fg: '#fff', alias: ['viumi'] },
    uala: { n: 'Ualá', t: 'UA', bg: '#3E6BFF', fg: '#fff', alias: ['uala'] },
    cuentadni: { n: 'Cuenta DNI', t: 'DNI', bg: '#00A0DF', fg: '#fff', alias: ['cuenta dni'] },
    personalpay: { n: 'Personal Pay', t: 'PP', bg: '#00B3E3', fg: '#fff', alias: ['personal pay'] },
    getnet: { n: 'Getnet', t: 'GN', bg: '#EC0000', fg: '#fff', alias: ['getnet'] },
    cupon: { n: 'Rapipago / Pago Fácil', t: 'RP', bg: '#E4002B', fg: '#fff', alias: [] },
  };
  const BANCO = {
    galicia: { n: 'Galicia', t: 'G', bg: '#FA6400' }, macro: { n: 'Macro', t: 'M', bg: '#0A3A7A' }, santander: { n: 'Santander', t: 'S', bg: '#EC0000' },
    nacion: { n: 'Banco Nación', t: 'BN', bg: '#1A5DA6' }, provincia: { n: 'Banco Provincia', t: 'BP', bg: '#00754A' }, bbva: { n: 'BBVA', t: 'BBVA', bg: '#004481' },
    credicoop: { n: 'Credicoop', t: 'CC', bg: '#00A54F' }, icbc: { n: 'ICBC', t: 'IC', bg: '#C4161C' }, brubank: { n: 'Brubank', t: 'BB', bg: '#6A2BD8' },
    hsbc: { n: 'HSBC', t: 'HS', bg: '#DB0011' }, bancor: { n: 'Bancor', t: 'BC', bg: '#0072CE' }, supervielle: { n: 'Supervielle', t: 'SV', bg: '#D3002D' }, patagonia: { n: 'Patagonia', t: 'PA', bg: '#0C4DA2' },
  };
  const GRUPO = {
    efectivo: { n: 'Efectivo', t: '$', bg: '#1F7A5C' },
    transferencia: { n: 'Transferencia', t: '⇄', bg: '#3B6FD8' },
    debito: { n: 'Débito', t: 'DB', bg: '#475569' },
    credito: { n: 'Tarjeta y cuotas', t: 'CR', bg: '#6B5CA5' },
    billetera: { n: 'Billeteras y QR', t: 'QR', bg: '#0F766E' },
    online: { n: 'Online', t: '@', bg: '#64748B' },
    otro: { n: 'Otros', t: '•', bg: '#94A3B8' },
  };
  const ORDEN = ['efectivo', 'transferencia', 'debito', 'credito', 'billetera', 'online', 'otro'];
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const grupoDe = f => GRUPO[f.grupo] ? f.grupo : (f.tipo === 'efectivo' ? 'efectivo' : f.tipo === 'transferencia' ? 'transferencia' : f.tipo === 'online' ? 'online' : 'otro');
  // el "logo": círculo con la sigla de la empresa (o del banco, o del grupo) en su color
  function logo(f, chico) {
    const p = PROV[f.proveedor], b = BANCO[f.banco], g = GRUPO[grupoDe(f)];
    const x = p || (b ? { t: b.t, bg: b.bg, fg: '#fff' } : { t: g.t, bg: g.bg, fg: '#fff' });
    const largo = x.t.length >= 4 ? ' largo' : x.t.length === 3 ? ' medio' : '';
    return `<span class="mp-logo${chico ? ' chico' : ''}${largo}" style="background:${x.bg};color:${x.fg || '#fff'}" title="${esc(p ? p.n : b ? b.n : g.n)}">${esc(x.t)}</span>`;
  }
  // nombre corto para el botón: sin el nombre de la empresa repetido ("3 cuotas - Mercado Pago" → "3 cuotas")
  function corto(f) {
    const p = PROV[f.proveedor]; let s = f.nombre || '';
    if (p) for (const a of [p.n.toLowerCase(), ...p.alias]) s = s.replace(new RegExp('\\s*[-·(]?\\s*' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\)?\\s*', 'ig'), ' ');
    s = s.replace(/^[\s\-·]+|[\s\-·]+$/g, '').replace(/\s{2,}/g, ' ');
    return s.length >= 2 ? s : f.nombre;
  }
  function detalle(f, listaDe) {
    const ls = (f.listas && f.listas.length ? f.listas : f.lista_id ? [f.lista_id] : []).map(id => (window.MEDIOS.listas || {})[id]).filter(Boolean);
    const txtListas = ls.length === 1 ? 'precio ' + ls[0].nombre : ls.length > 1 ? 'precios ' + ls.map(x => x.nombre).join(' / ') : '';
    return [f.cuotas > 1 ? f.cuotas + ' cuotas' : '', f.recargo_pct ? '+' + f.recargo_pct + '%' : '', txtListas].filter(Boolean).join(' · ');
  }
  // botonera de cobro (data-f = id del medio; data-cred = nota de crédito / gift card)
  function botonera(formas, usos, listaDe) {
    usos = usos || {};
    const boton = (f, grande) => `<button type="button" class="mp-btn${grande ? ' grande' : ''}" data-f="${f.id}">${logo(f)}<span class="mp-txt"><b>${esc(grupoDe(f) === 'credito' && PROV[f.proveedor] ? PROV[f.proveedor].n + ' · ' + corto(f) : f.nombre)}</b>${detalle(f, listaDe) ? `<small>${esc(detalle(f, listaDe))}</small>` : ''}</span></button>`;
    const cred = '<button type="button" class="mp-btn" data-cred><span class="mp-logo" style="background:#B45309;color:#fff">NC</span><span class="mp-txt"><b>Nota de crédito / gift card</b><small>con código</small></span></button>';
    if (formas.length <= 6) return `<div class="mp"><div class="mp-grid">${formas.map(f => boton(f, true)).join('')}${cred}</div></div>`;
    const top = formas.filter(f => grupoDe(f) !== 'online').slice().sort((a, b) => (usos[b.id] || 0) - (usos[a.id] || 0) || (a.orden || 0) - (b.orden || 0)).slice(0, 4).filter(f => (usos[f.id] || 0) > 0);
    let h = top.length ? `<div class="mp-tit">Más usados</div><div class="mp-grid mp-top">${top.map(f => boton(f, true)).join('')}</div>` : '';
    h += '<div class="mp-tit">Todos</div>';
    const ordenar = (a, b) => ORDEN.indexOf(grupoDe(a)) - ORDEN.indexOf(grupoDe(b)) || (a.cuotas || 1) - (b.cuotas || 1) || (a.orden || 0) - (b.orden || 0);
    // básicos (efectivo, transferencia, débito, billeteras): juntos en una grilla, cada uno con su logo
    const basicos = formas.filter(f => ['efectivo', 'transferencia', 'debito', 'billetera'].includes(grupoDe(f))).sort(ordenar);
    if (basicos.length) h += `<div class="mp-grid">${basicos.map(f => boton(f)).join('')}</div>`;
    // tarjetas y cuotas: una fila por empresa (Mercado Pago, NAVE, Naranja…) con sus cuotas como chips
    const tarjetas = formas.filter(f => grupoDe(f) === 'credito').sort(ordenar);
    if (tarjetas.length) {
      const porProv = new Map(); tarjetas.forEach(f => { const k = f.proveedor || '_' + f.id; if (!porProv.has(k)) porProv.set(k, []); porProv.get(k).push(f); });
      h += `<details class="mp-grupo" open><summary>${esc(GRUPO.credito.n)}<span>${tarjetas.length}</span></summary>`;
      porProv.forEach((lista, k) => {
        const pr = PROV[k];
        h += `<div class="mp-fila">${logo(lista[0])}<span class="mp-prov">${esc(pr ? pr.n : lista[0].nombre)}</span><div class="mp-chips">${lista.map(f => `<button type="button" class="mp-chip" data-f="${f.id}">${esc(pr ? (corto(f).toLowerCase() === pr.n.toLowerCase() ? (f.cuotas > 1 ? f.cuotas + ' cuotas' : 'Cobrar') : corto(f)) : (f.cuotas > 1 ? f.cuotas + ' cuotas' : 'Cobrar'))}</button>`).join('')}</div></div>`;
      });
      h += '</details>';
    }
    // online (lo cobra la web): plegado
    const online = formas.filter(f => grupoDe(f) === 'online').sort(ordenar);
    if (online.length) h += `<details class="mp-grupo"><summary>${esc(GRUPO.online.n)} <small>ventas que se cobraron por la web</small><span>${online.length}</span></summary><div class="mp-grid">${online.map(f => boton(f)).join('')}</div></details>`;
    // otros + nota de crédito
    const otros = formas.filter(f => grupoDe(f) === 'otro').sort(ordenar);
    h += `<div class="mp-grid">${otros.map(f => boton(f)).join('')}${cred}</div>`;
    return `<div class="mp">${h}</div>`;
  }
  // estilos (una sola vez, sirven en la caja y en configuración)
  if (!document.getElementById('estilo-medios')) {
    const st = document.createElement('style'); st.id = 'estilo-medios';
    st.textContent = `
      .mp{display:grid;gap:8px;margin-top:12px;max-height:56vh;overflow:auto;padding:2px}
      .mp-tit{font:700 11px var(--f-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--tinta-3);margin:4px 2px -2px}
      .mp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}
      .mp-btn{display:flex;align-items:center;gap:10px;border:1px solid var(--linea);background:var(--superficie-2,#fff);border-radius:12px;padding:10px 12px;cursor:pointer;text-align:left;min-height:52px;font:inherit;color:inherit}
      .mp-btn.grande{min-height:60px}
      .mp-grid.mp-top{grid-template-columns:repeat(2,1fr)}
      .mp-btn:hover,.mp-chip:hover{border-color:var(--acento);background:var(--lila)}
      .mp-txt{display:flex;flex-direction:column;min-width:0}
      .mp-txt b{font:650 13.5px/1.25 var(--f-ui)}
      .mp-txt small{font:500 11px var(--f-mono);color:var(--tinta-3);margin-top:2px}
      .mp-logo{width:32px;height:32px;border-radius:50%;flex:none;display:inline-flex;align-items:center;justify-content:center;font:800 12px/1 var(--f-ui);letter-spacing:-.02em;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)}
      .mp-logo.medio{font-size:10.5px}.mp-logo.largo{font-size:8.5px;letter-spacing:0}
      .mp-logo.chico{width:24px;height:24px;font-size:9.5px}.mp-logo.chico.largo{font-size:7px}
      .mp-grupos{display:grid;gap:8px}
      .mp-grupo{border:1px solid var(--linea);border-radius:12px;background:rgba(255,255,255,.5);padding:6px 10px 10px}
      .mp-grupo summary{cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;font:700 13px var(--f-ui);padding:4px 2px 6px}
      .mp-grupo summary::-webkit-details-marker{display:none}
      .mp-grupo summary span{font:600 11px var(--f-mono);color:var(--tinta-3);background:var(--relleno);border-radius:999px;padding:1px 8px}
      .mp-grupo summary::after{content:'▾';margin-left:8px;color:var(--tinta-3);font-size:12px}
      .mp-grupo:not([open]) summary::after{content:'▸'}
      .mp-grupo summary{gap:8px}.mp-grupo summary span{margin-left:auto}.mp-grupo summary small{font:500 11.5px var(--f-ui);color:var(--tinta-3)}
      .mp-fila{display:flex;align-items:center;gap:10px;padding:6px 2px;border-top:1px solid var(--linea-suave,rgba(0,0,0,.05))}
      .mp-fila:first-of-type{border-top:0}
      .mp-prov{font:650 13px var(--f-ui);min-width:110px}
      .mp-chips{display:flex;flex-wrap:wrap;gap:6px;margin-left:auto;justify-content:flex-end}
      .mp-chip{border:1px solid var(--linea);background:var(--superficie-2,#fff);border-radius:999px;padding:7px 12px;font:600 12.5px var(--f-ui);cursor:pointer;color:inherit}
      body.reservado .mp-grupo{background:rgba(255,255,255,.03)}
      body.reservado .mp-btn,body.reservado .mp-chip{background:#1d1a22;border-color:rgba(255,255,255,.09)}
    `;
    document.head.appendChild(st);
  }
  // empresas y bancos propios de la empresa (tabla medios_entidades): se suman a los conocidos
  async function cargar(sb, e) {
    try {
      const { data } = await sb.from('medios_entidades').select('*').eq('empresa_id', e);
      (data || []).forEach(x => {
        if (x.tipo === 'banco') BANCO[x.clave] = { n: x.nombre, t: x.sigla, bg: x.color, propio: true };
        else PROV[x.clave] = { n: x.nombre, t: x.sigla, bg: x.color, fg: '#fff', alias: (x.palabras || []).map(w => String(w).toLowerCase()).concat(String(x.nombre).toLowerCase()), propio: true };
      });
    } catch (_) {}
  }
  window.MEDIOS = { PROV, BANCO, GRUPO, ORDEN, logo, corto, botonera, grupoDe, cargar };
})();
