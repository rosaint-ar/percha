-- 108 · Pantuflones animados: UN producto con los animales adentro, como un conjunto con sus colores (31/10/2026, Emi/Diego:
-- "quiero poner pantufla y que salga Pantuflón animado premium y adentro esté capibara, chanchito, gatito… es como cualquier
-- conjunto, como la Alondra… que quede todo bajo un código").
-- · 910103 PANTUFLÓN «ANIMADOS» PREMIUM vuelve a estar activo (como producto normal, no código común) y recibe los talles
--   activos de los 12 animales. Cada animal pasa a ser un COLOR (Capibara: "Capibara Camel" y "Capibara Marrón oscuro").
-- · Cada talle es la MISMA variante de antes: conserva su stock, su cruce con la web, sus ofertas de la web y su historial.
-- · Precio: el de 910103 ($42.500); Winnie Pooh sigue a $32.500 (precio propio en sus talles) con su oferta de $26.000.
-- · La foto de cada animal queda en su color. Los productos de cada animal quedan apagados (no se borra nada).
-- · No se tocan Frida, Llamita, Ovejita ni Koala (ya estaban apagados y sin stock). La web no cambia.
begin;
do $$
declare
  e constant uuid := '82c05bbf-e63e-4d25-a762-6f1ee6d27f43';
  p uuid; a record; v record; col uuid; nom text; cod text; stock_antes numeric; stock_despues numeric;
  mapa constant text[][] := array[
    ['910110','Chanchito'], ['910113','Hamburguesa'], ['910114','Kitty'], ['910115','Papas fritas'], ['910116','Perrito'],
    ['910117','Selección'], ['910118','Stitch'], ['910119','Unicornio'], ['910120','Vaquita'], ['910121','Winnie Pooh'], ['910123','Gatito negro'], ['910109','Capibara']];
  i int;
  -- el color de un animal (se crea si no existe)
begin
  select id into p from productos where empresa_id = e and codigo = '910103';
  if p is null then raise exception 'No está el 910103'; end if;
  select coalesce(sum(s.cantidad), 0) into stock_antes from stock s join variantes vv on vv.id = s.variante_id join productos pp on pp.id = vv.producto_id
    where pp.empresa_id = e and pp.codigo in ('910109','910110','910113','910114','910115','910116','910117','910118','910119','910120','910121','910123');
  update productos set activo = true, es_generico = false, generico_filtro = null, tiene_variantes = true, precio = 42500, costo = coalesce(nullif(costo, 0), 14000),
    descripcion = 'Pantuflones animados: cada animal es un color (31/10/2026).' where id = p;
  for i in 1 .. array_length(mapa, 1) loop
    select * into a from productos where empresa_id = e and codigo = mapa[i][1];
    if a.id is null then continue; end if;
    for v in select vv.*, (select nombre from atributos at where at.id = vv.color_id) color_viejo from variantes vv where vv.producto_id = a.id and vv.activa loop
      nom := case when mapa[i][1] = '910109' then 'Capibara ' || coalesce(v.color_viejo, 'Camel') else mapa[i][2] end;
      select id into col from atributos where empresa_id = e and tipo = 'color' and lower(nombre) = lower(nom) limit 1;
      if col is null then
        cod := upper(left(translate(nom, 'áéíóúñÁÉÍÓÚÑ ', 'aeiounAEIOUN'), 3));
        while exists (select 1 from atributos where empresa_id = e and tipo = 'color' and codigo = cod) loop cod := upper(left(translate(nom, 'áéíóúñÁÉÍÓÚÑ ', 'aeiounAEIOUN'), 3)) || '-' || (100 + floor(random() * 900))::int; end loop;
        insert into atributos (empresa_id, tipo, codigo, nombre, activo, orden) values (e, 'color', cod, nom, true, 500) returning id into col;
      end if;
      update variantes set producto_id = p, color_id = col,
        precio = case when v.precio is not null then v.precio when a.precio is distinct from 42500 then a.precio else null end,
        costo = coalesce(nullif(v.costo, 0), nullif(a.costo, 0), 14000)
      where id = v.id;
      -- sus ofertas de la web (por talle) pasan con ella
      update rebaja_precios set producto_id = p where producto_id = a.id and variante_id = v.id;
      -- oferta de todo el producto (Winnie Pooh): se copia a cada talle
      insert into rebaja_precios (empresa_id, promocion_id, producto_id, variante_id, precio)
        select e, rp.promocion_id, p, v.id, rp.precio from rebaja_precios rp where rp.producto_id = a.id and rp.variante_id is null
          and not exists (select 1 from rebaja_precios x where x.promocion_id = rp.promocion_id and x.producto_id = p and x.variante_id = v.id);
      -- la foto del animal, en su color
      update producto_fotos set producto_id = p, color_id = col where producto_id = a.id and color_id is null and not exists (select 1 from producto_fotos f2 where f2.producto_id = p and f2.color_id = col);
    end loop;
    update productos set activo = false, descripcion = coalesce(descripcion || E'\n', '') || 'Pasó a PANTUFLÓN «ANIMADOS» PREMIUM (910103) como color "' || mapa[i][2] || '" (31/10/2026).' where id = a.id;
  end loop;
  select coalesce(sum(s.cantidad), 0) into stock_despues from stock s join variantes vv on vv.id = s.variante_id where vv.producto_id = p;
  if stock_antes <> stock_despues then raise exception 'El stock no coincide: antes %, después %', stock_antes, stock_despues; end if;
  -- la web se entera (mismos números: es para que el cruce quede al día)
  perform encolar_canal(e, vv.id) from variantes vv where vv.producto_id = p and vv.activa;
end $$;
select json_build_object(
  'producto', (select json_build_object('nombre', nombre, 'activo', activo, 'precio', precio) from productos where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and codigo = '910103'),
  'colores', (select json_agg(x) from (select v.color_nombre color, count(*) talles, sum(v.stock) stock from v_variantes v where v.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and v.producto_codigo = '910103' and v.activa group by 1 order by 1) x),
  'apagados', (select count(*) from productos where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and codigo in ('910109','910110','910113','910114','910115','910116','910117','910118','910119','910120','910121','910123') and not activo),
  'web', (select count(*) from canal_items ci join variantes v on v.id = ci.variante_id join productos pp on pp.id = v.producto_id where pp.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and pp.codigo = '910103'),
  'fotos', (select count(*) from producto_fotos where producto_id = (select id from productos where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and codigo = '910103')));
commit;
