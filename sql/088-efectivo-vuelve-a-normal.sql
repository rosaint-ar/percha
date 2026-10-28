-- 088 · Ya no se usa la vista reservada para el efectivo (28/10/2026, pedido de Diego): la regla queda pero apagada,
-- y las 9 ventas en efectivo que se pasaron a reservadas (075) vuelven a la vista normal con su número original.
-- El número original se deduce de los huecos de la numeración (coinciden uno a uno por fecha y referencia de FactuSOL).
-- La R-000001 NO se toca: se cargó así a mano en modo reservado (anulada, pagada con Mercado Pago).
CREATE OR REPLACE FUNCTION public.caja_registrar_venta(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e uuid := (p->>'empresa_id')::uuid;
  v_id uuid; v_num bigint; v_lin bigint; l jsonb; pg jsonb; cr jsonb; comp record; c jsonb; v_comp uuid;
  v_sub numeric := 0; v_costo numeric := 0; v_pagado numeric := 0; v_total numeric; v_desc numeric; v_rec numeric;
  v_estado text := coalesce(p->>'estado', 'completada'); v_tipo text := coalesce(p->>'tipo', 'venta');
  es_res boolean := coalesce((p->>'reservada')::boolean, false); auto_res boolean := false; dep uuid; cred creditos%rowtype; codigo text; creditos_out jsonb := '[]'::jsonb; existente uuid; tipo_prod text;
begin
  if not es_servicio() and (not es_miembro(e) or rol_en(e) = 'visor') then raise exception 'Sin permiso para vender'; end if;
  if es_res and not reservado_pin_ok(e, p->>'pin') then raise exception 'Clave incorrecta'; end if;
  if p->>'offline_id' is not null then
    select id into existente from ventas where empresa_id = e and offline_id = (p->>'offline_id')::uuid;
    if existente is not null then return jsonb_build_object('id', existente, 'numero', (select numero from ventas where id = existente), 'repetida', true); end if;
  end if;
  dep := coalesce((p->>'deposito_id')::uuid, (select deposito_id from cajas where id = (p->>'caja_id')::uuid), (select id from depositos where empresa_id = e and principal limit 1));
  for l in select * from jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) loop
    v_sub := v_sub + (l->>'total')::numeric; v_costo := v_costo + coalesce((l->>'costo_unit')::numeric, 0) * (l->>'cantidad')::numeric;
  end loop;
  v_desc := coalesce((p->>'descuento')::numeric, 0); v_rec := coalesce((p->>'recargo')::numeric, 0); v_total := round(v_sub - v_desc + v_rec, 2);
  for pg in select * from jsonb_array_elements(coalesce(p->'pagos', '[]'::jsonb)) loop v_pagado := v_pagado + (pg->>'monto')::numeric; end loop;
  for cr in select * from jsonb_array_elements(coalesce(p->'creditos_a_emitir', '[]'::jsonb)) loop if cr->>'tipo' = 'nota_credito' then v_pagado := v_pagado - (cr->>'monto')::numeric; end if; end loop;
  if v_estado = 'completada' and abs(v_pagado - v_total) > 0.5 then raise exception 'Los pagos (%) no coinciden con el total (%)', v_pagado, v_total; end if;
  -- (apagado salvo que la empresa lo prenda: empresas.config->>'efectivo_a_reservadas' = 'true'; pedido de Diego 28/10)
  -- pagada 100% en efectivo → va a la vista reservada (se factura distinto y no se lista en la vista normal)
  if not es_res and v_tipo = 'venta' and v_estado = 'completada' and v_total > 0 and jsonb_array_length(coalesce(p->'pagos', '[]'::jsonb)) > 0
     and coalesce((select (config->>'efectivo_a_reservadas')::boolean from empresas where id = e), false)
     and not exists (select 1 from jsonb_array_elements(p->'pagos') x left join formas_pago f on f.id = nullif(x->>'forma_pago_id', '')::uuid
                     where nullif(x->>'credito_id', '') is not null or coalesce(f.grupo, '') <> 'efectivo') then
    es_res := true; auto_res := true;   -- queda en el turno: el efectivo está en el cajón
  end if;
  if v_estado = 'senada' and v_pagado <= 0 then raise exception 'Una seña necesita un pago a cuenta'; end if;
  v_num := case when es_res then 1000000 + proximo_numero(e, 'r') else proximo_numero(e, 'venta') end;
  insert into ventas (empresa_id, numero, tipo, estado, fecha, caja_id, turno_id, cliente_id, vendedora_id, lista_id, subtotal, descuento_pct, descuento, recargo, total, pagado, saldo, costo, venta_origen_id, origen, referencia, nota, offline_id, creado_por, reservada)
  values (e, v_num, v_tipo, v_estado, coalesce((p->>'fecha')::timestamptz, now()), case when es_res and not auto_res then null else (p->>'caja_id')::uuid end, case when es_res and not auto_res then null else (p->>'turno_id')::uuid end, (p->>'cliente_id')::uuid, coalesce((p->>'vendedora_id')::uuid, auth.uid()), (p->>'lista_id')::uuid,
          v_sub, coalesce((p->>'descuento_pct')::numeric, 0), v_desc, v_rec, v_total, v_pagado, round(v_total - v_pagado, 2), v_costo,
          (p->>'venta_origen_id')::uuid, coalesce(p->>'origen', 'local'), p->>'referencia', p->>'nota', (p->>'offline_id')::uuid, auth.uid(), es_res)
  returning id into v_id;
  -- entrega (envío): medio, costo, dirección y contacto; queda pendiente de despachar
  if jsonb_typeof(p->'envio') = 'object' then
    update ventas set envio_metodo_id = nullif(p->'envio'->>'metodo_id', '')::uuid, envio_metodo = nullif(p->'envio'->>'metodo', ''), envio_costo = nullif(p->'envio'->>'costo', '')::numeric,
      envio_direccion = nullif(p->'envio'->>'direccion', ''), envio_contacto = nullif(p->'envio'->>'contacto', ''), envio_estado = 'pendiente', envio_actualizado = now()
    where id = v_id;
  end if;
  for l in select * from jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) loop
    insert into venta_lineas (venta_id, empresa_id, variante_id, producto_id, descripcion, talle, color, cantidad, precio_lista, precio_unit, descuento_pct, promocion_id, promocion_nombre, total, costo_unit)
    values (v_id, e, (l->>'variante_id')::uuid, (l->>'producto_id')::uuid, l->>'descripcion', l->>'talle', l->>'color', (l->>'cantidad')::numeric,
            coalesce((l->>'precio_lista')::numeric, 0), coalesce((l->>'precio_unit')::numeric, 0), coalesce((l->>'descuento_pct')::numeric, 0),
            (l->>'promocion_id')::uuid, l->>'promocion_nombre', (l->>'total')::numeric, coalesce((l->>'costo_unit')::numeric, 0))
    returning id into v_lin;
    perform venta_linea_mover_stock(e, v_id, case when es_res then null else v_num end, v_lin, dep, l);
  end loop;
  for pg in select * from jsonb_array_elements(coalesce(p->'pagos', '[]'::jsonb)) loop
    insert into venta_pagos (venta_id, empresa_id, turno_id, forma_pago_id, credito_id, monto, cuotas, recargo_pct, referencia)
    values (v_id, e, case when es_res and not auto_res then null else (p->>'turno_id')::uuid end, (pg->>'forma_pago_id')::uuid, (pg->>'credito_id')::uuid, (pg->>'monto')::numeric, coalesce((pg->>'cuotas')::int, 1), coalesce((pg->>'recargo_pct')::numeric, 0), pg->>'referencia');
    if pg->>'credito_id' is not null then
      select * into cred from creditos where id = (pg->>'credito_id')::uuid and empresa_id = e for update;
      if cred.id is null or cred.estado <> 'vigente' then raise exception 'El crédito no está vigente'; end if;
      if cred.saldo < (pg->>'monto')::numeric - 0.01 then raise exception 'El crédito no tiene saldo suficiente'; end if;
      update creditos set saldo = round(saldo - (pg->>'monto')::numeric, 2), estado = case when round(saldo - (pg->>'monto')::numeric, 2) <= 0 then 'usado' else 'vigente' end where id = cred.id;
    end if;
  end loop;
  for cr in select * from jsonb_array_elements(coalesce(p->'creditos_a_emitir', '[]'::jsonb)) loop
    codigo := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    insert into creditos (empresa_id, tipo, codigo, cliente_id, origen_venta_id, monto, saldo, vence, nota)
    values (e, cr->>'tipo', codigo, (cr->>'cliente_id')::uuid, v_id, (cr->>'monto')::numeric, (cr->>'monto')::numeric, (cr->>'vence')::date, cr->>'nota');
    creditos_out := creditos_out || jsonb_build_object('tipo', cr->>'tipo', 'codigo', codigo, 'monto', (cr->>'monto')::numeric);
  end loop;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'creditos', creditos_out, 'reservada', es_res, 'numero_mostrar', case when es_res then 'R-' || lpad((v_num - 1000000)::text, 6, '0') end);
end $function$

;

update ventas v set reservada = false, numero = x.orig from (values
  ('FactuSOL 1251', 18), ('FactuSOL 1253', 20), ('FactuSOL 1259', 26), ('FactuSOL 1260', 27), ('FactuSOL 1266', 33),
  ('FactuSOL 1268', 35), ('FactuSOL 1294', 61), ('FactuSOL 1297', 64), ('FactuSOL 1298', 65)) x(ref, orig)
where v.reservada and v.referencia = x.ref and v.numero > 1000000
  and not exists (select 1 from ventas o where o.empresa_id = v.empresa_id and o.numero = x.orig);

select json_build_object('reservadas', (select json_agg(numero) from ventas where reservada),
  'huecos', (select json_agg(g) from generate_series(1, (select max(numero) from ventas where numero < 1000000)) g where not exists (select 1 from ventas where numero = g)))::text r;
