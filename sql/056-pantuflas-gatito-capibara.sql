-- 056 · Pantuflas que contaban doble (27/10/2026)
--   Gatito Negro: la web va por talle → se cruza con los talles de Percha y la variante "Negro sin talle" queda en 0.
--   Capibara: la web va por color (Marrón oscuro 2 + Camel 1, todo Kids) → la variante "30 al 33 sin color" era la misma mercadería: 0.
begin;
update canal_items set variante_id = 'd012ae74-0fa1-4df7-b024-9d54d3889fb8', cruce = 'manual', actualizado = now() where id = 2077;
update canal_items set variante_id = '4786d948-71a4-4cb6-8e62-2d84f876cc6b', cruce = 'manual', actualizado = now() where id = 2078;
update canal_items set variante_id = 'b4c4c95d-6b9d-4f15-8257-e4c3f4f33abe', cruce = 'manual', actualizado = now() where id = 2079;
select set_config('request.jwt.claims','{"sub":"5f43c17d-958a-4ef7-badc-1a4001a20747","role":"authenticated"}',true);
set local role authenticated;
create temp table r(x jsonb);
insert into r select stock_ajustar(jsonb_build_object('variante_id','8549b244-19e0-4a66-9f89-d0dcc0226ce2','modo','fijar','cantidad',0,'motivo','Recuento','nota','Repetida: la web la tiene por talle (27/10)'));
insert into r select stock_ajustar(jsonb_build_object('variante_id','61d4da33-fcba-4f6c-9478-c811f1258637','modo','fijar','cantidad',0,'motivo','Recuento','nota','Repetida: la web la tiene por color, Marrón oscuro y Camel (27/10)'));
select jsonb_agg(x) from r;
commit;
