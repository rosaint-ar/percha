-- "Crear en Percha" también sirve cuando el ítem del canal ya está cruzado a la variante ÚNICA de un producto
-- (Boob Tape: Percha lo tiene sin colores, Tienda Nube con Negro y Nude → se divide en Percha tomando el detalle del canal).
create or replace function canal_crear_variante(p_item bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it canal_items%rowtype; prod productos%rowtype; e uuid; t_id uuid; c_id uuid; v_id uuid; unica variantes%rowtype; dep uuid; st numeric; cod text; vact variantes%rowtype;
begin
  select * into it from canal_items where id = p_item;
  if it.id is null or not es_admin(it.empresa_id) then raise exception 'Sin permiso'; end if;
  e := it.empresa_id;
  if it.variante_id is not null then
    select * into vact from variantes where id = it.variante_id;
    if vact.talle_id is not null or vact.color_id is not null or vact.estampa_id is not null then raise exception 'Ya está cruzada a una variante con talle/color'; end if;
    select * into prod from productos where id = vact.producto_id;
  else
    select * into prod from productos where empresa_id = e and codigo = coalesce(it.sku, it.mpn);
  end if;
  if prod.id is null then raise exception 'El producto % no existe en Percha: crealo primero', coalesce(it.sku, it.mpn); end if;
  dep := (select id from depositos where empresa_id = e and principal limit 1);
  if coalesce(it.talle_canal, '') <> '' then
    select id into t_id from atributos where empresa_id = e and tipo = 'talle' and (lower(nombre) = lower(it.talle_canal) or lower(codigo) = lower(it.talle_canal)) limit 1;
    if t_id is null then
      cod := upper(left(regexp_replace(it.talle_canal, '[^A-Za-z0-9]', '', 'g'), 6)); if cod = '' then cod := 'T' || floor(random() * 1000)::int; end if;
      insert into atributos (empresa_id, tipo, codigo, nombre, orden) values (e, 'talle', cod, it.talle_canal, 999) on conflict (empresa_id, tipo, codigo) do update set nombre = atributos.nombre returning id into t_id;
    end if;
  end if;
  if coalesce(it.color_canal, '') <> '' then
    select id into c_id from atributos where empresa_id = e and tipo = 'color' and (lower(nombre) = lower(it.color_canal) or lower(codigo) = lower(it.color_canal)) limit 1;
    if c_id is null then
      cod := upper(left(regexp_replace(it.color_canal, '[^A-Za-z0-9]', '', 'g'), 3)); if cod = '' then cod := 'C' || floor(random() * 1000)::int; end if;
      insert into atributos (empresa_id, tipo, codigo, nombre, orden) values (e, 'color', cod, it.color_canal, 999) on conflict (empresa_id, tipo, codigo) do update set nombre = atributos.nombre returning id into c_id;
    end if;
  end if;
  if t_id is null and c_id is null then raise exception 'La variante del canal no tiene talle ni color: cruzala a mano'; end if;
  select id into v_id from variantes where producto_id = prod.id and talle_id is not distinct from t_id and color_id is not distinct from c_id and estampa_id is null;
  if v_id is null then
    insert into variantes (empresa_id, producto_id, talle_id, color_id, sku, ean)
    values (e, prod.id, t_id, c_id, prod.codigo || '-' || coalesce((select codigo from atributos where id = t_id), '') || '-' || coalesce((select codigo from atributos where id = c_id), ''), it.barcode)
    returning id into v_id;
    select * into unica from variantes where producto_id = prod.id and talle_id is null and color_id is null and estampa_id is null and activa limit 1;
    if unica.id is not null then
      st := coalesce(it.stock, 0);
      if st > 0 then
        insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) values (e, v_id, dep, st, 'ajuste', 'Variante creada desde ' || it.nombre || ' (' || coalesce(it.valores, '') || '): toma el stock del canal');
        insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) select e, unica.id, dep, -least(st, coalesce(sum(s.cantidad), 0)), 'ajuste', 'Pasa a la variante ' || coalesce(it.valores, '') from stock s where s.variante_id = unica.id having coalesce(sum(s.cantidad), 0) > 0;
      end if;
    end if;
    update productos set tiene_variantes = true where id = prod.id;
  end if;
  update canal_items set variante_id = v_id, cruce = 'manual' where id = it.id;
  if unica.id is not null and coalesce((select sum(cantidad) from stock where variante_id = unica.id), 0) <= 0
     and not exists (select 1 from canal_items where variante_id = unica.id and id <> it.id) then
    update variantes set activa = false where id = unica.id;
  end if;
  return jsonb_build_object('variante_id', v_id, 'creada', true);
end $$;
select (select count(*) from canal_cola where estado = 'pendiente') cola_pendiente;
