-- Cuando varias variantes del canal apuntan a una misma variante de Percha (ej. Boob Tape: en Tienda Nube
-- tiene colores, en Percha es un artículo único), el stock se compara SUMANDO las del canal.
drop view if exists v_cruce_canal;
create view v_cruce_canal with (security_invoker = true) as
select ci.*, cx.canal, cx.nombre as conexion_nombre,
       v.sku as sku_percha, v.ean as ean_percha, v.producto_nombre as producto_percha, v.talle_nombre, v.color_nombre,
       v.precio as precio_percha, v.stock as stock_percha,
       g.n_canal as variantes_canal_mismo_item, g.stock_canal_grupo,
       case when ci.variante_id is null then 'sin_cruzar'
            when ci.stock is null then 'sin_control'
            when g.stock_canal_grupo = v.stock then 'igual'
            else 'distinto' end as estado_stock
from canal_items ci
join conexiones cx on cx.id = ci.conexion_id
left join v_variantes v on v.id = ci.variante_id
left join (select conexion_id, variante_id, count(*) n_canal, sum(stock) stock_canal_grupo from canal_items where variante_id is not null group by conexion_id, variante_id) g
  on g.conexion_id = ci.conexion_id and g.variante_id = ci.variante_id;
