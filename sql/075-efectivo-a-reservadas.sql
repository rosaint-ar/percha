-- 075 · Las ventas pagadas 100% en efectivo van a la vista reservada (ghost): se facturan distinto y no se listan en la vista normal.
-- (pedido de Diego 28/10). Las mixtas (parte efectivo, parte otro medio) quedan en la vista normal.
-- 1) caja_registrar_venta lo decide al registrar (numeración R-). 2) caja_esperado cuenta el efectivo de las reservadas
-- (está en el cajón). 3) Las ya cargadas pagadas 100% en efectivo pasan a reservadas con número R-.
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
  -- pagada 100% en efectivo → va a la vista reservada (se factura distinto y no se lista en la vista normal)
  if not es_res and v_tipo = 'venta' and v_estado = 'completada' and v_total > 0 and jsonb_array_length(coalesce(p->'pagos', '[]'::jsonb)) > 0
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

create or replace function caja_esperado(p_turno uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $f$
declare t caja_turnos%rowtype; r jsonb;
begin
  select * into t from caja_turnos where id = p_turno;
  if t.id is null or not es_miembro(t.empresa_id) then raise exception 'Sin permiso'; end if;
  with pagos as (
    select vp.forma_pago_id, sum(vp.monto) monto, count(distinct vp.venta_id) ventas
    from venta_pagos vp join ventas v on v.id = vp.venta_id
    where vp.turno_id = p_turno and v.estado <> 'anulada' and vp.credito_id is null
    group by vp.forma_pago_id
  ), mov as (select coalesce(sum(case when tipo = 'ingreso' then monto else -monto end), 0) neto from caja_movimientos where turno_id = p_turno)
  select jsonb_build_object(
    'formas', coalesce((select jsonb_agg(jsonb_build_object('forma_pago_id', fp.id, 'nombre', fp.nombre, 'tipo', fp.tipo, 'ventas', coalesce(pg.ventas, 0),
                 'esperado', coalesce(pg.monto, 0) + case when fp.tipo = 'efectivo' then t.efectivo_inicial + (select neto from mov) else 0 end) order by fp.orden)
               from formas_pago fp left join pagos pg on pg.forma_pago_id = fp.id
               where fp.empresa_id = t.empresa_id and (fp.activa or pg.monto is not null)), '[]'::jsonb),
    'efectivo_inicial', t.efectivo_inicial,
    'movimientos', (select neto from mov),
    'ventas', (select count(*) from ventas where turno_id = p_turno and estado <> 'anulada' and not reservada),
    'total', (select coalesce(sum(total), 0) from ventas where turno_id = p_turno and estado = 'completada' and not reservada)
  ) into r;
  return r;
end $f$;

-- 3) las ya cargadas, pagadas 100% en efectivo y sin factura → reservadas con número R-
do $$
declare v record; n int := 0;
begin
  for v in select * from ventas vt where not vt.reservada and vt.estado = 'completada' and vt.tipo = 'venta' and vt.total > 0
             and exists (select 1 from venta_pagos p where p.venta_id = vt.id)
             and not exists (select 1 from venta_pagos p left join formas_pago f on f.id = p.forma_pago_id where p.venta_id = vt.id and (p.credito_id is not null or coalesce(f.grupo, '') <> 'efectivo'))
             and not exists (select 1 from comprobantes c where c.venta_id = vt.id)
           order by vt.fecha loop
    update ventas set reservada = true, numero = 1000000 + proximo_numero(v.empresa_id, 'r') where id = v.id;
    n := n + 1;
  end loop;
  raise notice 'pasadas a reservadas: %', n;
end $$;

select json_build_object('reservadas', (select json_agg(json_build_object('r', 'R-' || lpad((numero - 1000000)::text, 6, '0'), 'f', fecha::date, 'total', total, 'ref', referencia) order by numero) from ventas where reservada),
  'normales_efectivo', (select count(*) from ventas v where not reservada and not exists (select 1 from venta_pagos p left join formas_pago f on f.id = p.forma_pago_id where p.venta_id = v.id and coalesce(f.grupo,'') <> 'efectivo') and exists (select 1 from venta_pagos p where p.venta_id = v.id)));
