-- Números del inicio calculados en la base (PostgREST corta en 1000 filas: nunca sumar en el navegador)
create or replace function resumen_inicio(e uuid) returns json
language sql stable security invoker set search_path = public as $$
  with v as (
    select v.id, v.producto_id, p.tipo, coalesce(sum(s.cantidad), 0) as stock, coalesce(v.costo, p.costo) as costo
    from variantes v join productos p on p.id = v.producto_id
    left join stock s on s.variante_id = v.id
    where v.empresa_id = e and v.activa and p.activo
    group by v.id, v.producto_id, p.tipo, v.costo, p.costo
  )
  select json_build_object(
    'productos_activos', (select count(*) from productos where empresa_id = e and activo),
    'productos_con_stock', (select count(distinct producto_id) from v where tipo = 'prenda' and stock > 0),
    'productos_sin_stock', (select count(distinct producto_id) from v where tipo = 'prenda') - (select count(distinct producto_id) from v where tipo = 'prenda' and stock > 0),
    'unidades', (select coalesce(sum(stock), 0) from v where tipo = 'prenda'),
    'valor_costo', (select coalesce(sum(greatest(stock, 0) * costo), 0) from v where tipo = 'prenda'),
    'variantes_sin_ean', (select count(*) from variantes v2 join productos p2 on p2.id = v2.producto_id where v2.empresa_id = e and v2.activa and p2.activo and p2.tipo = 'prenda' and v2.ean is null)
  );
$$;
