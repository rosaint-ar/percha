-- 038 · Caja: "Más vendidos" de los últimos N días (FactuSOL + ventas propias de Percha, sin contar dos veces lo importado de FactuSOL)
create or replace function pos_mas_vendidos(p_empresa uuid, p_dias int default 90) returns table (producto_id uuid, unidades numeric)
language sql stable security definer set search_path = public as $$
  with fs as (
    select l.articulo cod, sum(l.cantidad) u from fs_remito_lineas l join fs_remitos r on r.id = l.remito_id
    where r.fecha >= current_date - p_dias and l.cantidad > 0 group by 1),
  pc as (
    select l.producto_id, sum(l.cantidad) u from venta_lineas l join ventas v on v.id = l.venta_id
    where v.empresa_id = p_empresa and v.estado <> 'anulada' and v.fecha >= now() - make_interval(days => p_dias)
      and v.origen in ('local', 'whatsapp', 'online') and coalesce(v.referencia, '') not like 'FactuSOL%' and l.cantidad > 0 group by 1)
  select p.id, coalesce(fs.u, 0) + coalesce(pc.u, 0)
  from productos p left join fs on fs.cod = p.codigo left join pc on pc.producto_id = p.id
  where es_miembro(p_empresa) and p.empresa_id = p_empresa and p.activo and coalesce(fs.u, 0) + coalesce(pc.u, 0) > 0
  order by 2 desc limit 120;
$$;
