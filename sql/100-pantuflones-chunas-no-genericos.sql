-- 100 · Pantuflones y chunas NO son códigos comunes (31/10/2026, Diego: "pantuflones y chunas no funcionan como el sistema de
-- medias y bombis… es como cualquier otro producto que tiene colores y talles dentro. Analizá todo sin romper nada y reacomodalo").
-- Deshace la parte de genéricos de sql/092. Cada pantuflón animado ya es su producto con sus talles (Capibara con talles y colores),
-- y CHUNAS «CAMILLE» es un producto con colores y talles, igual que en la web: eso no se toca.
-- · 910103 PANTUFLÓN «ANIMADOS» PREMIUM: deja de ser genérico y vuelve a estar apagado (como antes de 092). Sus 2 ventas viejas
--   (#17 y #51, sin variante) quedan como historia.
-- · 910124 CHUNAS «VARIAS» (creado en 092, sin stock, ventas ni movimientos): deja de ser genérico y se apaga. No se borra.
-- Siguen como códigos comunes solo BOMBIS «VARIAS» y MEDIAS VARIAS.
update productos set es_generico = false, generico_filtro = null, activo = false
 where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and codigo in ('910103', '910124') and es_generico;
update variantes v set activa = false from productos p
 where p.id = v.producto_id and p.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and p.codigo in ('910103', '910124')
   and coalesce((select sum(cantidad) from stock s where s.variante_id = v.id), 0) = 0;
select json_build_object('genericos', (select json_agg(codigo || ' ' || nombre) from productos where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and es_generico),
  'apagados', (select json_agg(codigo || ' ' || nombre || ' activo=' || activo) from productos where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and codigo in ('910103', '910124')));
