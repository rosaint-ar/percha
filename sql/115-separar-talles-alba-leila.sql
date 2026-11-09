-- 115 · Talles juntados, ALBA y LEILA (06/11/2026, Diego: "Catherine classic tiene dos talles… cuando hago un ticket de bombachas
-- no me da los talles a elegir" · "sí, separá los talles y asegurate que no pase lo mismo en otras prendas" · ALBA: "la publicación
-- visible es la correcta y su stock web está bien" · LEILA: "hay una viejísima que no va más; la que va tiene blanco, negro y nude").
-- 1) Cuando se armó el catálogo desde la web, los talles en rango ("XS al M", "L al XL") se tomaron como "sin talle": en los modelos
--    que tienen DOS o más rangos por color, quedaron juntos en una sola variante de Percha cruzada con varias de la web.
--    Ahora cada color se separa en sus talles (los nombres de la web), el stock se reparte como está en la web (si suma lo mismo que
--    Percha; si no, queda todo en el primero y se avisa) y cada publicación de la web queda cruzada con su talle.
--    La variante vieja queda como el primer talle (conserva su historial). Genéricos, kits y packs no se tocan.
-- 2) ALBA viejas (100366 LESS «ALBA», 100165 VEDETINA «ALBA»; publicaciones ocultas): stock a 0, apagadas y sin cruce.
--    Las correctas son 100170 LESS «ALBA» ALGODÓN y 100173 VEDETINA «ALBA» ALGODÓN (ya cruzadas con las visibles).
-- 3) LEILA 100264: la publicación vieja (241428849) se suelta; quedan Blanco, Negro y Nude (la publicación 332548821);
--    Amarillo, Celeste, Lila y Salmón se apagan (en 0). La Blanco va a la publicación buena.
begin;
do $$
declare
  e constant uuid := '82c05bbf-e63e-4d25-a762-6f1ee6d27f43'; cx constant uuid := '6ecb8eee-1108-463b-a6e4-8161815c730c';
  dep uuid; r record; t record; i int; tid uuid; nv uuid; cod text; total_web numeric; out jsonb := '[]'::jsonb; avisos jsonb := '[]'::jsonb;
  prods uuid[] := '{}'; tcod text;
