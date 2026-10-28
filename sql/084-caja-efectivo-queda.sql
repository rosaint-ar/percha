-- 084 · Cierre de caja: cuánto efectivo queda en la caja para el día siguiente (28/10/2026).
-- Al abrir, se propone ese monto como efectivo inicial.
alter table caja_turnos add column if not exists efectivo_queda numeric;
select count(*) from caja_turnos;
