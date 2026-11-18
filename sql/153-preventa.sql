-- 153 · PREVENTA (18/11/2026, Diego: «quiero largar preventa de este producto para ver qué se vende… poner dos de cada
-- talle… y en base a eso COMPRAR al proveedor»). Sin stock falso: la web muestra stock real + cupo por talle·color.
--   productos.preventa_cupo: unidades por talle·color que la web puede vender sin stock (null/0 = sin preventa)
--   productos.preventa_entrega: fecha estimada de entrega (se avisa en la ficha y en la web)
-- Cada venta web deja el stock de Percha en negativo: ese negativo es lo vendido en preventa (lo que hay que pedir). Al
-- llegar la mercadería (compra/remito) el stock sube y cubre esos pedidos; después se apaga la preventa.
alter table productos add column if not exists preventa_cupo int, add column if not exists preventa_entrega date;
alter table productos drop constraint if exists productos_preventa_cupo_chk;
alter table productos add constraint productos_preventa_cupo_chk check (preventa_cupo is null or preventa_cupo between 0 and 50);

-- vender en preventa no deja el aviso «se vendió sin stock» (solo si se pasa del cupo)
create or replace function venta_linea_mover_stock(e uuid, v_id uuid, v_num bigint, v_lin bigint, dep uuid, l jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare tipo_prod text; c jsonb; comp record; v_comp uuid; cant numeric := (l->>'cantidad')::numeric; mov_tipo text; vid uuid; es_falla boolean; antes numeric; f numeric; sin_control boolean; preventa int;
begin
  mov_tipo := case when cant < 0 then 'devolucion' else 'venta' end;
  select tipo into tipo_prod from productos where id = (l->>'producto_id')::uuid;
  if tipo_prod = 'kit' then
    if jsonb_typeof(l->'componentes') = 'array' and jsonb_array_length(l->'componentes') > 0 then
      for c in select * from jsonb_array_elements(l->'componentes') loop
        insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id, linea_id)
        values (e, (c->>'variante_id')::uuid, dep, -(sign(cant) * (c->>'cantidad')::numeric), mov_tipo, v_id::text, coalesce('Venta #' || v_num, 'Venta') || ' · kit ' || (l->>'descripcion'), auth.uid(), v_lin);
      end loop;
    else
      for comp in select variante_id, componente_producto_id, filtro, cantidad from producto_componentes where producto_id = (l->>'producto_id')::uuid loop
        v_comp := coalesce(comp.variante_id,
                           case when comp.componente_producto_id is not null then variante_indefinida(comp.componente_producto_id) end,
                           case when comp.filtro->>'defecto_producto_id' is not null then variante_indefinida((comp.filtro->>'defecto_producto_id')::uuid) end);
        if v_comp is not null then
          insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id, linea_id)
          values (e, v_comp, dep, -(cant * comp.cantidad), mov_tipo, v_id::text, coalesce('Venta #' || v_num, 'Venta') || ' · kit ' || (l->>'descripcion') || case when comp.variante_id is null then ' (sin definir)' else '' end, auth.uid(), v_lin);
        end if;
      end loop;
    end if;
  elsif l->>'variante_id' is not null then
    vid := (l->>'variante_id')::uuid; es_falla := coalesce((l->>'falla')::boolean, false);
    select coalesce(sum(cantidad), 0) into antes from stock where variante_id = vid;
    select v.fallas, p.es_generico or coalesce(v.sku, '') like '%-SD', coalesce(p.preventa_cupo, 0) into f, sin_control, preventa from variantes v join productos p on p.id = v.producto_id where v.id = vid;
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id, linea_id)
    values (e, vid, dep, -cant, mov_tipo, v_id::text, coalesce('Venta #' || v_num, 'Venta') || case when es_falla then ' · con falla' else '' end, auth.uid(), v_lin);
    if es_falla then
      update venta_lineas set falla = true where id = v_lin;
      update variantes set fallas = greatest(fallas - cant, 0) where id = vid;
    elsif cant > 0 and not sin_control then
      -- se vendió más de lo que había: queda el recordatorio para corregir el stock
      -- en preventa (sql/153) vender sin stock es lo esperado: lo negativo es lo vendido a cuenta
      if antes < cant and not (preventa > 0 and antes - cant >= -preventa) then
        insert into stock_revisar (empresa_id, variante_id, venta_id, linea_id, motivo, detalle)
        values (e, vid, v_id, v_lin, 'sin_stock', coalesce('Venta #' || v_num, 'Venta') || ': se vendieron ' || cant::int || ' y el sistema tenía ' || antes::int);
      elsif f > 0 and antes - f < cant then
        insert into stock_revisar (empresa_id, variante_id, venta_id, linea_id, motivo, detalle)
        values (e, vid, v_id, v_lin, 'falla', coalesce('Venta #' || v_num, 'Venta') || ': se vendió sin marcar la falla y solo quedaban las que tienen falla');
      end if;
      -- nunca puede haber más con falla que stock
      update variantes set fallas = greatest(antes - cant, 0) where id = vid and fallas > greatest(antes - cant, 0);
    end if;
  end if;
end $$;


-- cambiar el cupo también manda el stock a la web (la cola de tn-push solo se llenaba con cambios de stock)
create or replace function productos_preventa_encolar() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.preventa_cupo, 0) is distinct from coalesce(old.preventa_cupo, 0) then
    perform encolar_canal(new.empresa_id, v.id) from variantes v where v.producto_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists productos_preventa_encolar on productos;
create trigger productos_preventa_encolar after update of preventa_cupo on productos for each row execute function productos_preventa_encolar();
