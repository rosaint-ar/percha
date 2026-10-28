-- 086 · Pantalla Caja: historial de turnos (aperturas y cierres) con lo vendido y el arqueo (28/10/2026).
-- Cuenta igual que caja_esperado: ventas no anuladas y no reservadas. "medios" = lo cobrado por cada medio de pago.
create or replace function caja_historial(p_caja uuid, p_limite int default 60) returns json
language plpgsql stable security definer set search_path = public as $$
declare e uuid;
begin
  select empresa_id into e from cajas where id = p_caja;
  if e is null or not es_miembro(e) or not (puede(e, 'vender') or puede(e, 'ventas_todas')) then raise exception 'Sin permiso'; end if;
  return coalesce((select json_agg(x order by x.abierto desc) from (
    select t.id, t.abierto, t.cerrado, t.estado, t.efectivo_inicial, t.efectivo_queda, t.arqueo, t.notas,
      case when t.notas like 'Traído de TPVsol%' then 'TPVsol' else (select nombre from empresa_usuarios u where u.empresa_id = e and u.user_id = t.abierto_por) end as abrio,
      (select nombre from empresa_usuarios u where u.empresa_id = e and u.user_id = t.cerrado_por) as cerro,
      (select count(*) from ventas v where v.turno_id = t.id and v.estado <> 'anulada' and not v.reservada) as ventas,
      (select coalesce(sum(total), 0) from ventas v where v.turno_id = t.id and v.estado = 'completada' and not v.reservada) as total,
      (select coalesce(sum(case when tipo = 'ingreso' then monto else -monto end), 0) from caja_movimientos m where m.turno_id = t.id) as movimientos,
      -- desglose de lo cobrado por medio de pago (sin las reservadas, igual que 'total')
      (select coalesce(json_agg(json_build_object('nombre', z.nombre, 'tipo', z.tipo, 'monto', z.monto, 'ventas', z.n) order by z.monto desc), '[]'::json) from (
        select coalesce(f.nombre, case when c.tipo = 'gift_card' then 'Gift card' when c.id is not null then 'Nota de crédito' else 'Otro' end) as nombre, f.tipo,
               sum(p.monto) as monto, count(distinct p.venta_id) as n
        from venta_pagos p join ventas v on v.id = p.venta_id left join formas_pago f on f.id = p.forma_pago_id left join creditos c on c.id = p.credito_id
        where v.turno_id = t.id and v.estado <> 'anulada' and not v.reservada group by 1, 2) z) as medios
    from caja_turnos t where t.caja_id = p_caja order by t.abierto desc limit p_limite) x), '[]'::json);
end $$;
revoke all on function caja_historial(uuid, int) from anon;
grant execute on function caja_historial(uuid, int) to authenticated;
select 'ok';
