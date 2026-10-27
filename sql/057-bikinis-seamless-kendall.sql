-- 057 · Correcciones que pidió Diego (27/10/2026)
--   Aruba, Lilith, Maddie: estaban dos veces (con color y sin color); la web va con las sin color → las repetidas en 0 y archivadas.
--   Corpiño Kendall 100 Lila = "Margaritas 100/105" de la web (que ya tiene esa unidad) → 0 y archivada.
--   Culotteless Seamless: el producto 100183 (S/M, M/L, L/XL) no es el de la web (100200, sin stock) → 0 y archivadas.
--   Bikini Safari: no hay → 0 y producto archivado.
--   Candy XL/XXL y Corpiño Seamless Blanco XXL/XXXL: quedan "para revisar" con la duda anotada (no se toca el stock).
--   Las repetidas "Único" de antes (extensores, medias, liga, pijama) que ya estaban en 0 y sin cruce: archivadas.
begin;
create temp table dup as
select v.id from variantes v join productos p on p.id = v.producto_id
where (p.codigo = '600110' and v.color_id is not null) or (p.codigo = '600119' and v.color_id is not null) or (p.codigo = '600127' and v.color_id is not null)
   or v.id::text like 'ad56b1c7%' or v.id::text like '8b4f4e75%'
   or (p.codigo = '100183' and not exists (select 1 from canal_items ci where ci.variante_id = v.id));
-- seguridad: ninguna de estas está cruzada con la web
do $$ begin if exists (select 1 from canal_items ci join dup on dup.id = ci.variante_id) then raise exception 'hay una cruzada'; end if; end $$;
grant select on dup to authenticated;
select set_config('request.jwt.claims','{"sub":"5f43c17d-958a-4ef7-badc-1a4001a20747","role":"authenticated"}',true);
set local role authenticated;
create temp table r(x jsonb);
insert into r select stock_ajustar(jsonb_build_object('variante_id', v.id, 'modo', 'fijar', 'cantidad', 0, 'motivo', 'Recuento',
  'nota', 'Repetida: la prenda ya está en Tienda Nube con otra variante (27/10)')) from v_variantes v join dup on dup.id = v.id where v.stock <> 0;
reset role;
insert into dup select v.id from variantes v join productos p on p.id = v.producto_id
 where (select stock from v_variantes x where x.id = v.id) = 0 and not exists (select 1 from canal_items ci where ci.variante_id = v.id)
   and ((p.codigo in ('900503','900201','900200') and v.talle_id is not null) or (p.codigo = '400206' and v.talle_id is null) or (p.codigo = '500135' and v.talle_id is null and v.color_id is null));
update variantes set activa = false where id in (select id from dup) and id in (select id from v_variantes where stock = 0);
update productos set activo = false where codigo = '600121';
update variantes set chequear = 'Confirmar si están falladas: no están en la web (27/10)' where id::text like 'd1f92e13%' or id::text like 'b67c6dc3%';
update variantes set chequear = 'En la web figura sin stock: confirmar el color en el local (27/10)' where id::text like '596c7d6e%' or id::text like '3b589d53%';
select jsonb_build_object('ajustes', (select count(*) from r), 'unidades', (select sum((x->>'cambio')::numeric) from r), 'archivadas', (select count(*) from variantes where id in (select id from dup) and not activa));
commit;
