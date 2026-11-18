-- 151 · Cómo va una prenda a la web: una publicación con todos los colores, o una publicación por color (el color va en
-- el título, como MAGNOLIA). (18/11/2026, Diego: "cuando creo un producto nuevo, necesito que me pregunte si lo manda a la
-- web como un mismo producto con los colores adentro, o lo divide… agregando en el título el color correspondiente")
--   productos.web_por_color: true = una por color · false = una con todos · null = sin elegir (Percha pregunta y no publica
--   una prenda de 2 o más colores hasta que se elija).
alter table productos add column if not exists web_por_color boolean;

-- las que ya están en la web: según cómo están publicadas hoy
with pubs as (
  select v.producto_id, ci.producto_ext, count(distinct v.color_id) colores
  from canal_items ci join variantes v on v.id = ci.variante_id join conexiones c on c.id = ci.conexion_id
  where c.estado = 'activa' group by 1, 2),
por_prod as (select producto_id, count(*) n_pubs, max(colores) max_colores from pubs group by 1)
update productos p set web_por_color = case when pp.max_colores >= 2 then false when pp.n_pubs >= 2 then true else null end
from por_prod pp where pp.producto_id = p.id and p.web_por_color is null;
