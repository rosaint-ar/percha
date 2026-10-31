-- 098 · Caja de prueba del 31/10/2026 (pedido de Diego: "deshacé la caja abierta de hoy que era de prueba").
-- La abrió Emi a las 10:02 con $15.920; sin ventas ni movimientos. Se borra solo si sigue vacía.
-- La próxima caja vuelve a arrancar con lo que quedó en el cierre del 30/10 ($15.920). La #74 (web #2416) no es de la caja: no se toca.
delete from caja_turnos where id = '863197a6-3d2e-4a1a-836b-6a6f7848ee84' and estado = 'abierto'
  and not exists (select 1 from ventas v where v.turno_id = caja_turnos.id) and not exists (select 1 from caja_movimientos m where m.turno_id = caja_turnos.id);
select json_build_object('abiertas', (select count(*) from caja_turnos where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and estado <> 'cerrado'),
  'proxima_arranca_con', (select efectivo_queda from caja_turnos where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and estado = 'cerrado' order by cerrado desc limit 1));
