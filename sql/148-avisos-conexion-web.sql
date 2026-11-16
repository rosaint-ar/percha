-- 148 · 16/11 (Diego: «¿por qué no estaban conectadas? Tenés que chequear todo, no tiene que volver a pasar»).
-- Caso: LESS «ROUSE» REGULABLE estaba en la web con el código general de las bombachas y el nombre con las palabras en otro
-- orden → Percha la dejó atada al código general (que no toca la web) → la venta #84 del local no bajó la web.
-- Arreglo en la lectura del catálogo (_shared/catalogo.ts): el nombre se compara como conjunto de palabras.
-- Y para que se VEA el mismo día si algo queda mal, el Inicio avisa (además de «sin conectar» y «a decidir»):
--   · en_codigo_general: publicaciones VISIBLES atadas a un código general (BOMBIS «VARIAS», PACK X7 BOMBIS «VARIAS»…):
--     Percha no les controla el stock
--   · stock_sin_web: talles·colores con stock en Percha, de prendas que van a la web, que no están en ninguna publicación
--   · web_no_marcada: prendas marcadas «En la web: No» que tienen una publicación visible en la web (como ROUSE antes)
create or replace function canal_variantes_generales(e uuid) returns setof uuid language sql stable security definer set search_path = public as $$
  -- variantes de códigos generales y de packs armados con códigos generales
  select v.id from variantes v join productos p on p.id = v.producto_id
  where es_miembro(e) and p.empresa_id = e and (p.es_generico or exists (select 1 from producto_componentes pc join productos cp on cp.id = pc.componente_producto_id
                                                        where pc.producto_id = p.id and cp.es_generico))
$$;

create or replace function canal_avisos(e uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select case when not es_miembro(e) then '{}'::jsonb else jsonb_build_object(
    'sin_conectar', (select count(distinct ci.producto_ext) from canal_items ci join conexiones c on c.id = ci.conexion_id
                      where c.empresa_id = e and c.estado = 'activa' and ci.publicado and ci.variante_id is null),
    'sin_conectar_con_stock', (select count(distinct ci.producto_ext) from canal_items ci join conexiones c on c.id = ci.conexion_id
                      where c.empresa_id = e and c.estado = 'activa' and ci.publicado and ci.variante_id is null and coalesce(ci.stock, 0) > 0),
    'a_decidir', (select count(distinct ci.variante_id) from canal_items ci join conexiones c on c.id = ci.conexion_id
                      where c.empresa_id = e and c.estado = 'activa' and ci.stock_a_decidir),
    'en_codigo_general', (select count(distinct ci.producto_ext) from canal_items ci join conexiones c on c.id = ci.conexion_id
                      where c.empresa_id = e and c.estado = 'activa' and ci.publicado and ci.variante_id in (select canal_variantes_generales(e))),
    'stock_sin_web', (select count(*) from v_variantes_sin_canal s join productos p on p.id = s.producto_id
                      where s.empresa_id = e and s.stock > 0 and p.publicar_web and p.activo and not p.es_generico and s.producto_tipo in ('prenda', 'varios') and s.sku !~* '-SD$'),
    'web_no_marcada', (select count(distinct p.id) from productos p join variantes v on v.producto_id = p.id join canal_items ci on ci.variante_id = v.id join conexiones c on c.id = ci.conexion_id
                      where p.empresa_id = e and c.estado = 'activa' and ci.publicado and not p.publicar_web and not p.es_generico),
    'conexion', (select id from conexiones where empresa_id = e and estado = 'activa' and canal = 'tiendanube' limit 1)) end
$$;

-- lo que está conectado a una publicación visible SÍ está en la web: «En la web: Sí» (si no, una prenda nueva de la misma
-- familia o un color nuevo se manejaba como «solo local»)
update productos p set publicar_web = true
where not p.publicar_web and not p.es_generico and exists (select 1 from variantes v join canal_items ci on ci.variante_id = v.id join conexiones c on c.id = ci.conexion_id
  where v.producto_id = p.id and ci.publicado and c.estado = 'activa');
