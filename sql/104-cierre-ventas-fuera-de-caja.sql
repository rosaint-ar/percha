-- 104 · Ventas fuera de la caja en el cierre (31/10/2026, Diego: "en el cierre de caja sí debería aparecer. Hay ventas que pueden
-- hacerse con la caja cerrada, por ejemplo ventas que entran después de su turno… con alguna diferenciación, pero tiene que estar").
-- Fuera de la caja = ventas sin turno (pedidos de la web, cargadas con la caja cerrada), no reservadas ni anuladas, que entraron
-- desde el cierre anterior de esa caja hasta este cierre. No van al cajón ni al arqueo: se muestran aparte y suman al total del día.
-- caja_esperado las trae en 'fuera'; al cerrar se guardan en caja_turnos.fuera_caja (el historial las muestra).
begin;
alter table caja_turnos add column if not exists fuera_caja jsonb;

create or replace function caja_fuera(p_turno uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with t as (select * from caja_turnos where id = p_turno),
  rango as (select t.empresa_id,
      coalesce((select max(c.cerrado) from caja_turnos c where c.caja_id = t.caja_id and c.estado = 'cerrado' and c.id <> t.id and c.cerrado <= t.abierto), t.abierto - interval '12 hours') desde,
      coalesce(t.cerrado, now()) hasta from t),
  v as (select v.* from ventas v, rango r where v.empresa_id = r.empresa_id and v.turno_id is null and not v.reservada and v.estado <> 'anulada'
          and v.numero < 1000000 and v.fecha > r.desde and v.fecha <= r.hasta)
  select jsonb_build_object('ventas', (select count(*) from v), 'total', (select coalesce(sum(total), 0) from v where estado = 'completada'),
    'lista', coalesce((select jsonb_agg(jsonb_build_object('numero', v.numero, 'fecha', v.fecha, 'origen', v.origen, 'total', v.total, 'estado', v.estado,
        'cliente', (select nombre from clientes c where c.id = v.cliente_id),
        'pagos', (select string_agg(coalesce(f.nombre, 'Nota de crédito / gift card'), ' + ') from venta_pagos p left join formas_pago f on f.id = p.forma_pago_id where p.venta_id = v.id)) order by v.fecha) from v), '[]'::jsonb))
$$;
revoke all on function caja_fuera(uuid) from anon, public;

create or replace function caja_esperado(p_turno uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
    'total', (select coalesce(sum(total), 0) from ventas where turno_id = p_turno and estado = 'completada' and not reservada),
    'fuera', caja_fuera(p_turno)
  ) into r;
  return r;
end $$;

CREATE OR REPLACE FUNCTION public.caja_historial(p_caja uuid, p_limite integer DEFAULT 60)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e uuid;
begin
  select empresa_id into e from cajas where id = p_caja;
  if e is null or not es_miembro(e) or not (puede(e, 'vender') or puede(e, 'ventas_todas')) then raise exception 'Sin permiso'; end if;
  return coalesce((select json_agg(x order by x.abierto desc) from (
    select t.id, t.abierto, t.cerrado, t.estado, t.efectivo_inicial, t.efectivo_queda, t.arqueo, t.notas, t.fuera_caja,
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
end $function$;
commit;
