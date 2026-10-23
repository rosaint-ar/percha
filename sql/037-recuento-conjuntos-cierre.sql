-- 037 · Cierre del recuento de Conjuntos (Diego, 23/10/2026):
--  · Alice "Aqua" es el Verde agua de la web y Emma Soft "Beige" es el Nude (el stock de Verde agua y Nude está bien):
--    eran la misma prenda anotada dos veces → quedan en 0 y ocultas, como las otras 25.
--  · Las 25 "anotadas dos veces": ok de Diego.
with x as (
  select v.id, v.empresa_id, coalesce((select sum(cantidad) from stock s where s.variante_id = v.id), 0) st, c.nombre color, p.codigo
  from variantes v join productos p on p.id = v.producto_id join atributos c on c.id = v.color_id
  where (p.codigo = '200148' and c.nombre = 'Aqua') or (p.codigo = '200201' and c.nombre = 'Beige')),
m as (insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
  select x.empresa_id, x.id, (select id from depositos d where d.empresa_id = x.empresa_id and d.principal limit 1), -x.st, 'ajuste', 'recuento-2026-10-23',
         'Recuento 23/10 · ' || case when x.codigo = '200148' then 'Aqua es el Verde agua de la web' else 'Beige es el Nude de la web' end || ' (estaba anotado dos veces)', '5f43c17d-958a-4ef7-badc-1a4001a20747'
  from x where x.st <> 0 returning variante_id, cantidad)
select jsonb_agg(cantidad) r from m;
update variantes v set activa = false, chequear = null
from productos p, atributos c
where p.id = v.producto_id and c.id = v.color_id and ((p.codigo = '200148' and c.nombre = 'Aqua') or (p.codigo = '200201' and c.nombre = 'Beige'))
  and not exists (select 1 from canal_items ci where ci.variante_id = v.id);
select jsonb_build_object(
  'a_chequear', (select count(*) from variantes where chequear is not null),
  'alice_verde_agua', (select jsonb_agg(talle_nombre || '=' || stock::int order by talle_orden) from v_variantes where producto_codigo = '200148' and color_nombre = 'Verde agua'),
  'emma_nude', (select jsonb_agg(talle_nombre || '=' || stock::int order by talle_orden) from v_variantes where producto_codigo = '200201' and color_nombre = 'Nude'),
  'aqua_beige_restante', (select coalesce(sum(stock), 0) from v_variantes where (producto_codigo = '200148' and color_nombre = 'Aqua') or (producto_codigo = '200201' and color_nombre = 'Beige')),
  'conj_distinto_web', (select count(*) from v_cruce_canal cc join variantes v on v.id = cc.variante_id join productos p on p.id = v.producto_id join categorias c on c.id = p.categoria_id where c.codigo = '20' and cc.estado_stock = 'distinto')) r;