begin
  select id into dep from depositos where empresa_id = e and principal limit 1;

  -- ================= 1) separar talles =================
  for r in
    select v.id vid, v.producto_id, v.color_id, p.codigo pcod, p.nombre pnom, (select nombre from atributos where id = v.color_id) cnom, (select codigo from atributos where id = v.color_id) ccod,
           coalesce((select sum(cantidad) from stock where variante_id = v.id), 0) st
    from variantes v join productos p on p.id = v.producto_id
    where p.empresa_id = e and not p.es_generico and p.tipo not in ('kit') and v.talle_id is null and v.estampa_id is null
      and p.codigo not in ('100366', '100165', '100264') and p.nombre not ilike '[PACK%' and p.nombre not ilike 'PACK %'
      and (select count(distinct ci.talle_canal) from canal_items ci where ci.variante_id = v.id and ci.conexion_id = cx and ci.talle_canal is not null) > 1
    order by p.nombre, 6
  loop
    i := 0; prods := array_append(prods, r.producto_id);
    total_web := (select coalesce(sum(coalesce(stock, 0)), 0) from canal_items where variante_id = r.vid and conexion_id = cx);
    if total_web <> r.st then avisos := avisos || jsonb_build_object('prenda', r.pnom || ' ' || coalesce(r.cnom, ''), 'percha', r.st, 'web', total_web, 'quedo', 'todo en el primer talle'); end if;
    for t in select ci.talle_canal, min(ci.variante_ext::bigint) orden, sum(coalesce(ci.stock, 0)) web, array_agg(ci.id) items
             from canal_items ci where ci.variante_id = r.vid and ci.conexion_id = cx and ci.talle_canal is not null group by ci.talle_canal order by 2 loop
      i := i + 1;
      select id, codigo into tid, tcod from atributos where empresa_id = e and tipo = 'talle' and lower(nombre) = lower(t.talle_canal) order by activo desc limit 1;
      if tid is null then
        cod := left(upper(regexp_replace(translate(t.talle_canal, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN'), '[^A-Za-z0-9]+', '', 'g')), 12);
        while exists (select 1 from atributos where empresa_id = e and tipo = 'talle' and codigo = cod) loop cod := left(cod, 9) || (10 + floor(random() * 90))::int; end loop;
        insert into atributos (empresa_id, tipo, codigo, nombre, activo, orden) values (e, 'talle', cod, t.talle_canal, true, 600 + i) returning id, codigo into tid, tcod;
      end if;
      if i = 1 then
        update variantes set talle_id = tid, sku = concat_ws('-', r.pcod, tcod, r.ccod) where id = r.vid;   -- la vieja es el primer talle (conserva su historial)
        nv := r.vid;
      else
        select id into nv from variantes where producto_id = r.producto_id and talle_id = tid and color_id is not distinct from r.color_id and estampa_id is null;
        if nv is null then
          insert into variantes (empresa_id, producto_id, talle_id, color_id, sku, activa) values (e, r.producto_id, tid, r.color_id, concat_ws('-', r.pcod, tcod, r.ccod), true) returning id into nv;
        else update variantes set activa = true where id = nv; end if;
        if total_web = r.st and t.web <> 0 then   -- el stock de este talle, como está en la web
          insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota, motivo) values
            (e, r.vid, dep, -t.web, 'ajuste', 'Separar talles: ' || t.web || ' pasan a ' || t.talle_canal, 'Separar talles'),
            (e, nv, dep, t.web, 'ajuste', 'Separar talles: estaban juntas con los otros talles', 'Separar talles');
        end if;
      end if;
      update canal_items set variante_id = nv, cruce = 'manual', actualizado = now() where id = any(t.items);
      out := out || jsonb_build_object('prenda', r.pnom, 'color', r.cnom, 'talle', t.talle_canal, 'stock', case when i = 1 and total_web = r.st then t.web when total_web = r.st then t.web else null end);
    end loop;
    update productos set tiene_variantes = true where id = r.producto_id and not tiene_variantes;
  end loop;

  -- ================= 2) ALBA viejas =================
  for r in select v.id, coalesce((select sum(cantidad) from stock where variante_id = v.id), 0) st from variantes v join productos p on p.id = v.producto_id
           where p.empresa_id = e and p.codigo in ('100366', '100165') loop
    if r.st <> 0 then
      insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota, motivo)
      values (e, r.id, dep, -r.st, 'ajuste', 'ALBA vieja: la correcta es LESS/VEDETINA «ALBA» ALGODÓN, con el stock de la web (Diego 06/11)', 'Recuento');
    end if;
  end loop;
  update canal_items set variante_id = null, cruce = 'manual', actualizado = now()
   where conexion_id = cx and variante_id in (select v.id from variantes v join productos p on p.id = v.producto_id where p.empresa_id = e and p.codigo in ('100366', '100165'));
  update variantes set activa = false where producto_id in (select id from productos where empresa_id = e and codigo in ('100366', '100165'));
  update productos set activo = false, publicar_web = false, descripcion = coalesce(descripcion || E'\n', '') || 'Apagado el 06/11/2026: ALBA vieja; la correcta es la «ALBA» ALGODÓN (Diego).'
   where empresa_id = e and codigo in ('100366', '100165');

  -- ================= 3) LEILA =================
  update canal_items set variante_id = null, cruce = 'manual', actualizado = now() where conexion_id = cx and producto_ext = '241428849';
  update variantes v set activa = false from productos p
   where p.id = v.producto_id and p.empresa_id = e and p.codigo = '100264'
     and coalesce((select nombre from atributos where id = v.color_id), '') not in ('Blanco', 'Negro', 'Nude')
     and coalesce((select sum(cantidad) from stock where variante_id = v.id), 0) = 0;
  perform encolar_canal(e, v.id) from variantes v join productos p on p.id = v.producto_id where p.empresa_id = e and p.codigo = '100264' and v.activa;

  -- las variantes nuevas ya están cruzadas: que la cola de "publicar en la web" no las suba de nuevo
  delete from canal_publicar where creado >= now() and (producto_id = any(prods) or producto_id in (select id from productos where empresa_id = e and codigo in ('100264', '100366', '100165')));

  raise notice 'RESULTADO %', jsonb_build_object('separadas', out, 'avisos', avisos, 'productos', array_length(prods, 1));
  perform set_config('percha.resultado', jsonb_build_object('separadas', out, 'avisos', avisos)::text, true);
end $$;

-- control: ¿queda alguna variante de Percha (no genérica) cruzada con talles distintos de la web?
select current_setting('percha.resultado', true) resultado,
  (select count(*) from (select ci.variante_id from canal_items ci join variantes v on v.id = ci.variante_id join productos p on p.id = v.producto_id
     where ci.conexion_id = '6ecb8eee-1108-463b-a6e4-8161815c730c' and ci.talle_canal is not null and not p.es_generico and p.tipo <> 'kit' and p.nombre not ilike '[PACK%' and p.nombre not ilike 'PACK %'
     group by 1 having count(distinct ci.talle_canal) > 1) x) quedan_juntadas;
commit;
