-- 072 · Bola lavarropa: en la web es una publicación con dos tamaños (34 cm $3.000 · 47 cm $5.000); en Percha era una sola prenda a $2.500
do $$
declare e uuid; p uuid; vieja uuid; t34 uuid; t47 uuid; v34 uuid; v47 uuid; lote uuid;
begin
  select id, empresa_id into p, e from productos where codigo = '900502';
  select variante_id into vieja from canal_items where producto_ext = '139159856' limit 1;
  insert into precio_lotes (empresa_id, descripcion, productos, cambios) values (e, 'Bola lavarropa: dos tamaños como en la web', 1, 2) returning id into lote;
  perform set_config('percha.lote', lote::text, true);
  t34 := atributo_desde_canal(e, 'talle', '34 cm'); t47 := atributo_desde_canal(e, 'talle', '47 cm');
  insert into variantes (empresa_id, producto_id, talle_id, sku) values (e, p, t34, '900502-34') returning id into v34;
  insert into variantes (empresa_id, producto_id, talle_id, sku, precio) values (e, p, t47, '900502-47', 5000) returning id into v47;
  update productos set precio = 3000, tiene_variantes = true where id = p;
  update canal_items set variante_id = v34, cruce = 'manual' where producto_ext = '139159856' and valores = '34cm';
  update canal_items set variante_id = v47, cruce = 'manual' where producto_ext = '139159856' and valores = '47cm';
  if coalesce((select sum(cantidad) from stock where variante_id = vieja), 0) = 0 and not exists (select 1 from canal_items where variante_id = vieja) then update variantes set activa = false where id = vieja; end if;
end $$;
select json_agg(json_build_object('web', ci.valores || ' ' || ci.precio, 'percha', concat_ws(' · ', vv.talle_nombre, vv.precio), 'activa_vieja', (select count(*) from variantes v where v.producto_id = vv.producto_id and v.activa))) from canal_items ci join v_variantes vv on vv.id = ci.variante_id where ci.producto_ext = '139159856';
