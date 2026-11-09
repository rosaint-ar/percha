-- 116 · Bombachas a $9.375 y LESS «ROUSE» REGULABLE (06/11/2026, Diego: "controlá que todas las bombachas en la web valgan $9.375,
-- el otro día se vendieron unas catherine vedetina a $8.125" · "hacé 1, 2 y 3").
-- 1) VEDETINA «CATHERINE» CLASSIC (Gris, Gris topo, Verde militar XS al M) y CULOTTELESS «MALVINA» Azul marino tenían un precio
--    propio viejo ($8.125) copiado de la web al armar el catálogo: se les saca y quedan con el del modelo ($9.375).
-- 2) Modelos de bombachas activos con otro precio y sin stock: a $9.375 (y sin precio propio por variante).
--    No se tocan: VEDETINA «LINA» ($11.000, a confirmar), COLALESS REGULABLE - REGALO ($0), genéricos, kits y packs.
-- 3) LESS «ROUSE» REGULABLE (100439): se cruza con su publicación de la web (372296852) por color y toma el stock de la web.
-- tn-precios lleva los precios nuevos a la web (las publicaciones ocultas no se tocan).
begin;
do $$
declare
  e constant uuid := '82c05bbf-e63e-4d25-a762-6f1ee6d27f43'; cx constant uuid := '6ecb8eee-1108-463b-a6e4-8161815c730c';
  dep uuid; r record; n1 int; n2 int; n2v int; rouse jsonb := '[]'::jsonb; st numeric;
begin
  select id into dep from depositos where empresa_id = e and principal limit 1;

  -- 1) precio propio viejo en variantes
  update variantes v set precio = null from productos p
   where p.id = v.producto_id and p.empresa_id = e and p.codigo in ('100442', '100413') and v.precio is not null;
  get diagnostics n1 = row_count;

  -- 2) modelos viejos sin stock
  create temp table viejos on commit drop as
  select p.id from productos p
   where p.empresa_id = e and p.activo and not p.es_generico and p.tipo <> 'kit'
     and p.nombre ~* '^(LESS|VEDETINA|CULOTTELESS|COLALESS|BOXER)' and p.nombre !~* 'pack'
     and p.codigo not in ('100169', '100002') and p.precio <> 9375
     and coalesce((select sum(s.cantidad) from stock s join variantes v on v.id = s.variante_id where v.producto_id = p.id), 0) = 0;
  update productos set precio = 9375 where id in (select id from viejos);
  get diagnostics n2 = row_count;
  update variantes set precio = null where producto_id in (select id from viejos) and precio is not null;
  get diagnostics n2v = row_count;

  -- 3) ROUSE REGULABLE: cruce por color y stock de la web
  for r in select ci.id ci_id, ci.color_canal, coalesce(ci.stock, 0) web, v.id vid
           from canal_items ci
           join variantes v on v.producto_id = (select id from productos where empresa_id = e and codigo = '100439')
            and lower((select nombre from atributos where id = v.color_id)) = lower(ci.color_canal)
           where ci.conexion_id = cx and ci.producto_ext = '372296852' loop
    update canal_items set variante_id = r.vid, cruce = 'manual', actualizado = now() where id = r.ci_id;
    st := coalesce((select sum(cantidad) from stock where variante_id = r.vid), 0);
    if st <> r.web then
      insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota, motivo)
      values (e, r.vid, dep, r.web - st, 'ajuste', 'La web manda: LESS «ROUSE» REGULABLE ' || r.color_canal || ' en ' || r.web || ' (Diego 06/11)', 'Recuento');
    end if;
    rouse := rouse || jsonb_build_object('color', r.color_canal, 'antes', st, 'ahora', r.web);
  end loop;

  perform set_config('percha.resultado', jsonb_build_object('variantes_1', n1, 'modelos_2', n2, 'variantes_2', n2v, 'rouse', rouse)::text, true);
end $$;
select current_setting('percha.resultado', true) resultado,
  (select json_agg(json_build_object('c', producto_codigo, 'col', color_nombre, 'tal', talle_nombre, 'p', precio)) from v_variantes
    where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and producto_codigo in ('100442', '100413') and activa and precio <> 9375) quedan_mal,
  (select json_agg(json_build_object('col', color_nombre, 'st', stock)) from v_variantes where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and producto_codigo = '100439') rouse_ahora;
commit;
