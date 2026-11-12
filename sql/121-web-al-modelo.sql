-- 121 · (APLICADA 11/11) publicaciones de la web cruzadas con el código general → al modelo
-- Ver la explicación en la 120 original: venta #95 FUNNY Smile quedó pendiente porque la publicación estaba atada a MEDIAS VARIAS.
begin;
-- 2) publicaciones de la web cruzadas con un código general cuando el modelo existe (mismo nombre, color/talle único)
with x as (
  select ci.id ci_id, trim(split_part(ci.valores, '/', 1)) col_txt, ci.talle_canal, p.id pid
  from canal_items ci join variantes v on v.id = ci.variante_id join productos g on g.id = v.producto_id and g.es_generico
  join productos p on p.empresa_id = ci.empresa_id and p.activo and not p.es_generico and upper(p.nombre) = upper(ci.nombre)
  where ci.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43'),
m as (
  select x.ci_id, (select array_agg(vv.id) from v_variantes vv where vv.producto_id = x.pid and vv.activa and lower(vv.color_nombre) = lower(x.col_txt)
     and (vv.talle_nombre is null or lower(vv.talle_nombre) = lower(coalesce(x.talle_canal, '')))) cands from x)
update canal_items ci set variante_id = m.cands[1], cruce = 'manual'
from m where m.ci_id = ci.id and cardinality(m.cands) = 1
  and not exists (select 1 from canal_items c2 where c2.variante_id = m.cands[1]);

commit;
