-- 018 · "Tienda Nube manda" (hasta el corte a Percha): el local toma del canal el stock, el nombre y las variantes de todo lo cruzado.
--       Reversible: todo queda como ajustes en stock_movimientos y el nombre anterior en la descripción.
--       + los productos nuevos del canal se crean activos/inactivos según estén publicados.

create or replace function canal_tomar_todo(p_conexion uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e uuid; dep uuid; r record; n_stock int := 0; n_nombres int := 0; n_apagadas int := 0; nuevo_nombre text; marca text;
begin
  select empresa_id into e from conexiones where id = p_conexion;
  if e is null or not es_admin(e) then raise exception 'Sin permiso'; end if;
  dep := (select id from depositos where empresa_id = e and principal limit 1);
  marca := 'Tienda Nube manda · ' || to_char(now() at time zone 'America/Argentina/Cordoba', 'DD/MM HH24:MI');
  -- 1) stock: cada variante del local cruzada toma la suma del stock del canal (si varias variantes del canal apuntan a la misma)
  for r in
    select ci.variante_id, sum(ci.stock) canal, coalesce((select sum(s.cantidad) from stock s where s.variante_id = ci.variante_id), 0) local
    from canal_items ci join variantes v on v.id = ci.variante_id join productos p on p.id = v.producto_id
    where ci.conexion_id = p_conexion and ci.stock is not null and p.tipo <> 'kit'
    group by ci.variante_id
  loop
    if r.canal <> r.local then
      insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) values (e, r.variante_id, dep, r.canal - r.local, 'ajuste', marca || ' (local ' || r.local || ' → canal ' || r.canal || ')');
      n_stock := n_stock + 1;
    end if;
  end loop;
  -- 2) nombres: NO se tocan (feedback 22/10: los nombres son de Emi; se corrigen a mano, por tandas)
  -- 3) variantes del local que el canal no tiene y están en 0: se apagan (quedan para reactivar si hace falta)
  update variantes v set activa = false
  from productos p
  where p.id = v.producto_id and v.empresa_id = e and v.activa and p.tipo <> 'kit'
    and exists (select 1 from canal_items ci join variantes v2 on v2.id = ci.variante_id where ci.conexion_id = p_conexion and v2.producto_id = p.id)
    and not exists (select 1 from canal_items ci where ci.conexion_id = p_conexion and ci.variante_id = v.id)
    and coalesce((select sum(s.cantidad) from stock s where s.variante_id = v.id), 0) = 0
    and (v.talle_id is not null or v.color_id is not null or v.estampa_id is not null);
  get diagnostics n_apagadas = row_count;
  return jsonb_build_object('stock_ajustados', n_stock, 'nombres_cambiados', n_nombres, 'variantes_apagadas', n_apagadas);
end $$;

