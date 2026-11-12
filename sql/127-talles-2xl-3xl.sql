-- 127 · Talles con la notación 2XL / 3XL en todo Percha (12/11, Diego: "usemos desde ahora siempre esa denominación,
--       ej 2XL en lugar de XXL. Chequeá todos los productos que usen esas denominaciones y reemplazá").
-- · Se renombran los talles (solo el NOMBRE; el código del talle y el SKU de las variantes NO cambian, porque las etiquetas
--   ya impresas sin EAN llevan el SKU en el código de barras). Por eso se devuelve el SKU que sql/126 había cambiado.
-- · La web (Tienda Nube) puede seguir diciendo XXL/XXXL: para cruzar, XXL = 2XL y XXXL = 3XL (talle_norm acá; en
--   tn-sync, tn-push y tn-pedidos el mismo reemplazo al comparar).
begin;
-- SKU como estaba (etiquetas impresas)
update variantes set sku = replace(sku, '-XLAL3XL', '-XLALXXXL') where talle_id = 'fa3043ad-ece6-44e0-9fcc-3c9ad80792e5' and sku like '%-XLAL3XL%';
update variantes set sku = replace(sku, '-LAL3XL', '-LALXXXL') where talle_id = '01a49660-95d2-45a7-b91b-597721cf3be1' and sku like '%-LAL3XL%';

-- nombres nuevos (solo talles activos; los apagados «L al XXXL» y «XL al XXXL» ya tienen su reemplazo)
update atributos set nombre = regexp_replace(regexp_replace(regexp_replace(nombre, 'XXXXL', '4XL', 'g'), 'XXXL', '3XL', 'g'), 'XXL', '2XL', 'g')
where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and tipo = 'talle' and activo and nombre ~ 'XXL';

create or replace function talle_norm(t text) returns text language sql immutable as $$
  select replace(replace(replace(lower(trim(coalesce(t, ''))), 'xxxxl', '4xl'), 'xxxl', '3xl'), 'xxl', '2xl')
$$;

create or replace function canal_al_modelo_nuevo() returns trigger
language plpgsql security definer set search_path = public as $$
declare p productos%rowtype; col text; tal text;
begin
  if not new.activa then return new; end if;
  select * into p from productos where id = new.producto_id;
  if p.id is null or p.es_generico or not p.activo or p.tipo = 'kit' then return new; end if;
  select nombre into col from atributos where id = new.color_id;
  select nombre into tal from atributos where id = new.talle_id;
  update canal_items ci set variante_id = new.id, cruce = 'manual'
  where ci.id = (
    select c.id from canal_items c join variantes gv on gv.id = c.variante_id join productos g on g.id = gv.producto_id and g.es_generico
    where c.empresa_id = new.empresa_id and c.cruce <> 'manual' and upper(c.nombre) = upper(p.nombre)
      and lower(coalesce(c.color_canal, '')) = lower(coalesce(col, ''))
      and (tal is null or talle_norm(c.talle_canal) = talle_norm(tal))
    order by c.publicado desc, c.id limit 1);
  return new;
end $$;

select nombre, codigo, (select count(*) from variantes v where v.talle_id = a.id) vars from atributos a
where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and tipo = 'talle' and activo and nombre ~ '[234]XL' order by nombre;
commit;
