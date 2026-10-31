-- 101 · Seña como cupón (31/10/2026, Diego: "la seña sería mejor que funcione igual que las notas de crédito… un cupón para
-- mandarlo por WhatsApp, con un código"). El número de la venta es el código para retirar.
-- 1) senas_buscar(e, q): las señas pendientes (por número, clienta o teléfono), con sus prendas. Para quien vende, aunque solo
--    vea sus ventas del día (las señas se retiran otro día y las puede haber tomado otra persona).
-- 2) caja_completar_sena: el resto se cobra según el medio, como en los cambios: lo que falta vale lo mismo en otra lista
--    (una seña de Contado con $12.000 de saldo son $15.000 pagando con tarjeta). La diferencia queda como recargo de la venta.
--    Además, si se paga con nota de crédito, se descuenta de su saldo (antes no se descontaba).
begin;
create or replace function senas_buscar(e uuid, q text default '') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare w text := lower(trim(coalesce(q, ''))); n bigint;
begin
  if not es_miembro(e) or not puede(e, 'vender') then raise exception 'Sin permiso'; end if;
  if w ~ '^#?\s*\d+$' then n := regexp_replace(w, '\D', '', 'g')::bigint; end if;
  return coalesce((select jsonb_agg(x order by x.fecha desc) from (
    select v.id, v.numero, v.fecha, v.total, v.pagado, v.saldo, v.lista_id, v.nota, c.nombre cliente, c.telefono,
      (select jsonb_agg(jsonb_build_object('cantidad', l.cantidad, 'descripcion', l.descripcion, 'talle', l.talle, 'color', l.color, 'total', l.total, 'variante_id', l.variante_id) order by l.id) from venta_lineas l where l.venta_id = v.id) lineas,
      (select string_agg(coalesce(f.nombre, 'Nota de crédito') || ' ' || p.monto::bigint, ' + ') from venta_pagos p left join formas_pago f on f.id = p.forma_pago_id where p.venta_id = v.id) pagos
    from ventas v left join clientes c on c.id = v.cliente_id
    where v.empresa_id = e and v.estado = 'senada'
      and (w = '' or v.numero = n or lower(coalesce(c.nombre, '')) like '%' || w || '%' or coalesce(c.telefono, '') like '%' || w || '%'
           or exists (select 1 from venta_lineas l where l.venta_id = v.id and lower(l.descripcion) like '%' || w || '%'))
    limit 30) x), '[]'::jsonb);
end $$;
revoke all on function senas_buscar(uuid, text) from anon;
grant execute on function senas_buscar(uuid, text) to authenticated;

create or replace function caja_completar_sena(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e uuid := (p->>'empresa_id')::uuid; v ventas%rowtype; pg jsonb; v_pagado numeric := 0; cred creditos%rowtype; cons numeric;
  v_rec numeric := round(coalesce((p->>'recargo')::numeric, 0), 2);
begin
  if not es_miembro(e) or rol_en(e) = 'visor' then raise exception 'Sin permiso'; end if;
  select * into v from ventas where id = (p->>'venta_id')::uuid and empresa_id = e for update;
  if v.id is null or v.estado <> 'senada' then raise exception 'La seña no existe o ya fue retirada'; end if;
  for pg in select * from jsonb_array_elements(coalesce(p->'pagos', '[]'::jsonb)) loop
    v_pagado := v_pagado + (pg->>'monto')::numeric;
    insert into venta_pagos (venta_id, empresa_id, turno_id, forma_pago_id, credito_id, monto, cuotas, recargo_pct, referencia)
    values (v.id, e, (p->>'turno_id')::uuid, (pg->>'forma_pago_id')::uuid, (pg->>'credito_id')::uuid, (pg->>'monto')::numeric, coalesce((pg->>'cuotas')::int, 1), coalesce((pg->>'recargo_pct')::numeric, 0), pg->>'referencia');
    if pg->>'credito_id' is not null then
      cons := coalesce((pg->>'consumo')::numeric, (pg->>'monto')::numeric);
      select * into cred from creditos where id = (pg->>'credito_id')::uuid and empresa_id = e for update;
      if cred.id is null or cred.estado <> 'vigente' then raise exception 'El crédito no está vigente'; end if;
      if cred.saldo < cons - 0.01 or cons < 0 then raise exception 'El crédito no tiene saldo suficiente'; end if;
      update creditos set saldo = round(saldo - cons, 2), estado = case when round(saldo - cons, 2) <= 0 then 'usado' else 'vigente' end where id = cred.id;
    end if;
  end loop;
  if abs((v.pagado + v_pagado) - (v.total + v_rec)) > 0.5 then raise exception 'Falta pagar % para completar', v.total + v_rec - v.pagado - v_pagado; end if;
  update ventas set pagado = v.pagado + v_pagado, saldo = 0, estado = 'completada', total = round(v.total + v_rec, 2), recargo = round(coalesce(v.recargo, 0) + v_rec, 2),
         turno_id = coalesce((p->>'turno_id')::uuid, ventas.turno_id) where id = v.id;
  return jsonb_build_object('id', v.id, 'numero', v.numero, 'total', round(v.total + v_rec, 2));
end $$;
commit;
