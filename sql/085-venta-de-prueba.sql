-- 085 · "Era de prueba": borra una venta como si nunca hubiera existido (28/10/2026, pedido de Diego).
-- Vuelve el stock (y se avisa a la web), se sacan los pagos de la caja, se devuelven las notas de crédito usadas,
-- y si era la última de su numeración, el número se vuelve a usar. No queda registro.
-- No se puede con: pedidos de la web (se volverían a traer), ventas facturadas, ventas con un cambio hecho encima,
-- o que emitieron una gift card / nota de crédito que ya se usó.
create or replace function venta_borrar_prueba(p_venta uuid) returns json
language plpgsql security definer set search_path = public as $$
declare v ventas%rowtype; m record; sec text; n int := 0;
begin
  select * into v from ventas where id = p_venta for update;
  if v.id is null or not es_miembro(v.empresa_id) then raise exception 'Venta inexistente'; end if;
  if not es_admin(v.empresa_id) and v.creado_por is distinct from auth.uid() then raise exception 'Solo administración puede borrar ventas de otra persona'; end if;
  if v.origen = 'tiendanube' or exists (select 1 from canal_pedidos where venta_id = v.id) then raise exception 'Los pedidos de la web no se borran (se volverían a traer). Anulalo.'; end if;
  if exists (select 1 from comprobantes where venta_id = v.id and estado = 'autorizado') then raise exception 'La venta está facturada: no se puede borrar. Anulala (sale sola la nota de crédito).'; end if;
  if exists (select 1 from ventas where venta_origen_id = v.id) then raise exception 'Sobre esta venta se hizo un cambio: primero borrá ese cambio.'; end if;
  if exists (select 1 from creditos where origen_venta_id = v.id and saldo < monto) then raise exception 'La gift card o nota de crédito que generó esta venta ya se usó.'; end if;

  -- stock: se deshace cada movimiento de la venta (y de su anulación, si la tuvo) y se borra, sin dejar ajuste
  for m in select * from stock_movimientos where referencia = v.id::text loop
    update stock set cantidad = cantidad - m.cantidad where variante_id = m.variante_id and deposito_id is not distinct from m.deposito_id;
    delete from stock_movimientos where id = m.id;
    perform encolar_canal(v.empresa_id, m.variante_id);   -- la web se entera del stock nuevo
    n := n + 1;
  end loop;
  -- prendas con falla: vuelven a estar disponibles (igual que al anular)
  if v.estado <> 'anulada' then
    update variantes x set fallas = x.fallas + l.cantidad from venta_lineas l where l.venta_id = v.id and l.falla and l.variante_id = x.id
      and not exists (select 1 from variante_fallas f where f.linea_id = l.id);
    update variante_fallas set estado = 'disponible', venta_id = null, linea_id = null, cerrada = null where venta_id = v.id and estado = 'vendida';
    -- notas de crédito / gift cards con las que se pagó: recuperan el saldo
    update creditos c set saldo = c.saldo + vp.monto, estado = 'vigente' from venta_pagos vp where vp.venta_id = v.id and vp.credito_id = c.id;
  end if;
  update variante_fallas set venta_id = null where venta_id = v.id;
  delete from creditos where origen_venta_id = v.id;
  delete from stock_revisar where venta_id = v.id;
  delete from comprobantes where venta_id = v.id;            -- solo pueden quedar intentos sin autorizar
  delete from ventas where id = v.id;                         -- se van con ella las líneas y los pagos (y sale de la caja)

  -- si era la última de su numeración, el número se reutiliza
  sec := case when v.numero > 1000000 then 'r' else 'venta' end;
  update secuencias set valor = valor - 1 where empresa_id = v.empresa_id and nombre = sec
    and valor = case when sec = 'r' then v.numero - 1000000 else v.numero end;
  return json_build_object('numero', v.numero, 'movimientos', n);
end $$;
revoke all on function venta_borrar_prueba(uuid) from anon;
grant execute on function venta_borrar_prueba(uuid) to authenticated;

-- la venta de prueba #70 que se borró a mano el 28/10 dejó el contador en 70: se corrige para que la próxima sea la #70
update secuencias s set valor = (select coalesce(max(numero), 0) from ventas v where v.empresa_id = s.empresa_id and v.numero < 1000000)
where s.nombre = 'venta' and s.valor > (select coalesce(max(numero), 0) from ventas v where v.empresa_id = s.empresa_id and v.numero < 1000000);

select json_agg(json_build_object('n', nombre, 'v', valor)) from secuencias;
