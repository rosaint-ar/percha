-- 034 · Recuento de Aldi (23/10/2026): Tienda Nube es el stock maestro.
--  A) canal_items toma el stock vivo de Tienda Nube de lo que cambió hoy.
--  B) Kendall (bikini): lo que en el local se llamaba "Lila" es la estampa "Margaritas" de la web (mismas cantidades talle por talle),
--     y la vedetina "Aqua" del local es "Batik verde" de la web.
--  C) Camille «Aqua & rosa» y Martha Soft «Gris Skip» de la web se vinculan a su propia variante del local (estaban sumadas en Aqua / Gris).
--  D) Las 50 variantes de la web sin cruzar se vinculan (o se crean). Stock de la web en Conjuntos y en las nuevas;
--     en otras familias la diferencia queda a la vista hasta que Aldi cuente esa familia.
--  E) Conjuntos: cada variante del local = suma de la web.
--  F) Conjuntos: lo que el local tenía en variantes que la web no tiene (de modelos que sí están en la web) queda en 0 y se desactiva.
--     Los modelos que no están en la web no se tocan.

create or replace function canal_vincular_item(p_item bigint, p_sku text, p_talle text, p_color text, p_stock numeric, p_nota text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ci canal_items%rowtype; pr record; t_id uuid; c_id uuid; v_id uuid; nueva boolean := false; reactivada boolean := false;
        actual numeric; aplicar boolean; dep uuid; fam text;
begin
  select * into ci from canal_items where id = p_item;
  select p.id, p.empresa_id, p.codigo, cat.codigo fam into pr from productos p left join categorias cat on cat.id = p.categoria_id where p.empresa_id = ci.empresa_id and p.codigo = p_sku;
  if pr.id is null then return jsonb_build_object('item', p_item, 'error', 'no existe el producto ' || p_sku); end if;
  if p_talle is not null then
    select id into t_id from atributos where empresa_id = pr.empresa_id and tipo = 'talle' and lower(nombre) = lower(p_talle) limit 1;
    if t_id is null then t_id := atributo_desde_canal(pr.empresa_id, 'talle', p_talle); end if;
  end if;
  if p_color is not null then
    select id into c_id from atributos where empresa_id = pr.empresa_id and tipo = 'color' and lower(nombre) = lower(p_color) limit 1;
    if c_id is null then c_id := atributo_desde_canal(pr.empresa_id, 'color', p_color); end if;
  end if;
  select id into v_id from variantes where producto_id = pr.id and talle_id is not distinct from t_id and color_id is not distinct from c_id and estampa_id is null;
  if v_id is null then
    insert into variantes (empresa_id, producto_id, talle_id, color_id, sku)
    values (pr.empresa_id, pr.id, t_id, c_id, pr.codigo || coalesce('-' || (select codigo from atributos where id = t_id), '') || coalesce('-' || (select codigo from atributos where id = c_id), ''))
    returning id into v_id; nueva := true;
  elsif not (select activa from variantes where id = v_id) then
    update variantes set activa = true where id = v_id; reactivada := true;
  end if;
  update canal_items set variante_id = v_id, stock = coalesce(p_stock, stock), actualizado = now() where id = p_item;
  select coalesce(sum(cantidad), 0) into actual from stock where variante_id = v_id;
  aplicar := pr.fam = '20' or nueva;
  if aplicar and p_stock is not null and p_stock <> actual then
    dep := (select id from depositos where empresa_id = pr.empresa_id and principal limit 1);
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
    values (pr.empresa_id, v_id, dep, p_stock - actual, 'ajuste', 'recuento-2026-10-23', p_nota, '5f43c17d-958a-4ef7-badc-1a4001a20747');
  end if;
  return jsonb_build_object('item', p_item, 'sku', p_sku, 'talle', p_talle, 'color', p_color, 'tn', p_stock, 'percha_antes', actual,
    'accion', case when nueva then 'creada' when reactivada then 'reactivada' else 'vinculada' end,
    'stock', case when not aplicar then case when p_stock is distinct from actual then 'pendiente (familia sin contar)' else 'igual' end
                  when p_stock is distinct from actual then 'ajustado' else 'igual' end);
end $$;

create temp table r034 (n serial, paso text, r jsonb);

-- A) stock vivo de la web
update canal_items ci set stock = x.st, actualizado = now() from (values
  (3061,3),
  (3062,0),
  (4265,0),
  (4256,0),
  (4257,1),
  (1666,2),
  (3427,0),
  (4223,0),
  (4227,1)
) x(id, st) where ci.id = x.id;

