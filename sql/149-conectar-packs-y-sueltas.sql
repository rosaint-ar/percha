-- 149 · 16/11 (Diego: «sí, hacé la 1 y la 2»). Todo con stock 0 en la web y en Percha (no se mueve stock).
-- 1) 13 packs de la web que estaban atados a PACK X3/X7 BOMBIS «VARIAS» (Percha no les controlaba el stock) → a su pack en Percha.
-- 2) 22 publicaciones visibles sin conectar → a su prenda (talles·colores apagados se prenden; el que falta se crea).
-- Cada opción de la web va a la variante indicada (código de la prenda, talle y color por nombre). Packs: Percha los tiene
-- por color sin talle; los dos talles de la web van al mismo color (como otras prendas que la web separa y Percha junta).
begin;
do $$
declare
  e constant uuid := '82c05bbf-e63e-4d25-a762-6f1ee6d27f43';
  r record; pid uuid; t_id uuid; c_id uuid; v_id uuid; n_con int := 0; n_crea int := 0; n_prende int := 0;
begin
  for r in select * from (values
    -- 1) packs
    (4207,'100430',null,null),(4208,'100435',null,null),
    (2779,'100501',null,'Modelo 1 (negro, nude, gris)'),(2780,'100501',null,'Modelo 2 (negro, gris)'),
    (1547,'100502',null,'Lila'),(1548,'100502',null,'Basic'),(1549,'100502',null,'Basic II'),(1550,'100502',null,'Lila'),(1551,'100502',null,'Basic'),(1552,'100502',null,'Basic II'),
    (1653,'100513',null,null),
    (1644,'100503',null,'Basic I (negro, gris, nude, crema, blanco)'),(1645,'100503',null,'Basic II (negro, gris, nude)'),(1646,'100503',null,'Rojo (negro, gris, nude, blanco, rojo)'),
    (3710,'100504',null,'Basic I (negro, gris, blanco)'),
    (1963,'100505',null,'Rojo'),(1964,'100505',null,'Gris'),
    (2392,'100506',null,null),
    (2644,'100507',null,'Basic (negro, nude, blanco)'),(2645,'100507',null,'Basic II (negro, gris, blanco)'),(2646,'100507',null,'Colors (negro, cereza, rosa viejo, avellana, nude)'),
    (2647,'100507',null,'Basic (negro, nude, blanco)'),(2648,'100507',null,'Basic II (negro, gris, blanco)'),(2649,'100507',null,'Colors (negro, cereza, rosa viejo, avellana, nude)'),
    (2009,'100508',null,'Basic (blanco, negro, nude)'),(2010,'100508',null,'Basic II (negro, gris, blanco)'),
    (2942,'100509',null,null),
    (3711,'100510',null,'Basic (negro, blanco, rojo, nude)'),
    (1647,'100512',null,null),(1648,'100512',null,null),(1649,'100512',null,null),(1650,'100512',null,null),(1651,'100512',null,null),(1652,'100512',null,null),
    (3632,'100511',null,'Basic (negro, nude, blanco)'),
    -- 2) sueltas
    (1517,'600122','S','Azul Francia'),(1518,'600122','M/L','Azul Francia'),(1519,'600122','XL','Azul Francia'),
    (1514,'600122','S','Verde'),(1515,'600122','M/L','Verde'),(1516,'600122','XL','Verde'),
    (1511,'600122','S','Fucsia'),(1512,'600122','M/L','Fucsia'),(1513,'600122','XL','Fucsia'),
    (34,'200122','85','Gris'),(35,'200122','90','Gris'),(36,'200122','95','Gris'),(37,'200122','100','Gris'),
    (3879,'200184','S/M',null),(3880,'200184','L/XL',null),
    (1739,'100416',null,'Leopardo'),
    (1610,'100144',null,'Estampado'),
    (1971,'100343',null,'Leopardo'),
    (1734,'100455',null,'Leopardo'),
    (1733,'100454',null,'Leopardo'),
    (2136,'500119',null,'Leopardo'),(2176,'500119',null,'Verde Militar'),(2137,'500119',null,'Cebra'),
    (2132,'500118','S/M','Cebra'),(2133,'500118','L/XL','Cebra'),
    (4036,'500120','S',null),(4037,'500120','XL',null),(4038,'500120','3XL',null),
    (2073,'500122','S',null),(2074,'500122','M',null),(2075,'500122','L',null),(2076,'500122','XL',null),
    (2068,'500121','S','Negro'),(2069,'500121','M','Negro'),(2070,'500121','L','Negro'),(2071,'500121','XL','Negro'),(2072,'500121','2XL','Negro'),
    (3963,'500159','S','Negro'),(3964,'500159','M','Negro'),(3965,'500159','L','Negro'),(3966,'500159','XL/2XL','Negro'),
    (3939,'500159','S','Rosa'),(3940,'500159','M','Rosa'),(3941,'500159','L','Rosa'),(3942,'500159','XL/2XL','Rosa'),
    (3609,'500143','S','CAT'),(3610,'500143','M','CAT'),(3611,'500143','L','CAT'),(3612,'500143','XL','CAT'),(3613,'500143','2XL','CAT')
  ) as t(item, cod, talle, color) loop
    select id into pid from productos where empresa_id = e and codigo = r.cod;
    if pid is null then raise exception 'No existe la prenda %', r.cod; end if;
    -- el talle y el color: los que ya usa la prenda (si no, el atributo con ese nombre)
    t_id := null; c_id := null;
    if r.talle is not null then
      select v.talle_id into t_id from variantes v join atributos a on a.id = v.talle_id where v.producto_id = pid and lower(a.nombre) = lower(r.talle) limit 1;
      if t_id is null then select id into t_id from atributos where empresa_id = e and tipo = 'talle' and lower(nombre) = lower(r.talle) order by activo desc, orden limit 1; end if;
      if t_id is null then raise exception 'Talle % no existe (%)', r.talle, r.cod; end if;
    end if;
    if r.color is not null then
      select v.color_id into c_id from variantes v join atributos a on a.id = v.color_id where v.producto_id = pid and lower(a.nombre) = lower(r.color) limit 1;
      if c_id is null then select id into c_id from atributos where empresa_id = e and tipo = 'color' and lower(nombre) = lower(r.color) order by activo desc, orden limit 1; end if;
      if c_id is null then raise exception 'Color % no existe (%)', r.color, r.cod; end if;
    end if;
    select id into v_id from variantes where producto_id = pid and talle_id is not distinct from t_id and color_id is not distinct from c_id and estampa_id is null
      order by activa desc limit 1;
    if v_id is null then
      insert into variantes (empresa_id, producto_id, talle_id, color_id, sku)
      values (e, pid, t_id, c_id, r.cod || coalesce('-' || (select codigo from atributos where id = t_id), '') || coalesce('-' || (select codigo from atributos where id = c_id), ''))
      returning id into v_id; n_crea := n_crea + 1;
    elsif not (select activa from variantes where id = v_id) then
      update variantes set activa = true where id = v_id; n_prende := n_prende + 1;
    end if;
    update canal_items set variante_id = v_id, cruce = 'manual', actualizado = now() where id = r.item and empresa_id = e;
    if not found then raise exception 'No encontré la opción de la web %', r.item; end if;
    n_con := n_con + 1;
  end loop;
  update productos set publicar_web = true where empresa_id = e and not publicar_web and codigo in
    ('100430','100435','100501','100502','100503','100504','100505','100506','100507','100508','100509','100510','100511','100512','100513','600122','200184','500120','500121','500122','500143');
  raise notice 'conectadas % · variantes creadas % · prendidas %', n_con, n_crea, n_prende;
end $$;
commit;