-- los productos nuevos del canal nacen activos solo si están publicados
create or replace function canal_crear_producto(p_conexion uuid, p_producto_ext text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e uuid; it record; prod_id uuid; cod text; base text; nom text; img text; pre numeric; cat uuid; dep uuid; bolsa variantes%rowtype;
        t_id uuid; c_id uuid; v_id uuid; st numeric; disponible numeric; n int := 0; tiene boolean := false; movidas numeric := 0; pub boolean;
begin
  select empresa_id into e from conexiones where id = p_conexion;
  if e is null or not es_admin(e) then raise exception 'Sin permiso'; end if;
  if not exists (select 1 from canal_items where conexion_id = p_conexion and producto_ext = p_producto_ext) then raise exception 'Ese producto no está en el canal'; end if;
  if exists (select 1 from canal_items ci join variantes v on v.id = ci.variante_id where ci.conexion_id = p_conexion and ci.producto_ext = p_producto_ext and (v.talle_id is not null or v.color_id is not null or v.estampa_id is not null)) then
    raise exception 'Ya está cruzado a un producto del local con talle/color';
  end if;
  select coalesce(ci.sku, ci.mpn), ci.nombre, ci.imagen into base, nom, img from canal_items ci where ci.conexion_id = p_conexion and ci.producto_ext = p_producto_ext order by ci.id limit 1;
  select min(precio), bool_or(coalesce(publicado, true)) into pre, pub from canal_items where conexion_id = p_conexion and producto_ext = p_producto_ext;
  select v.* into bolsa from canal_items ci join variantes v on v.id = ci.variante_id where ci.conexion_id = p_conexion and ci.producto_ext = p_producto_ext limit 1;
  cat := coalesce((select categoria_id from productos where id = bolsa.producto_id), (select categoria_id from productos where empresa_id = e and codigo = base limit 1),
                  (select categoria_id from productos where empresa_id = e and categoria_id is not null and upper(split_part(nombre, ' ', 1)) = upper(split_part(nom, ' ', 1)) group by categoria_id order by count(*) desc limit 1));
  dep := (select id from depositos where empresa_id = e and principal limit 1);
  select id, codigo into prod_id, cod from productos where empresa_id = e and activo and tipo = 'prenda' and id is distinct from bolsa.producto_id
    and lower(regexp_replace(nombre, '\s+', ' ', 'g')) = lower(regexp_replace(nom, '\s+', ' ', 'g')) order by creado limit 1;
  if prod_id is null then
    cod := proximo_codigo(e, coalesce(base, 'P'));
    insert into productos (empresa_id, codigo, nombre, categoria_id, precio, tipo, imagen_url, descripcion, activo)
    values (e, cod, nom, cat, coalesce(pre, 0), 'prenda', img, 'Creado desde el canal · SKU compartido ' || coalesce(base, ''), coalesce(pub, true)) returning id into prod_id;
  else
    update productos set imagen_url = coalesce(imagen_url, img) where id = prod_id;
  end if;
  for it in select * from canal_items where conexion_id = p_conexion and producto_ext = p_producto_ext order by id loop
    t_id := atributo_desde_canal(e, 'talle', it.talle_canal);
    c_id := atributo_desde_canal(e, 'color', it.color_canal);
    if t_id is not null or c_id is not null then tiene := true; end if;
    select id into v_id from variantes where producto_id = prod_id and talle_id is not distinct from t_id and color_id is not distinct from c_id and estampa_id is null;
    if v_id is null then
      insert into variantes (empresa_id, producto_id, talle_id, color_id, sku, ean, precio)
      values (e, prod_id, t_id, c_id,
              cod || coalesce('-' || (select codigo from atributos where id = t_id), '') || coalesce('-' || (select codigo from atributos where id = c_id), ''),
              nullif(it.barcode, ''), case when it.precio is not null and it.precio > 0 and it.precio <> coalesce(pre, 0) then it.precio end)
      returning id into v_id;
    end if;
    st := coalesce(it.stock, 0);
    if st > 0 then
      insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) values (e, v_id, dep, st, 'ajuste', 'Alta desde el canal: ' || it.nombre || ' (' || coalesce(it.valores, '') || ') toma el stock publicado');
      if bolsa.id is not null then
        disponible := coalesce((select sum(cantidad) from stock where variante_id = bolsa.id), 0);
        if disponible > 0 then
          insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) values (e, bolsa.id, dep, -least(st, disponible), 'ajuste', 'Pasa a ' || cod || ' ' || nom || ' (' || coalesce(it.valores, '') || ')');
          movidas := movidas + least(st, disponible);
        end if;
      end if;
    end if;
    update canal_items set variante_id = v_id, cruce = 'manual' where id = it.id;
    n := n + 1;
  end loop;
  update productos set tiene_variantes = tiene or tiene_variantes where id = prod_id;
  return jsonb_build_object('producto_id', prod_id, 'codigo', cod, 'nombre', nom, 'variantes', n, 'stock_movido', movidas, 'activo', coalesce(pub, true));
end $$;

-- todo lo que falta del canal, de una (packs y ocultos incluidos)
create or replace function canal_crear_todos(p_conexion uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare exts text[];
begin
  select array_agg(producto_ext order by sku, nombre) into exts from v_canal_nuevos where conexion_id = p_conexion;
  if exts is null then return jsonb_build_object('creados', '[]'::jsonb, 'errores', '[]'::jsonb); end if;
  return canal_crear_productos(p_conexion, exts);
end $$;
