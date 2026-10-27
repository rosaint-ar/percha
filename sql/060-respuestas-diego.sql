-- 060 · Respuestas de Diego a las dudas (27/10/2026)
--   Pantuflón Argentina "sin talle" 39 u.: no existen, son las 5 de la web → 0 y archivada.
--   Bata Teddy Canela = Caramelo de la web, fallada (por eso está en el local) → la unidad pasa a Caramelo con falla (la web sigue en 0).
--   Pijama Sweet XL Amarillo = Sweet Daisy XL de la web → pasa a Daisy XL (la web la muestra).
--   Bikini Candy XL (1) y XXL (2): falladas.  Corpiño Seamless Blanco XXL/XXXL: no están en la web, quedan como están.
begin;
select set_config('request.jwt.claims','{"sub":"5f43c17d-958a-4ef7-badc-1a4001a20747","role":"authenticated"}',true);
set local role authenticated;
create temp table r(x jsonb);
insert into r select stock_ajustar(jsonb_build_object('variante_id','8c7c6da0-03c5-4325-91c5-904d50a8a5ea','modo','fijar','cantidad',0,'motivo','Recuento','nota','No existen: el Argentina son las 5 de la web, por talle (27/10)'));
insert into r select stock_ajustar(jsonb_build_object('variante_id',id,'modo','fijar','cantidad',0,'motivo','Recuento','nota','Pasa a Caramelo (es la misma bata) (27/10)')) from variantes where id::text like '0bd27628%';
insert into r select stock_ajustar(jsonb_build_object('variante_id','e65a4dfb'||substr(id::text,9),'modo','fijar','cantidad',1,'motivo','Recuento','nota','Viene de "Canela": es la Caramelo, fallada (27/10)')) from variantes where id::text like 'e65a4dfb%';
insert into r select stock_ajustar(jsonb_build_object('variante_id',id,'modo','fijar','cantidad',0,'motivo','Recuento','nota','Pasa a Daisy XL (es el Sweet Daisy de la web) (27/10)')) from variantes where id::text like '67d38313%';
insert into r select stock_ajustar(jsonb_build_object('variante_id',id,'modo','sumar','cantidad',1,'motivo','Recuento','nota','Viene de "Amarillo XL": es el Sweet Daisy (27/10)')) from variantes where id::text like 'ef7bcc39%';
insert into r select fallas_guardar(jsonb_build_object('variante_id',id,'unidades',jsonb_build_array(jsonb_build_object('nota','Fallada (por eso está en el local)')))) from variantes where id::text like 'e65a4dfb%';
insert into r select fallas_guardar(jsonb_build_object('variante_id',id,'unidades',jsonb_build_array(jsonb_build_object('nota','Fallada')))) from variantes where id::text like 'd1f92e13%';
insert into r select fallas_guardar(jsonb_build_object('variante_id',id,'unidades',jsonb_build_array(jsonb_build_object('nota','Fallada'),jsonb_build_object('nota','Fallada')))) from variantes where id::text like 'b67c6dc3%';
reset role;
update variantes set activa = false where (id = '8c7c6da0-03c5-4325-91c5-904d50a8a5ea' or id::text like '0bd27628%' or id::text like '67d38313%') and id in (select id from v_variantes where stock = 0);
update variantes set chequear = null where id = '8c7c6da0-03c5-4325-91c5-904d50a8a5ea' or id::text like any (array['0bd27628%','67d38313%','d1f92e13%','b67c6dc3%','596c7d6e%','3b589d53%']);
select jsonb_agg(x) from r;
commit;