-- B) Kendall: Lila → Margaritas (5 bombachas) · vedetina Aqua → Batik verde (solo las variantes sin vincular)
update variantes v set color_id = atributo_desde_canal(v.empresa_id, 'color', 'Margaritas')
from productos p where p.id = v.producto_id and p.codigo in ('600301','600302','600303','600304','600306')
  and v.color_id = (select id from atributos a where a.empresa_id = v.empresa_id and a.tipo = 'color' and a.nombre = 'Lila');
update variantes v set color_id = atributo_desde_canal(v.empresa_id, 'color', 'Batik verde')
from productos p where p.id = v.producto_id and p.codigo = '600306'
  and v.color_id = (select id from atributos a where a.empresa_id = v.empresa_id and a.tipo = 'color' and a.nombre = 'Aqua')
  and not exists (select 1 from canal_items ci where ci.variante_id = v.id);

-- C) Camille «Aqua & rosa» y Martha Soft «Gris Skip»: cada publicación de la web a su variante
insert into r034 (paso, r)
select 'C', canal_vincular_item(ci.id, x.sku, ci.talle_canal, x.color, ci.stock, 'Recuento Aldi 23/10 · Conjuntos (stock de Tienda Nube)')
from canal_items ci join (values ('CONJUNTO «CAMILLE» AQUA & ROSA', '200103', 'Aqua y rosa'), ('CONJUNTO «MARTHA SOFT» GRIS SKIP', '200204', 'Gris Skip')) x(nom, sku, color)
  on ci.nombre = x.nom and ci.conexion_id = '6ecb8eee-1108-463b-a6e4-8161815c730c';

-- D) las 50 sin cruzar
insert into r034 (paso, r)
select 'D', canal_vincular_item(i, s, t, c, st, 'Recuento Aldi 23/10 · variante que estaba en Tienda Nube y no en el local')
from (values
(11,'300103','95','Negro',0),
(85,'200116','90','Negro',0),
(86,'200116','95','Negro',0),
(90,'200116','90','Rojo',0),
(91,'200116','95','Rojo',0),
(33,'200122','115','Blanco',0),
(388,'200502','90','Negro',0),
(389,'200502','95','Negro',0),
(390,'200502','100','Negro',0),
(391,'200502','105','Negro',0),
(26,'200122','115','Negro',0),
(448,'200141','80','Negro',0),
(3005,'600306','S','Margaritas',2),
(3006,'600306','M','Margaritas',0),
(3007,'600306','L/XL','Margaritas',0),
(3009,'500135','M','Cherry',0),
(3010,'500135','L/XL','Cherry',0),
(2926,'600401','85','Aqua',0),
(2929,'600401','85','Negro',0),
(152,'200111','90','Negro',0),
(153,'200111','95','Negro',0),
(275,'500102','L','Negro',0),
(287,'300103','95','Rojo',0),
(793,'600201','M','Coral',0),
(796,'600201','M','Negro',0),
(799,'600202','M','Negro',0),
(1068,'200402','M','Salmón',0),
(1164,'500108','S/M','Ardilla',0),
(1192,'500108','S/M','Oveja',0),
(1221,'900202','Talle 1','Negro',0),
(1223,'900202','Talle 3','Negro',0),
(1224,'900202','Talle 4','Negro',0),
(1226,'900202','Talle 1','Piel',0),
(1228,'900202','Talle 3','Piel',1),
(1229,'900202','Talle 4','Piel',0),
(2656,'600301','S/M','Margaritas',4),
(2657,'600301','L/XL','Margaritas',2),
(2664,'600302','XS','Margaritas',5),
(2665,'600302','S/M','Margaritas',2),
(2666,'600302','L/XL','Margaritas',0),
(2733,'600303','XS','Margaritas',1),
(2734,'600303','S','Margaritas',3),
(2735,'600303','M','Margaritas',3),
(2736,'600303','L','Margaritas',2),
(2749,'600304','Único','Margaritas',1),
(2923,'600401','85','Cebra',0),
(2996,'600306','S','Batik verde',2),
(2997,'600306','M','Batik verde',2),
(2998,'600306','L/XL','Batik verde',0),
(3074,'400202','90','Negro',1)
) x(i, s, t, c, st);

