/* Percha · Pendientes: tareas que quedaron para después y no molestan, pero están a la vista.
   - Prendas vendidas sin definir (genéricos tipo BOMBIS «VARIAS» o kits sin elegir): decir qué modelo fue.
   - Stock para revisar (se vendió sin stock en el sistema o sin marcar la falla): abre la ventana de la prenda.
   - Recuentos abiertos.
   La píldora la pone el shell arriba; PENDIENTES.abrir() muestra el panel. */
(function () {
  const css = `
  .pend-panel{position:fixed;top:0;right:0;bottom:0;width:min(440px,100vw);z-index:60;background:var(--superficie-2);box-shadow:var(--sombra-flotante);display:flex;flex-direction:column;animation:pend-entra .2s ease-out}
  @keyframes pend-entra{from{transform:translateX(30px);opacity:0}to{transform:none;opacity:1}}
  .pend-telon{position:fixed;inset:0;z-index:59;background:rgba(21,23,28,.25)}
  .pend-cab{display:flex;align-items:center;justify-content:space-between;padding:18px 20px 12px;border-bottom:1px solid var(--linea-suave)}
  .pend-cab h2{margin:0;font-size:18px}.pend-cab button{border:0;background:var(--relleno);width:34px;height:34px;border-radius:10px;cursor:pointer;font-size:16px}
  .pend-cuerpo{overflow:auto;padding:12px 20px 24px;flex:1}
  .pend-sec{margin-top:14px}.pend-sec h3{font:600 10.5px var(--f-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--tinta-3);margin:0 0 8px;display:flex;gap:8px;align-items:center}
  .pend-sec h3 span{background:var(--relleno);border-radius:999px;padding:1px 7px;letter-spacing:0}
  .pend-sec p.ayuda{margin:-2px 0 8px;font-size:12.5px;color:var(--tinta-3)}
  .pend-it{display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:10px;align-items:center;width:100%;text-align:left;border:1px solid var(--linea);border-radius:12px;background:var(--superficie-2);padding:8px 10px 8px 8px;margin-bottom:6px;cursor:pointer;font:inherit;color:inherit;transition:border-color .12s,transform .08s}
  .pend-it:hover{border-color:rgba(var(--acento-rgb),.45);transform:translateY(-1px)}
  .pend-it .ic{width:40px;height:40px;border-radius:10px;display:grid;place-items:center;font-size:17px;background:var(--lila)}
  .pend-it.rev .ic{background:#fdecee}.pend-it.rec .ic{background:var(--ok-fondo)}
  .pend-it b{display:block;font:650 13px var(--f-ui)}.pend-it small{color:var(--tinta-3);font-size:12px}
  .pend-it .ir{font:700 12px var(--f-ui);color:var(--acento);white-space:nowrap}
  .pend-vacio{text-align:center;padding:40px 10px;color:var(--tinta-3)}.pend-vacio b{display:block;color:var(--tinta);font-size:15px;margin:8px 0 4px}
  .pend-vacio .ok{width:56px;height:56px;margin:0 auto;border-radius:50%;display:grid;place-items:center;background:var(--ok-fondo);color:var(--ok);font:800 26px var(--f-ui)}
  /* definir */
  .def-falta{display:flex;align-items:center;gap:10px;margin:10px 0}
  .def-falta b{font:800 28px var(--f-titulo);color:var(--acento)}
  .def-mult{margin-left:auto;display:inline-flex;background:var(--relleno);border-radius:9px;padding:3px;gap:2px}
  .def-mult button{border:0;background:transparent;border-radius:7px;padding:5px 9px;font:700 12px var(--f-mono);cursor:pointer;color:var(--tinta-2)}
  .def-mult button.on{background:var(--superficie-2);color:var(--acento);box-shadow:0 1px 2px rgba(21,23,28,.1)}
  .def-elegidas{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
  .def-elegidas span{display:inline-flex;align-items:center;gap:6px;background:var(--lila);color:var(--acento);border-radius:999px;padding:4px 6px 4px 10px;font:600 12px var(--f-ui)}
  .def-elegidas button{border:0;background:rgba(255,255,255,.7);border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:11px}
  .def-busca{width:100%;height:42px;border:1px solid var(--linea);border-radius:12px;padding:0 14px;background:var(--superficie-2);font-size:15px}
  .def-lista{max-height:46vh;overflow:auto;margin-top:8px;display:grid;gap:6px}
  .def-prod{border:1px solid var(--linea);border-radius:12px;overflow:hidden}
  .def-prod>button{display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:10px;align-items:center;width:100%;border:0;background:var(--superficie-2);padding:6px 10px 6px 6px;cursor:pointer;text-align:left;font:inherit}
  .def-prod img,.def-prod .sf{width:38px;height:38px;border-radius:8px;object-fit:cover;background:var(--relleno)}
  .def-prod small{color:var(--tinta-3);font:500 11.5px var(--f-mono)}
  .def-vars{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px 10px;background:var(--lila-suave)}
  .def-vars button{border:1px solid var(--linea);background:var(--superficie-2);border-radius:9px;padding:6px 10px;font:600 12.5px var(--f-ui);cursor:pointer}
  .def-vars button small{display:block;font:500 10.5px var(--f-mono);color:var(--tinta-3)}
  .def-vars button.sin{opacity:.45}
  .def-vars button:hover{border-color:var(--acento);color:var(--acento)}`;
  function estilos() { if (document.getElementById('estilo-pendientes')) return; const s = document.createElement('style'); s.id = 'estilo-pendientes'; s.textContent = css; document.head.appendChild(s); }
  const raiz = () => document.querySelector('meta[name="app-root"]')?.content || '';
  const cargarScript = src => new Promise((ok, mal) => { if ([...document.scripts].some(s => s.src.includes(src.split('?')[0]))) return ok(); const s = document.createElement('script'); s.src = raiz() + src; s.onload = ok; s.onerror = mal; document.head.appendChild(s); });

  let catalogo = null;
  let productosP = new Map();   // producto → {generico_local_id, …}: con qué artículo del local se completa un genérico
  async function cargarCatalogo() {
    if (catalogo) return catalogo; let todo = [], d = 0;
    while (true) {
      const { data } = await sb.from('v_variantes').select('id,producto_id,producto_codigo,producto_nombre,producto_tipo,talle_nombre,talle_orden,color_nombre,sku,stock,foto').eq('empresa_id', APP.empresa.id).eq('activa', true).neq('producto_tipo', 'kit').not('sku', 'like', '%-SD').order('producto_nombre').range(d, d + 999);
      todo = todo.concat(data || []); if (!data || data.length < 1000) break; d += 1000;
    }
    const { data: ps } = await sb.from('productos').select('id,categoria_id,es_generico,generico_local_id').eq('empresa_id', APP.empresa.id);
    const P = new Map((ps || []).map(p => [p.id, p])); productosP = P;
    todo.forEach(v => { const p = P.get(v.producto_id) || {}; v.categoria_id = p.categoria_id; v.es_generico = p.es_generico; });
    return catalogo = todo.filter(v => !v.es_generico);
  }

  // ---------- panel ----------
  async function abrir() {
    estilos();
    const { esc, fmt } = APP;
    document.querySelectorAll('.pend-panel,.pend-telon').forEach(x => x.remove());
    const telon = document.createElement('div'); telon.className = 'pend-telon';
    const p = document.createElement('aside'); p.className = 'pend-panel';
    p.innerHTML = '<div class="pend-cab"><h2>📌 Pendientes</h2><button title="Cerrar">✕</button></div><div class="pend-cuerpo"><p class="sub">Buscando…</p></div>';
    document.body.append(telon, p);
    const cerrar = () => { p.remove(); telon.remove(); document.removeEventListener('keydown', esc1); };
    const esc1 = ev => { if (ev.key === 'Escape' && !document.querySelector('.modal-fondo,.fondo-modal')) cerrar(); };
    telon.onclick = cerrar; p.querySelector('.pend-cab button').onclick = cerrar; document.addEventListener('keydown', esc1);
    const e = APP.empresa.id;
    const [{ data: def }, { data: rev }, { data: rec }] = await Promise.all([
      sb.from('v_pendientes_definir').select('*').eq('empresa_id', e).order('fecha'),
      sb.from('v_stock_revisar').select('*').eq('empresa_id', e).is('resuelto', null).order('creado'),
      sb.from('recuentos').select('id,nombre,creado').eq('empresa_id', e).eq('estado', 'abierto').order('creado')]);
    const revV = new Map(); (rev || []).forEach(r => { if (!revV.has(r.variante_id)) revV.set(r.variante_id, r); });
    const cuerpo = p.querySelector('.pend-cuerpo');
    if (!(def || []).length && !revV.size && !(rec || []).length) { cuerpo.innerHTML = '<div class="pend-vacio"><div class="ok">✓</div><b>Nada pendiente</b>Todo lo vendido está definido y el stock no tiene avisos.</div>'; return; }
    cuerpo.innerHTML = `
      ${(def || []).length ? `<div class="pend-sec"><h3>Prendas vendidas sin definir <span>${fmt.num(def.reduce((s, x) => s + +x.pendiente, 0))}</span></h3><p class="ayuda">Se vendieron sin elegir el modelo. Decí cuáles fueron para que el stock de cada modelo dé bien.</p>
        ${def.map((x, i) => `<button class="pend-it" data-def="${i}"><span class="ic">🏷️</span><span><b>${fmt.num(x.pendiente)} × ${esc(x.desde_nombre)}</b><small>Venta #${String(x.venta_numero).padStart(6, '0')} · ${fmt.fechaHora(x.fecha)}${x.es_generico ? '' : ' · dentro de ' + esc(x.linea_descripcion)}</small></span><span class="ir">Definir →</span></button>`).join('')}</div>` : ''}
      ${revV.size ? `<div class="pend-sec"><h3>Stock para revisar <span>${fmt.num(revV.size)}</span></h3><p class="ayuda">La caja vendió algo que el sistema decía que no había. Contá y corregí.</p>
        ${[...revV.values()].map(r => `<button class="pend-it rev" data-rev="${r.variante_id}"><span class="ic">${r.motivo === 'falla' ? '◆' : '⚠'}</span><span><b>${esc(r.producto_nombre)}</b><small>${esc([r.talle_nombre, r.color_nombre].filter(Boolean).join(' · '))} · ${esc(r.detalle || '')}</small></span><span class="ir">Corregir →</span></button>`).join('')}</div>` : ''}
      ${(rec || []).length ? `<div class="pend-sec"><h3>Recuentos sin terminar <span>${fmt.num(rec.length)}</span></h3>
        ${rec.map(r => `<a class="pend-it rec" href="${raiz()}catalogo/inventario.html#recuentos:${r.id}" style="text-decoration:none"><span class="ic">📋</span><span><b>${esc(r.nombre)}</b><small>empezado ${fmt.fechaHora(r.creado)}</small></span><span class="ir">Seguir →</span></a>`).join('')}</div>` : ''}`;
    cuerpo.querySelectorAll('[data-def]').forEach(b => b.onclick = () => definir(def[+b.dataset.def], () => { refrescar(); abrir(); }));
    cuerpo.querySelectorAll('[data-rev]').forEach(b => b.onclick = async () => { await cargarScript('shared/prenda.js'); PRENDA.abrir(b.dataset.rev, { alGuardar: () => { refrescar(); abrir(); } }); });
  }

  // ---------- definir qué prendas fueron ----------
  async function definir(x, alTerminar) {
    estilos();
    const { esc, fmt, $, $$, toast, modal, mensajeError } = APP;
    const m = modal(`<h2>¿Cuáles fueron?</h2><p class="sub">Venta #${String(x.venta_numero).padStart(6, '0')} · se vendió ${esc(x.desde_nombre)}${x.es_generico ? '' : ' dentro de ' + esc(x.linea_descripcion)}. Buscá cada modelo y tocá su talle y color.</p>
      <div class="def-falta"><b id="df-n"></b><span class="sub">por definir</span><span class="def-mult" id="df-mult"><button class="on" data-m="1">×1</button><button data-m="2">×2</button><button data-m="3">×3</button><button data-m="5">×5</button></span></div>
      <div class="def-elegidas" id="df-el"></div>
      <input class="def-busca" id="df-q" placeholder="Cargando el catálogo…" disabled autocomplete="off">
      <div class="def-lista" id="df-lista"></div>
      <div class="pie"><button class="btn" data-no>Dejar para después</button><button class="btn primario" data-si disabled>Guardar</button></div>`);
    $('.modal', m).style.maxWidth = '640px';
    const elegidas = new Map(); let mult = 1, abierto = null;
    const total = () => [...elegidas.values()].reduce((s, e) => s + e.n, 0), falta = () => +x.pendiente - total();
    const pintarEl = () => {
      $('#df-n', m).textContent = fmt.num(falta());
      $('#df-el', m).innerHTML = [...elegidas.values()].map(e => `<span>${e.n} × ${esc(e.v.producto_nombre)} ${esc([e.v.talle_nombre, e.v.color_nombre].filter(Boolean).join(' '))}<button data-x="${e.v.id}" title="Quitar">✕</button></span>`).join('');
      $$('[data-x]', m).forEach(b => b.onclick = () => { elegidas.delete(b.dataset.x); pintarEl(); });
      const g = $('[data-si]', m); g.disabled = !total(); g.textContent = total() ? (falta() ? `Guardar ${total()} (quedan ${falta()})` : `Guardar las ${total()}`) : 'Guardar';
    };
    $$('#df-mult button', m).forEach(b => b.onclick = () => { mult = +b.dataset.m; $$('#df-mult button', m).forEach(y => y.classList.toggle('on', y === b)); });
    $('[data-no]', m).onclick = () => m.cerrar();
    $('[data-si]', m).onclick = async () => {
      const b = $('[data-si]', m); b.disabled = true;
      const { data, error } = await sb.rpc('venta_definir', { p: { linea_id: x.linea_id, desde_variante_id: x.desde_variante_id, asignaciones: [...elegidas.values()].map(e => ({ variante_id: e.v.id, cantidad: e.n })) } });
      if (error) { toast(mensajeError(error), 'error'); b.disabled = false; return; }
      m.cerrar(); empujarStock(); toast(data.quedan ? `Listo: quedan ${data.quedan} por definir` : 'Listo: venta definida'); if (alTerminar) alTerminar();
    };
    pintarEl();
    const cat = await cargarCatalogo();
    const nrm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    // sugeridos: lo que encaja con el genérico (su filtro o su familia), con stock primero
    const f = x.generico_filtro || {}, famId = f.categoria_id || x.categoria_id;
    const encaja = v => (!famId || v.categoria_id === famId) && (f.incluye || []).every(w => !w.trim() || v.producto_nombre.toUpperCase().includes(w.trim().toUpperCase())) && !(f.excluye || []).some(w => w.trim() && v.producto_nombre.toUpperCase().includes(w.trim().toUpperCase()));
    const q = $('#df-q', m); q.disabled = false; q.placeholder = 'Modelo, color o talle (ej. fru cel)'; q.focus();
    // las que solo se venden en el local (BOMBIS «LOCAL»): completan sin elegir modelo
    const gl = (productosP.get(x.desde_producto_id) || {}).generico_local_id, vloc = gl && cat.find(v => v.producto_id === gl);
    if (vloc) { $('#df-mult', m).insertAdjacentHTML('afterend', `<button type="button" class="btn chico" id="df-local" style="margin-left:8px" title="Las que no están en la web">+ ${esc(vloc.producto_nombre)}</button>`); $('#df-local', m).onclick = () => sumar(vloc); }
    const pintarLista = () => {
      const t = nrm(q.value.trim()), ws = t.split(/\s+/).filter(Boolean);
      let vs = cat.filter(v => ws.every(w => nrm(`${v.producto_nombre} ${v.producto_codigo} ${v.talle_nombre || ''} ${v.color_nombre || ''}`).includes(w)));
      if (!ws.length) vs = vs.filter(encaja);
      const por = new Map(); vs.forEach(v => { if (!por.has(v.producto_id)) por.set(v.producto_id, []); por.get(v.producto_id).push(v); });
      const stk = a => a.reduce((s, v) => s + Math.max(+v.stock || 0, 0), 0);
      const prods = [...por.values()].sort((a, b) => (ws.length ? 0 : stk(b) - stk(a)) || a[0].producto_nombre.localeCompare(b[0].producto_nombre)).slice(0, 40);
      $('#df-lista', m).innerHTML = prods.map(a => { const v0 = a[0], todas = cat.filter(v => v.producto_id === v0.producto_id).sort((p1, p2) => (p1.talle_orden ?? 999) - (p2.talle_orden ?? 999) || String(p1.color_nombre || '').localeCompare(p2.color_nombre || ''));
        return `<div class="def-prod"><button data-p="${v0.producto_id}">${v0.foto ? `<img src="${esc(v0.foto)}" alt="" loading="lazy">` : '<span class="sf"></span>'}<span>${esc(v0.producto_nombre)}</span><small>${fmt.num(stk(todas))} u.</small></button>
          ${abierto === v0.producto_id || (ws.length && prods.length === 1) ? `<div class="def-vars">${todas.map(v => `<button data-v="${v.id}" class="${+v.stock > 0 ? '' : 'sin'}">${esc([v.talle_nombre, v.color_nombre].filter(Boolean).join(' · ') || 'Único')}<small>${fmt.num(v.stock)} u.</small></button>`).join('')}</div>` : ''}</div>`; }).join('') || '<p class="sub" style="text-align:center;padding:16px">Nada con ese nombre.</p>';
      $$('[data-p]', m).forEach(b => b.onclick = () => { const vs2 = cat.filter(v => v.producto_id === b.dataset.p); if (vs2.length === 1) { sumar(vs2[0]); return; } abierto = abierto === b.dataset.p ? null : b.dataset.p; pintarLista(); });
      $$('[data-v]', m).forEach(b => b.onclick = () => sumar(cat.find(v => v.id === b.dataset.v)));
    };
    const sumar = v => {
      const n = Math.min(mult, falta()); if (n <= 0) { toast('Ya están todas definidas', 'error'); return; }
      const e = elegidas.get(v.id) || { v, n: 0 }; e.n += n; elegidas.set(v.id, e);
      mult = 1; $$('#df-mult button', m).forEach(y => y.classList.toggle('on', y.dataset.m === '1'));
      q.value = ''; abierto = null; pintarEl(); pintarLista(); q.focus();
    };
    let tq; q.oninput = () => { clearTimeout(tq); tq = setTimeout(pintarLista, 150); };
    pintarLista();
  }

  // ---------- píldora ----------
  async function refrescar() {
    if (!window.APP || !APP.empresa || APP.rol === 'visor') return;
    const { data } = await sb.rpc('pendientes_resumen', { e: APP.empresa.id });
    const n = (data && data.total) || 0, t = data ? [data.definir ? `${data.definir_unidades} prendas vendidas sin definir` : '', data.revisar ? `${data.revisar} con stock para revisar` : '', data.recuentos ? `${data.recuentos} recuentos abiertos` : ''].filter(Boolean).join(' · ') : '';
    document.querySelectorAll('[data-pendientes]').forEach(b => { b.hidden = !n; b.querySelector('b').textContent = n; b.title = t || 'Nada pendiente'; });
  }
  window.PENDIENTES = { abrir, definir, refrescar };
})();
