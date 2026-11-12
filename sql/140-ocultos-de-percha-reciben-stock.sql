-- 140 · 12/11 (Diego: «cargué un remito de BESOL con las bombachas nuevas y no me las sumó a la web»).
-- Dos reglas chocaban: lo nuevo se sube a la web OCULTO (hasta que tenga fotos) y a lo oculto no se le manda stock
-- (pensado para publicaciones viejas o pausadas). Ahora: la publicación que creó Percha recibe el stock aunque esté oculta.
-- · canal_items.de_percha: la publicación la creó Percha (tn-publicar). Relleno: prendas que Percha publicó como nuevas.
-- · SARA ALGODÓN y ROMANCE estaban con «En la web: No» (la SARA por la importación vieja aunque está en la web;
--   la ROMANCE lo copió de la SARA): pasan a Sí, así suben sus colores que faltan.
begin;
alter table canal_items add column if not exists de_percha boolean not null default false;

update canal_items ci set de_percha = true
from variantes v
where v.id = ci.variante_id and not ci.de_percha and ci.cruce = 'manual'
  and exists (select 1 from canal_publicar cp where cp.producto_id = v.producto_id and cp.estado = 'hecho'
              and cp.detalle -> 'publicaciones' @> '[{"nueva": true}]')
  -- solo las publicaciones de esa prenda que nacieron en Percha (no otras viejas del mismo código)
  and not exists (select 1 from canal_items o join variantes ov on ov.id = o.variante_id
                  where ov.producto_id = v.producto_id and o.producto_ext = ci.producto_ext and o.cruce <> 'manual');

update productos set publicar_web = true
 where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and codigo = '100309' and not publicar_web;
update productos set publicar_web = true
 where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and nombre = 'LESS «ROMANCE» PUNTILLA REGULABLE ELÁSTICO ANCHO' and not publicar_web;

-- que las ocultas de Percha reciban YA el stock
select encolar_canal(v.empresa_id, v.id) from variantes v
 where v.activa and v.id in (select variante_id from canal_items where de_percha and variante_id is not null);

select (select count(*) from canal_items where de_percha) items_de_percha,
       (select count(distinct producto_ext) from canal_items where de_percha) publicaciones;
commit;
