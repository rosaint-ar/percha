-- 094 · Costo de los pantuflones animados (28/10/2026, Diego: "copiale el costo a cada pantuflón").
-- Al separar los animales del 910103 (sql/025) el costo ($14.000) quedó solo en el código común: cada animal activo lo toma.
begin;
update productos p set costo = g.costo, modificado = now()
from productos g
where g.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and g.codigo = '910103' and g.costo > 0
  and p.empresa_id = g.empresa_id and p.activo and not p.es_generico and p.tipo <> 'kit' and coalesce(p.costo, 0) = 0
  and p.categoria_id = (g.generico_filtro->>'categoria_id')::uuid
  and not exists (select 1 from jsonb_array_elements_text(g.generico_filtro->'incluye') w where upper(p.nombre) not like '%' || upper(w) || '%')
  and not exists (select 1 from jsonb_array_elements_text(g.generico_filtro->'excluye') w where upper(p.nombre) like '%' || upper(w) || '%');
select codigo, nombre, costo, precio from productos where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and nombre like 'PANTUFLÓN%' and activo order by codigo;
commit;
