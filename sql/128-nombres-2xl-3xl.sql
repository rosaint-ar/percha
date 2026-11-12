-- 128 · Nombres de prendas con 2XL / 3XL (12/11, Diego: "sí, renombralas a 2XL y 3XL"). Las prendas activas que tenían
--       XXL / XXXL en el nombre pasan a 2XL / 3XL. Queda afuera VESTIDO «XXL ESTAMPADO» (ahí XXL es el nombre del modelo).
-- La web no se renombra: las publicaciones ya atadas siguen igual. Para cruzar por nombre (trigger canal_al_modelo_nuevo y
-- tn-sync) XXL = 2XL y XXXL = 3XL.
begin;
update productos set nombre = regexp_replace(regexp_replace(regexp_replace(nombre, 'XXXXL', '4XL', 'g'), 'XXXL', '3XL', 'g'), 'XXL', '2XL', 'g')
where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and activo and nombre ~ 'XXL' and nombre !~ '«[^»]*XXL[^»]*»';

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
    where c.empresa_id = new.empresa_id and c.cruce <> 'manual' and talle_norm(c.nombre) = talle_norm(p.nombre)
      and lower(coalesce(c.color_canal, '')) = lower(coalesce(col, ''))
      and (tal is null or talle_norm(c.talle_canal) = talle_norm(tal))
    order by c.publicado desc, c.id limit 1);
  return new;
end $$;

select codigo, nombre from productos where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and activo and nombre ~ '[234]XL|XXL' order by nombre;
commit;