-- E) Conjuntos: el local = la web (suma de las publicaciones vinculadas)
with w as (
  select v.id vid, v.empresa_id, sum(ci.stock) web, coalesce((select sum(cantidad) from stock s where s.variante_id = v.id), 0) loc
  from variantes v join productos p on p.id = v.producto_id join categorias cat on cat.id = p.categoria_id
  join canal_items ci on ci.variante_id = v.id and ci.stock is not null
  where cat.codigo = '20' and p.tipo <> 'kit' and not p.es_generico group by v.id, v.empresa_id),
m as (insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
  select w.empresa_id, w.vid, (select id from depositos d where d.empresa_id = w.empresa_id and d.principal limit 1), w.web - w.loc, 'ajuste', 'recuento-2026-10-23',
         'Recuento Aldi 23/10 · Conjuntos (stock de Tienda Nube)', '5f43c17d-958a-4ef7-badc-1a4001a20747'
  from w where w.web <> w.loc returning variante_id, cantidad)
insert into r034 (paso, r)
select 'E', jsonb_build_object('cod', vv.producto_codigo, 'prod', vv.producto_nombre, 'talle', vv.talle_nombre, 'color', vv.color_nombre, 'cambio', m.cantidad)
from m join v_variantes vv on vv.id = m.variante_id;

-- F) Conjuntos: variantes del local que la web no tiene (de modelos publicados) → 0 y desactivadas
with f as (
  select v.id vid, v.empresa_id, coalesce((select sum(cantidad) from stock s where s.variante_id = v.id), 0) loc
  from variantes v join productos p on p.id = v.producto_id join categorias cat on cat.id = p.categoria_id
  where cat.codigo = '20' and p.tipo <> 'kit' and not p.es_generico
    and not exists (select 1 from canal_items ci where ci.variante_id = v.id)
    and exists (select 1 from canal_items ci join variantes v2 on v2.id = ci.variante_id where v2.producto_id = p.id)
    and coalesce((select sum(cantidad) from stock s where s.variante_id = v.id), 0) <> 0),
m as (insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
  select f.empresa_id, f.vid, (select id from depositos d where d.empresa_id = f.empresa_id and d.principal limit 1), -f.loc, 'ajuste', 'recuento-2026-10-23',
         'Recuento Aldi 23/10 · Conjuntos: la web no tiene esta variante', '5f43c17d-958a-4ef7-badc-1a4001a20747'
  from f returning variante_id, cantidad)
insert into r034 (paso, r)
select 'F', jsonb_build_object('vid', m.variante_id, 'cod', vv.producto_codigo, 'prod', vv.producto_nombre, 'talle', vv.talle_nombre, 'color', vv.color_nombre, 'cambio', m.cantidad)
from m join v_variantes vv on vv.id = m.variante_id;
update variantes set activa = false where id in (select (r->>'vid')::uuid from r034 where paso = 'F');

select jsonb_agg(jsonb_build_object('paso', paso) || r order by n) from r034;
