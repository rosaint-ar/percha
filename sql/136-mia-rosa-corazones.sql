-- 12/11 (Diego): LESS «MIA» ALGODÓN ELÁSTICO ANCHO (100281). La «Rosa» que estaba era la de elástico con corazones;
-- entró una rosa lisa. Se separan: color nuevo «Rosa corazones» SOLO para las 3 variantes de la MIA (conservan su SKU,
-- así las etiquetas ya pegadas siguen sirviendo) y 3 variantes nuevas «Rosa» lisa (stock 0). Ninguna otra prenda se toca.
begin;
insert into atributos (empresa_id, tipo, codigo, nombre, grupo, orden, activo)
select '82c05bbf-e63e-4d25-a762-6f1ee6d27f43', 'color', 'RSC', 'Rosa corazones', 'Rosas', 129, true
where not exists (select 1 from atributos where empresa_id='82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and tipo='color' and nombre='Rosa corazones');

with nuevo as (select id from atributos where empresa_id='82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and tipo='color' and nombre='Rosa corazones')
update variantes set color_id = (select id from nuevo)
where producto_id='001154fa-b449-4289-9599-69d2c5237ebf' and color_id='b93b1c1a-e44b-4ffb-b403-f13d3b5ee454'
  and id in ('5ead77fe-4e65-4670-9f4b-014d048b7369','2af855f8-1549-4158-9fe0-c9ad8cd5c814','8571da9d-f9cc-4af1-a8ec-d22136846919');

update producto_fotos set color_id = (select id from atributos where empresa_id='82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and tipo='color' and nombre='Rosa corazones')
where producto_id='001154fa-b449-4289-9599-69d2c5237ebf' and color_id='b93b1c1a-e44b-4ffb-b403-f13d3b5ee454' and url like '%07_30_52%';   -- la foto vieja (con corazones)

update canal_items set color_canal='Rosa corazones', valores = 'Rosa corazones / ' || talle_canal
where id in (3899,3900,3901) and producto_ext='339548046';

-- rosa lisa: 3 talles, stock 0 (se suben solas a la misma publicación de la web)
insert into variantes (empresa_id, producto_id, talle_id, color_id, sku, activa)
select '82c05bbf-e63e-4d25-a762-6f1ee6d27f43', '001154fa-b449-4289-9599-69d2c5237ebf', t.id, 'b93b1c1a-e44b-4ffb-b403-f13d3b5ee454', '100281-' || t.codigo || '-ROSL', true
from atributos t where t.id in ('19f7ca0a-1b7d-4c48-ad6e-2e06378f1636','89bfa5de-c037-4ed4-906a-cf7c8fb1f94b','88c1510f-fd69-4119-a5e5-c9a124eb8eff')
  and not exists (select 1 from variantes v where v.producto_id='001154fa-b449-4289-9599-69d2c5237ebf' and v.talle_id=t.id and v.color_id='b93b1c1a-e44b-4ffb-b403-f13d3b5ee454');

insert into producto_fotos (empresa_id, producto_id, color_id, url, orden)
select '82c05bbf-e63e-4d25-a762-6f1ee6d27f43', '001154fa-b449-4289-9599-69d2c5237ebf', 'b93b1c1a-e44b-4ffb-b403-f13d3b5ee454',
  'https://acdn-us.mitiendanube.com/stores/001/142/221/products/06-rosa-lisa-2200x3310-2a3fd0e953c53571e617945015700580-1024-1024.jpg', 4
where not exists (select 1 from producto_fotos where producto_id='001154fa-b449-4289-9599-69d2c5237ebf' and color_id='b93b1c1a-e44b-4ffb-b403-f13d3b5ee454');
commit;

select v.id, v.sku, v.talle_nombre, v.color_nombre, v.stock from v_variantes v where v.producto_codigo='100281' and v.empresa_id='82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and v.color_nombre ilike 'rosa%' order by color_nombre, talle_orden;

-- Tienda Nube no deja volver a crear «Rosa» en esa publicación (recuerda el nombre viejo): la lisa se llama «Rosa lisa»,
-- en la web y en Percha (color propio, así el «Rosa» de las otras prendas no se toca). Variantes creadas a mano en la web y cruzadas.
begin;
insert into atributos (empresa_id, tipo, codigo, nombre, grupo, orden, activo)
select '82c05bbf-e63e-4d25-a762-6f1ee6d27f43', 'color', 'ROSL', 'Rosa lisa', 'Rosas', 129, true
where not exists (select 1 from atributos where empresa_id='82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and tipo='color' and nombre='Rosa lisa');
update variantes set color_id = (select id from atributos where empresa_id='82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and tipo='color' and nombre='Rosa lisa')
where producto_id='001154fa-b449-4289-9599-69d2c5237ebf' and id in ('ee04ff1d-341d-4478-a060-56edf8cdc6cb','894ce8a1-82c4-475a-baf7-0e6c8143a6c8','fd096c45-d1e3-4378-9d70-982eff6d478a');
update producto_fotos set color_id = (select id from atributos where empresa_id='82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and tipo='color' and nombre='Rosa lisa')
where producto_id='001154fa-b449-4289-9599-69d2c5237ebf' and url like '%06-rosa-lisa%';
insert into canal_items (empresa_id, conexion_id, producto_ext, variante_ext, nombre, valores, sku, mpn, talle_canal, color_canal, precio, stock, publicado, variante_id, cruce, actualizado)
select '82c05bbf-e63e-4d25-a762-6f1ee6d27f43', '6ecb8eee-1108-463b-a6e4-8161815c730c', '339548046', x.ext, 'LESS «MIA» ELÁSTICO ANCHO ALGODÓN', 'Rosa lisa / '||x.t, '100281', '100281', x.t, 'Rosa lisa', 9375, 0, true, x.vid::uuid, 'manual', now()
from (values ('1638322237','XS al S','ee04ff1d-341d-4478-a060-56edf8cdc6cb'),('1638322472','M al XL','894ce8a1-82c4-475a-baf7-0e6c8143a6c8'),('1638322509','2XL al 3XL','fd096c45-d1e3-4378-9d70-982eff6d478a')) x(ext,t,vid)
on conflict (conexion_id, variante_ext) do nothing;
update canal_publicar set estado='hecho', hecho=now(), actualizado=now(), error=null, detalle=jsonb_build_object('nota','creadas a mano como «Rosa lisa» (12/11)') where id=237;
commit;
select v.sku, v.talle_nombre, v.color_nombre, v.stock, (select ci.variante_ext from canal_items ci where ci.variante_id=v.id limit 1) web
from v_variantes v where v.producto_codigo='100281' and v.empresa_id='82c05bbf-e63e-4d25-a762-6f1ee6d27f43' order by color_nombre, talle_orden;
