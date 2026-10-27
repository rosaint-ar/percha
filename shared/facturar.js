// Facturar una venta en ARCA: elegir a quién (consumidor final, DNI o CUIT), pedir el CAE y mostrar cómo quedó.
// FACTURA.abrir(venta, { alTerminar }) · FACTURA.chip(venta) · FACTURA.lista(e) (¿está configurada?) · FACTURA.mandar(e, id)
(function () {
  const pesos2 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let cfgCache = null;
  async function config(e, forzar) {
    if (cfgCache && !forzar && cfgCache.empresa_id === e) return cfgCache;
    const { data } = await sb.from('facturacion_config').select('empresa_id,estado,punto_venta,umbral_identificar,ambiente').eq('empresa_id', e).maybeSingle();
    cfgCache = data || { empresa_id: e, estado: 'sin_configurar' };
    return cfgCache;
  }
  async function llamar(body) {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(`${SUPABASE_URL}/functions/v1/arca`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ error: 'ARCA: respuesta inválida (' + r.status + ')' }));
    if (!r.ok || j.error) throw new Error(j.error || 'Error ' + r.status);
    return j;
  }
  async function mandar(e, id) {
    const j = await llamar({ accion: 'facturar', empresa_id: e, comprobante_id: id });
    const r = (j.resultado || []).find(x => x.id === id) || (j.resultado || [])[0] || {};
    const { data: c } = await sb.from('v_comprobantes').select('*').eq('id', id).maybeSingle();
    return { c, error: r.error };
  }
  const raiz = () => (window.APP && APP.root) || '../';
  const urlFactura = id => `${raiz()}caja/factura.html?id=${id}`;
  const textoWsp = (emp, c) => encodeURIComponent(`${emp.nombre} · ${c.nombre_tipo} ${c.numero_mostrar}\nTotal ${pesos2.format(c.total)}\nCAE ${c.cae} (vence ${new Date(c.cae_vence + 'T12:00').toLocaleDateString('es-AR')})\n¡Gracias por tu compra!`);

  function chip(v) {
    const { esc } = APP;
    if (v.nc_id && v.nc_estado === 'autorizado') return '<span class="chip">anulada con NC</span>';
    if (v.nc_id && v.nc_estado === 'pendiente') return '<span class="chip aviso">nota de crédito en cola</span>';
    if (v.factura_estado === 'autorizado') return `<a class="chip ok" href="${urlFactura(v.factura_id)}" target="_blank" title="Ver la factura">${esc(v.factura_numero)}</a>`;
    if (v.factura_estado === 'pendiente') return '<span class="chip aviso" title="Sale sola apenas ARCA responda">factura en cola</span>';
    if (v.factura_estado === 'rechazado') return '<span class="chip error" title="ARCA la rechazó: abrí la venta para ver por qué">rechazada</span>';
    return '';
  }

  // resultado de un comprobante en la ventana
  function pintarResultado(m, c, error, alTerminar) {
    const { esc, $ } = APP, emp = APP.empresa;
    const caja = $('[data-res]', m);
    if (c && c.estado === 'autorizado') {
      caja.innerHTML = `<div class="aviso-caja ok" style="display:block">✓ <b>${esc(c.nombre_tipo)} ${esc(c.numero_mostrar)}</b> autorizada por ARCA<br><small>CAE ${esc(c.cae)} · vence ${new Date(c.cae_vence + 'T12:00').toLocaleDateString('es-AR')}</small></div>
        <div class="pie" style="justify-content:space-between"><div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn primario" target="_blank" href="${urlFactura(c.id)}">Ver e imprimir</a><a class="btn" target="_blank" href="https://wa.me/?text=${textoWsp(emp, c)}">WhatsApp</a></div><button class="btn" data-cerrar>Listo</button></div>`;
    } else if (c && c.estado === 'rechazado') {
      caja.innerHTML = `<div class="aviso-caja error" style="display:block"><b>ARCA la rechazó.</b><br><small>${esc(c.errores || '')}</small></div><div class="pie"><button class="btn" data-cerrar>Cerrar</button></div>`;
    } else {
      caja.innerHTML = `<div class="aviso-caja info" style="display:block"><b>Quedó en cola.</b> ARCA no respondió todavía; la factura sale sola en un minuto y aparece en Ventas.<br><small>${esc(error || (c && c.errores) || '')}</small></div><div class="pie"><button class="btn" data-cerrar>Listo</button></div>`;
    }
    const b = $('[data-cerrar]', caja); if (b) b.onclick = () => m.cerrar();
    if (alTerminar) alTerminar(c);
  }

  async function abrir(venta, op) {
    op = op || {};
    const { esc, $, $$, modal, toast, mensajeError } = APP, e = APP.empresa.id;
    const cfg = await config(e, true);
    if (cfg.estado !== 'listo') {
      const m = modal(`<h2>La facturación no está lista</h2><p class="sub">Falta terminar la configuración con ARCA (punto de venta y certificado).</p>
        <div class="pie">${APP.esAdmin ? `<a class="btn primario" href="${raiz()}configuracion/facturacion.html">Ir a configurarla</a>` : ''}<button class="btn" data-no>Cerrar</button></div>`);
      $('[data-no]', m).onclick = () => m.cerrar(); return;
    }
    // ya tiene: mostrarla
    if (venta.factura_id && ['autorizado', 'pendiente'].includes(venta.factura_estado)) {
      const { data: c } = await sb.from('v_comprobantes').select('*').eq('id', venta.factura_id).single();
      const m = modal(`<h2>${esc(c.nombre_tipo)}</h2><div data-res></div>`); pintarResultado(m, c, null, null); return;
    }
    let cli = null;
    if (venta.cliente_id) { const { data } = await sb.from('clientes').select('nombre,tipo_doc,documento,direccion,localidad,condicion_iva').eq('id', venta.cliente_id).maybeSingle(); cli = data; }
    const docCli = cli && cli.documento ? String(cli.documento).replace(/\D/g, '') : '';
    const obligatorio = +venta.total >= +cfg.umbral_identificar;
    let modo = docCli ? (docCli.length === 11 ? 'cuit' : 'dni') : (obligatorio ? 'dni' : 'cf');
    const m = modal(`<h2>Facturar venta #${String(venta.numero).padStart(6, '0')}</h2>
      <div style="font:800 26px var(--f-titulo);letter-spacing:-.02em;margin:4px 0 10px">${pesos2.format(venta.total)}</div>
      <div class="campo"><label>¿A nombre de quién?</label><div class="chips-fila" data-modo>
        <button type="button" class="chip-opc" data-m="cf" ${obligatorio ? 'disabled title="Para este importe ARCA pide DNI o CUIT"' : ''}>Consumidor final</button><button type="button" class="chip-opc" data-m="dni">Con DNI</button><button type="button" class="chip-opc" data-m="cuit">Con CUIT</button></div></div>
      ${obligatorio ? `<p class="sub" style="margin:-4px 0 8px">Para ventas de ${pesos2.format(cfg.umbral_identificar)} o más ARCA pide el DNI o CUIT.</p>` : ''}
      <div data-ident>
        <div class="campo"><label data-lbl-doc>DNI</label><input id="fa-doc" inputmode="numeric" autocomplete="off" value="${esc(docCli)}"></div>
        <div class="campo"><label>Nombre o razón social</label><input id="fa-nom" value="${esc((cli && cli.nombre) || venta.cliente_nombre || '')}"></div>
        <div class="campo" data-cond><label>Condición frente al IVA</label><select id="fa-cond"><option value="6">Monotributo</option><option value="1">Responsable inscripto</option><option value="4">Exento</option><option value="5">Consumidor final</option></select></div>
        <div class="campo"><label>Domicilio <small>(opcional)</small></label><input id="fa-dom" value="${esc(cli ? [cli.direccion, cli.localidad].filter(Boolean).join(', ') : '')}"></div>
      </div>
      <div data-res><div class="pie"><button class="btn" data-no>Cancelar</button><button class="btn primario" data-si>Emitir factura</button></div></div>
      <style>.chips-fila{display:flex;gap:6px;flex-wrap:wrap}.chip-opc{border:1px solid var(--linea);background:var(--superficie-2);padding:8px 14px;border-radius:999px;font:600 13px var(--f-ui);cursor:pointer;color:var(--tinta)}.chip-opc.on{background:var(--acento);border-color:var(--acento);color:#fff}.chip-opc:disabled{opacity:.45;cursor:not-allowed}</style>`);
    const pintar = () => {
      $$('[data-m]', m).forEach(b => b.classList.toggle('on', b.dataset.m === modo));
      $('[data-ident]', m).style.display = modo === 'cf' ? 'none' : '';
      $('[data-cond]', m).style.display = modo === 'cuit' ? '' : 'none';
      $('[data-lbl-doc]', m).textContent = modo === 'cuit' ? 'CUIT (11 números)' : 'DNI';
      if (modo !== 'cf') setTimeout(() => $('#fa-doc', m).focus(), 20);
    };
    $$('[data-m]', m).forEach(b => b.onclick = () => { modo = b.dataset.m; pintar(); });
    pintar();
    $('[data-no]', m).onclick = () => m.cerrar();
    $('[data-si]', m).onclick = async () => {
      const b = $('[data-si]', m); b.disabled = true; b.textContent = 'Pidiendo el CAE a ARCA…';
      const doc = $('#fa-doc', m).value.replace(/\D/g, '');
      const p = { venta_id: venta.id, doc_tipo: modo === 'cf' ? 99 : modo === 'cuit' ? 80 : 96, doc_nro: modo === 'cf' ? '0' : doc, nombre: modo === 'cf' ? null : $('#fa-nom', m).value.trim(),
        condicion: modo === 'cuit' ? +$('#fa-cond', m).value : 5, domicilio: modo === 'cf' ? null : $('#fa-dom', m).value.trim() };
      const { data, error } = await sb.rpc('factura_pedir', { p });
      if (error) { toast(mensajeError(error), 'error'); b.disabled = false; b.textContent = 'Emitir factura'; return; }
      $('[data-ident]', m).style.display = 'none'; $('[data-modo]', m).closest('.campo').style.display = 'none';
      try { const r = await mandar(e, data.id); pintarResultado(m, r.c, r.error, op.alTerminar); }
      catch (err) { const { data: c } = await sb.from('v_comprobantes').select('*').eq('id', data.id).maybeSingle(); pintarResultado(m, c, mensajeError(err), op.alTerminar); }
    };
  }
  window.FACTURA = { abrir, chip, config, mandar, llamar, urlFactura };
})();
