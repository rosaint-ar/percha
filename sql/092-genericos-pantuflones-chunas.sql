-- 092 · Códigos comunes de calzado como las bombachas (28/10/2026, pedido de Diego: "hacelo como las bombachas. chunas pasa lo mismo").
-- En la web todos los pantuflones animados van con el código 910103, y las chunas con el 910105 (cada color es otra publicación).
-- Como con BOMBIS «VARIAS»: el modelo existe por separado (cada animal, cada chuna) y el código común es un GENÉRICO:
-- se vende rápido en la caja, al cobrar pregunta qué modelo fue, y es la "bolsa" de "De bolsa a modelo".
-- · 910103 PANTUFLÓN «ANIMADOS» PREMIUM (estaba apagado desde que se separaron los animales): vuelve como genérico.
-- · CHUNAS «VARIAS»: genérico nuevo. El 910105 queda en CHUNAS «CAMILLE», que es el producto cruzado con la web.
-- Ninguno toca el stock de nadie: los genéricos arrancan en 0 y nunca se mandan a la web.
begin;
do $$
declare e constant uuid := '82c05bbf-e63e-4d25-a762-6f1ee6d27f43'; cal uuid; pid uuid; cod text;
begin
  select id into cal from categorias where empresa_id = e and nombre = 'CALZADO';
  -- pantuflones animados
  update productos set activo = true, es_generico = true, tiene_variantes = false,
         generico_filtro = jsonb_build_object('categoria_id', cal, 'incluye', '["PANTUFLÓN"]'::jsonb, 'excluye', '["LISO","COMBO"]'::jsonb),
         descripcion = coalesce(descripcion || E'\n', '') || 'Código común de los pantuflones animados (como en la web): se vende rápido y al cobrar se elige el animal y el talle.'
   where empresa_id = e and codigo = '910103' returning id into pid;
  if pid is null then raise exception 'No está el 910103'; end if;
  if not exists (select 1 from variantes where producto_id = pid and activa) then insert into variantes (empresa_id, producto_id, sku) values (e, pid, '910103'); end if;
  -- chunas
  select id into pid from productos where empresa_id = e and nombre = 'CHUNAS «VARIAS»';
  if pid is null then
    cod := proximo_codigo(e, '910105');
    insert into productos (empresa_id, codigo, nombre, categoria_id, costo, precio, tipo, tiene_variantes, activo, es_generico, generico_filtro, descripcion)
    select e, cod, 'CHUNAS «VARIAS»', cal, costo, precio, 'prenda', false, true, true,
           jsonb_build_object('categoria_id', cal, 'incluye', '["CHUNAS"]'::jsonb, 'excluye', '["FALLADAS"]'::jsonb),
           'Código común de las chunas (en la web todas van con el 910105): se vende rápido y al cobrar se elige color y talle.'
      from productos where empresa_id = e and codigo = '910105'
    returning id into pid;
    insert into variantes (empresa_id, producto_id, sku) values (e, pid, cod);
  end if;
end $$;
select p.codigo, p.nombre, p.es_generico, p.activo, p.precio, p.generico_filtro, (select count(*) from variantes v where v.producto_id = p.id and v.activa) variantes
from productos p where p.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and p.es_generico order by p.codigo;
commit;
