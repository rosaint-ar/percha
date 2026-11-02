-- 110 · Pedido cancelado en Tienda Nube → la venta se anula sola en Percha, con el motivo de Tienda Nube (02/11/2026, Diego:
-- "cuando se cancela en Tienda Nube, debe cancelarse en Percha con su motivo traído desde Tienda Nube").
-- El aviso de Tienda Nube (tn-pedidos) entra sin una persona logueada, y caja_anular_venta pedía ser miembro de la empresa:
-- la anulación automática fallaba en silencio (nunca hubo un caso real, se vio al probarlo). Ahora la función acepta también
-- al servidor (service_role, que solo usan las funciones de Percha); para las personas sigue todo igual.
begin;
create or replace function caja_anular_venta(p_venta uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v ventas%rowtype; m record; servidor boolean := coalesce(auth.role(), '') = 'service_role';
begin
  select * into v from ventas where id = p_venta for update;
  if v.id is null or not (servidor or es_miembro(v.empresa_id)) then raise exception 'Venta inexistente'; end if;
  if not servidor and not es_admin(v.empresa_id) and v.creado_por <> auth.uid() then raise exception 'Solo administración puede anular ventas de otra persona'; end if;
  if v.estado = 'anulada' then raise exception 'Ya estaba anulada'; end if;
  for m in select * from stock_movimientos where referencia = v.id::text and tipo in ('venta','devolucion') loop
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
    values (v.empresa_id, m.variante_id, m.deposito_id, -m.cantidad, 'ajuste', v.id::text, 'Anulación venta #' || v.numero, auth.uid());
  end loop;
  -- ventas viejas (sin unidad de falla registrada): se suma al total; las nuevas: la misma prenda vuelve a estar disponible
  update variantes x set fallas = x.fallas + l.cantidad from venta_lineas l where l.venta_id = v.id and l.falla and l.variante_id = x.id
    and not exists (select 1 from variante_fallas f where f.linea_id = l.id);
  update variante_fallas set estado = 'disponible', venta_id = null, linea_id = null, cerrada = null where venta_id = v.id and estado = 'vendida';
  update creditos c set saldo = c.saldo + vp.monto, estado = 'vigente' from venta_pagos vp where vp.venta_id = v.id and vp.credito_id = c.id;
  update creditos set estado = 'anulado' where origen_venta_id = v.id and saldo = monto;
  update ventas set estado = 'anulada', anulada_por = auth.uid(), anulada_fecha = now(), anulada_motivo = p_motivo where id = v.id;
end $$;
commit;
