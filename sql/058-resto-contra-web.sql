-- 058 · Resto de la lista, revisado contra la web (27/10/2026). Lo oculto en la web no cuenta.
--   Confirmados por Diego (están en el local, no en la web): Agnes 85/95 Lila, Cielo 100 Blanco y lila / Blanco y rosa,
--     Martha Flores 90 Azul Marino (solo el corpiño), Corset Velvet 100, Portaligas Lexie Rojo → se saca la marca "para revisar".
--   Vedetina Lina: "Morado 34 al 36 / 40 al 42" son las "Mora S/M y L/XL" de la web con otro talle. S/M ya tiene sus 3;
--     las 2 de 40 al 42 pasan a Mora L/XL (Diego: "están") y la web pasa a mostrarlas.
--   Repetidas de algo que la web tiene en 0 (talle o color con otro nombre): Baby Doll Lolita M Rojo (la web va por 85-100),
--     Body Lolita S/L (la web va por 85-105 y ya tiene esas unidades), Camisolín Stay Positive S/M Flores (= Flowers) y L Arte (= Pollock),
--     Pijama Over L Arte (= Pollock), Bata Alaska Cebra Único (= Zebra de la web) → 0 y archivadas.
--   Bata Alaska Leopard y Zebra de la web: se cruzan con su variante (las dos en 0).
--   Dudas (no se toca el stock): Bata Teddy Canela (¿= Caramelo?), Pijama Sweet XL Amarillo (¿= Daisy?).
begin;
update canal_items set variante_id = 'ef51dbfa-a288-4e56-a5cd-9061d2d0515a', cruce = 'manual', actualizado = now() where id = 3206;
update canal_items set variante_id = '2cf996c9-c619-4d15-97d8-2b578073b336', cruce = 'manual', actualizado = now() where id = 3990;
create temp table dup as select id from variantes where id::text like any (array['b12407b0%','168e5205%','bca899d9%','1aab56f2%','7d8a4a1d%','3fb624c7%','9cff7f7a%','a4284eb9%','a627efe4%','bd83c6cf%']);
do $$ begin if (select count(*) from dup) <> 10 then raise exception 'ids'; end if;
  if exists (select 1 from canal_items ci join dup on dup.id = ci.variante_id) then raise exception 'hay una cruzada'; end if; end $$;
grant select on dup to authenticated;
select set_config('request.jwt.claims','{"sub":"5f43c17d-958a-4ef7-badc-1a4001a20747","role":"authenticated"}',true);
set local role authenticated;
create temp table r(x jsonb);
insert into r select stock_ajustar(jsonb_build_object('variante_id', v.id, 'modo', 'fijar', 'cantidad', 0, 'motivo', 'Recuento',
  'nota', case when v.id::text like '168e5205%' then 'Pasa a Vedetina Lina Mora L/XL (mismo producto, otro talle) (27/10)' else 'Repetida: la prenda ya está en Tienda Nube con otro talle o color (27/10)' end))
  from v_variantes v join dup on dup.id = v.id where v.stock <> 0;
insert into r select stock_ajustar(jsonb_build_object('variante_id', id, 'modo', 'fijar', 'cantidad', 2, 'motivo', 'Recuento', 'nota', 'Viene de Morado 40 al 42 (27/10)')) from variantes where id::text like '7b7cf5cc%';
reset role;
update variantes set activa = false where id in (select id from dup) and id in (select id from v_variantes where stock = 0);
update variantes set chequear = '¿Es la Caramelo de la web? (allá figura sin stock) (27/10)' where id::text like '0bd27628%';
update variantes set chequear = '¿Es la Daisy XL de la web? (allá figura sin stock) (27/10)' where id::text like '67d38313%';
update variantes v set chequear = null from productos p where p.id = v.producto_id and v.chequear is not null and (
  (p.codigo = '200150' and v.color_id in (select id from atributos where nombre = 'Lila')) or (p.codigo = '200155' and v.talle_id in (select id from atributos where nombre = '100'))
  or (p.codigo = '200147' and v.color_id in (select id from atributos where nombre = 'Azul Marino')) or p.codigo in ('200503','400101'));
select jsonb_build_object('ajustes', (select count(*) from r), 'unidades', (select sum((x->>'cambio')::numeric) from r), 'archivadas', (select count(*) from variantes where id in (select id from dup) and not activa));
commit;
