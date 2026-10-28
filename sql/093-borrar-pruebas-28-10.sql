-- 093 · Pruebas del 28/10/2026 en el local (pedido de Diego: "borrá las ventas de hoy, fueron de prueba, y la caja trae la última de FactuSOL").
-- 1) Las 7 ventas de hoy (#72 a #78, cargadas 20:12–20:26 en la caja) con venta_borrar_prueba: deshace el stock y avisa a la web.
-- 2) Los 3 turnos de prueba de hoy (17:48, 19:59 y 20:31), que quedan vacíos.
-- 3) El cierre de hoy de TPVsol (28/10, cerró 20:35 con $12.920 de inicial y $12.920 que quedan), como en 087:
--    la próxima caja arranca con ese cambio.
-- 4) Numeración: la última venta real es la #69 → la próxima vuelve a ser #70 (se liberan los números reservados de las pruebas).
begin;
select set_config('request.jwt.claims', '{"sub":"5f43c17d-958a-4ef7-badc-1a4001a20747","role":"authenticated"}', true);
create temp table r(x json) on commit drop;
grant all on r to authenticated;
set local role authenticated;
insert into r select venta_borrar_prueba(v.id) from (
  select id from ventas where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and numero between 72 and 78
    and (fecha at time zone 'America/Argentina/Buenos_Aires')::date = '2026-10-28' order by numero desc) v;
reset role;
select json_agg(x) borradas from r;

delete from caja_turnos where id in ('30372ca2-c896-402e-ade1-e4d566dbabf3', '2f69b2db-468d-4582-8c39-44d5c9089ad9', '49ed7f1e-ad0d-457e-a08e-7d6d5eddf00f')
  and not exists (select 1 from ventas v where v.turno_id = caja_turnos.id) and not exists (select 1 from caja_movimientos m where m.turno_id = caja_turnos.id);

insert into caja_turnos (empresa_id, caja_id, abierto_por, abierto, cerrado, estado, efectivo_inicial, efectivo_queda, arqueo, notas)
 select c.empresa_id, c.id, (select user_id from empresa_usuarios u where u.empresa_id = c.empresa_id and u.rol = 'duenio' order by u.user_id limit 1),
   ('2026-10-28 10:00'::timestamp at time zone 'America/Argentina/Buenos_Aires'), ('2026-10-28 20:35:00'::timestamp at time zone 'America/Argentina/Buenos_Aires'), 'cerrado', 12920, 12920,
   jsonb_build_array(jsonb_build_object('forma_pago_id', (select id from formas_pago f where f.empresa_id = c.empresa_id and f.tipo = 'efectivo' order by f.orden limit 1), 'nombre', 'Efectivo', 'esperado', 12920, 'declarado', 12920, 'diferencia', 0)), 'Traído de TPVsol · 2026-10-28'
 from (select * from cajas where activa and empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' order by nombre limit 1) c
 where not exists (select 1 from caja_turnos t where t.notas = 'Traído de TPVsol · 2026-10-28');

delete from venta_numeros where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and numero >= 70 and usado is null
  and not exists (select 1 from ventas v where v.empresa_id = venta_numeros.empresa_id and v.numero = venta_numeros.numero);
delete from venta_numeros where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and numero >= 70
  and not exists (select 1 from ventas v where v.empresa_id = venta_numeros.empresa_id and v.numero = venta_numeros.numero);
update secuencias set valor = (select coalesce(max(numero), 0) from ventas where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and numero < 1000000)
 where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and nombre = 'venta';

select (select count(*) from ventas where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and (fecha at time zone 'America/Argentina/Buenos_Aires')::date = '2026-10-28') ventas_hoy,
       (select valor from secuencias where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and nombre = 'venta') ultima_venta,
       (select json_agg(json_build_object('notas', notas, 'abierto', abierto, 'cerrado', cerrado, 'queda', efectivo_queda) order by cerrado desc) from (select * from caja_turnos where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' order by cerrado desc limit 2) t) ultimas_cajas,
       (select count(*) from caja_turnos where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and estado <> 'cerrado') abiertas;
commit;
