/* Percha · Precios. Lista (la predeterminada) = el precio de cada prenda; cada otra lista = Lista × %, con excepciones por familia
   o producto, precio fijo puntual y redondeo (por defecto para arriba a $10). Las rebajas (promociones tipo 'rebaja') bajan el
   precio ANTES de la lista: Magnolia 75.000 → rebaja 59.990 → Contado 59.990 × 0,80. La caja, la ficha y la configuración usan esto. */
(function () {
  const r2 = x => Math.round(x * 100) / 100;
  // igual que precio_redondear() de la base: '10' | '100' | '500' | '1000' | '990' | '900', con '+' para arriba; 'no' = al centavo
  function redondear(x, modo) {
    if (x == null || isNaN(x)) return x;
    const arriba = /\+$/.test(modo || ''), m = String(modo || 'no').replace('+', '');
    let paso, resta = 0;
    if (['10', '100', '500', '1000'].includes(m)) paso = +m;
    else if (m === '990') { paso = 1000; resta = 10; } else if (m === '900') { paso = 1000; resta = 100; }
    else return Math.max(0, r2(x));
    const f = arriba ? v => Math.ceil(r2(v)) : Math.round;   // r2 antes del ceil: 0,1 × 3 no tiene que subir un escalón
    if (x < paso - resta) return Math.max(0, f(x));
    return Math.max(0, f((x + resta) / paso) * paso - resta);
  }
  async function todo(q) {
    let desde = 0, filas = [];
    while (true) { const { data, error } = await q().range(desde, desde + 999); if (error) throw error; filas = filas.concat(data || []); if (!data || data.length < 1000) break; desde += 1000; }
    return filas;
  }
  // trae todo lo que hace falta para calcular (una vez por pantalla)
  async function cargar(sb, e) {
    const [listas, excep, fijos, rebajas, rp] = await Promise.all([
      todo(() => sb.from('listas_precios').select('*').eq('empresa_id', e).eq('activa', true).order('orden')),
      todo(() => sb.from('lista_excepciones').select('id,lista_id,categoria_id,producto_id,porcentaje').eq('empresa_id', e)),
      todo(() => sb.from('precios').select('lista_id,producto_id,variante_id,precio').eq('empresa_id', e)),
      todo(() => sb.from('promociones').select('*').eq('empresa_id', e).eq('activa', true).eq('tipo', 'rebaja')),
      todo(() => sb.from('rebaja_precios').select('promocion_id,producto_id,variante_id,precio').eq('empresa_id', e))]);
    return armar({ listas, excep, fijos, rebajas, rp });
  }
  function armar(d) {
    const ctx = { datos: d, listas: d.listas || [], excep: new Map(), fijos: new Map(), rebajas: [] };
    (d.excep || []).forEach(x => ctx.excep.set(x.lista_id + '|' + (x.producto_id ? 'p' + x.producto_id : 'c' + x.categoria_id), +x.porcentaje));
    (d.fijos || []).forEach(x => ctx.fijos.set(x.lista_id + '|' + x.producto_id + '|' + (x.variante_id || ''), +x.precio));
    ctx.rebajas = (d.rebajas || []).map(p => ({ p, precios: new Map() }));
    const porId = new Map(ctx.rebajas.map(r => [r.p.id, r]));
    (d.rp || []).forEach(x => { const r = porId.get(x.promocion_id); if (r) r.precios.set(x.producto_id + '|' + (x.variante_id || ''), +x.precio); });
    ctx.base = ctx.listas.find(l => l.predeterminada && !l.canal) || ctx.listas.find(l => !l.canal) || { id: null, porcentaje: 100, redondeo: '10+', toma_rebajas: true };
    return ctx;
  }
  const hoy = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  function vigente(p, canal, fecha) {
    const f = fecha || hoy(), d = new Date(f + 'T12:00'), dow = ((d.getDay() + 6) % 7) + 1;
    if (p.desde && f < p.desde) return false; if (p.hasta && f > p.hasta) return false;
    if (p.dias_semana && p.dias_semana.length && !p.dias_semana.includes(dow)) return false;
    if (p.canales && p.canales.length && !p.canales.includes(canal || 'local')) return false;
    return true;
  }
  // la rebaja más baja que le toca a esta prenda (o null)
  function rebajaDe(v, ctx, op) {
    const base = +v.precio || 0; let mejor = null;
    for (const { p, precios } of ctx.rebajas) {
      if (!vigente(p, op.canal, op.fecha)) continue;
      let pr = precios.get(v.producto_id + '|' + v.id); if (pr == null) pr = precios.get(v.producto_id + '|');
      if (pr == null && +p.valor > 0) {
        const alcanza = p.alcance === 'familias' ? (p.familia_ids || []).includes(op.categoria_id) : p.alcance === 'productos' ? (p.producto_ids || []).includes(v.producto_id) : (op.tipo || 'prenda') === 'prenda';
        if (alcanza) pr = redondear(base * (1 - +p.valor / 100), ctx.base.redondeo || '10+');
      }
      if (pr != null && pr < base && (!mejor || pr < mejor.precio)) mejor = { id: p.id, nombre: p.nombre, precio: pr, hasta: p.hasta };
    }
    return mejor;
  }
  // v = variante (precio = el suyo o el del producto); op = { canal, fecha, categoria_id, tipo, sinRebajas }
  // la lista de un canal (Tienda Nube) toma las rebajas que valen en ese canal
  function calcular(v, listaId, ctx, op) {
    const base = +v.precio || 0;
    const lista = ctx.listas.find(l => l.id === listaId) || ctx.base;
    op = Object.assign({}, op || {}); if (!op.canal) op.canal = lista.canal || 'local';
    let fijo = ctx.fijos.get(lista.id + '|' + v.producto_id + '|' + v.id); if (fijo == null) fijo = ctx.fijos.get(lista.id + '|' + v.producto_id + '|');
    if (fijo != null) return { base, lista, rebaja: null, pct: null, fijo: true, precio: fijo };
    const rebaja = lista.toma_rebajas !== false && !op.sinRebajas ? rebajaDe(v, ctx, op) : null;
    const punto = rebaja ? rebaja.precio : base;
    let pct = ctx.excep.get(lista.id + '|p' + v.producto_id);
    if (pct == null && op.categoria_id) pct = ctx.excep.get(lista.id + '|c' + op.categoria_id);
    if (pct == null) pct = +lista.porcentaje || 100;
    const precio = pct === 100 ? punto : redondear(punto * pct / 100, lista.redondeo || '10+');
    return { base, lista, rebaja, pct, fijo: false, precio };
  }
  const REDONDEOS = [['10+', 'Para arriba a $10'], ['100+', 'Para arriba a $100'], ['500+', 'Para arriba a $500'], ['990+', 'Terminado en 990'], ['10', 'Al $10 más cercano'], ['100', 'Al $100 más cercano'], ['no', 'Sin redondear']];
  // ---- para las pantallas: la regla de una lista en dos controles, [20] [% menos que la base ▾]; se guarda como 80 ----
  const dec = n => (+n).toLocaleString('es-AR', { maximumFractionDigits: 3 });
  const reglaTxt = pct => +pct === 100 ? 'igual que la base' : +pct < 100 ? dec(100 - pct) + '% menos que la base' : dec(pct - 100) + '% más que la base';
  function reglaControles(pct, k) {
    const dif = Math.round(Math.abs(100 - +pct) * 1000) / 1000, s = +pct > 100 ? 'mas' : +pct < 100 ? 'menos' : 'igual';
    return '<div class="regla"><input data-' + k + '-n inputmode="decimal" value="' + (s === 'igual' ? '' : dec(dif)) + '" ' + (s === 'igual' ? 'disabled' : '') + '><select data-' + k + '-s>'
      + [['menos', '% menos que la base'], ['mas', '% más que la base'], ['igual', 'igual que la base']].map(([v, t]) => '<option value="' + v + '"' + (s === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div>';
  }
  function leerRegla(cont, k) {
    const s = cont.querySelector('[data-' + k + '-s]').value, n = parseFloat(String(cont.querySelector('[data-' + k + '-n]').value).replace(',', '.').replace('−', '-'));
    if (s === 'igual') return 100; if (isNaN(n) || n <= 0) return null; if (s === 'menos' && n >= 100) return null;
    return s === 'menos' ? 100 - n : 100 + n;
  }
  // engancha los dos controles: al cambiar, llama a guardar(pct) (o avisa si el número no sirve)
  function reglaEnganchar(cont, k, guardar, avisar) {
    const s = cont.querySelector('[data-' + k + '-s]'), n = cont.querySelector('[data-' + k + '-n]'); if (!s) return;
    const ir = () => { const pct = leerRegla(cont, k); if (pct == null) { avisar && avisar(); return; } guardar(pct); };
    s.onchange = () => { n.disabled = s.value === 'igual'; if (s.value !== 'igual' && !n.value) { n.focus(); return; } ir(); }; n.onchange = ir;
  }
  // las listas que se eligen en el local (sin las de los canales online)
  const delLocal = ctx => ctx.listas.filter(l => !l.canal);
  window.PRECIOS = { cargar, armar, calcular, rebajaDe, redondear, vigente, delLocal, REDONDEOS, reglaTxt, reglaControles, leerRegla, reglaEnganchar };
})();
