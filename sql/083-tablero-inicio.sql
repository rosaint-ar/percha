-- 083 · Tablero de Inicio (28/10/2026, pedido de Diego: "algo más amigable, con gráficos").
-- Corre con los permisos de quien mira (sin security definer): cada uno ve las ventas que RLS le deja ver
-- (las reservadas solo en modo reservado). Las cuentas las hace la base, el navegador solo dibuja.
create or replace function tablero_inicio(e uuid) returns json language sql stable set search_path = public as $$
  with
  ahora as (select (now() at time zone 'America/Argentina/Buenos_Aires') as t),
  lim as (
    select date_trunc('day', t) as hoy, date_trunc('month', t) as mes,
           date_trunc('month', t) - interval '1 month' as mes_ant,
           -- el mes pasado hasta el mismo día y hora de hoy (para comparar parejo)
           least(date_trunc('month', t) - interval '1 month' + (t - date_trunc('month', t)), date_trunc('month', t)) as mes_ant_corte,
           date_trunc('day', t) - interval '29 days' as desde30
    from ahora),
  v as (
    select x.id, x.total, (x.fecha at time zone 'America/Argentina/Buenos_Aires') as f, coalesce(x.origen, 'local') as origen,
           coalesce(c.online, coalesce(x.origen, 'local') <> 'local') as online, x.envio_estado
    from ventas x left join venta_canales c on c.empresa_id = x.empresa_id and c.clave = x.origen
    where x.empresa_id = e and x.estado <> 'anulada'
      and x.fecha >= ((select mes_ant from lim) at time zone 'America/Argentina/Buenos_Aires') - interval '1 day'),
  lineas as (
    select l.producto_id, coalesce(p.nombre, l.descripcion) as nombre, l.cantidad, l.total
    from venta_lineas l join v on v.id = l.venta_id join productos p on p.id = l.producto_id
    where v.f >= (select mes from lim) and p.tipo = 'prenda')
  select json_build_object(
    'hoy', (select json_build_object('n', count(*), 'total', coalesce(sum(total), 0)) from v where f >= (select hoy from lim)),
    'mes', (select json_build_object('n', count(*), 'total', coalesce(sum(total), 0),
              'prendas', (select coalesce(sum(cantidad), 0) from lineas)) from v where f >= (select mes from lim)),
    'mes_ant_a_fecha', (select coalesce(sum(total), 0) from v where f >= (select mes_ant from lim) and f < (select mes_ant_corte from lim)),
    'mes_ant_total', (select coalesce(sum(total), 0) from v where f >= (select mes_ant from lim) and f < (select mes from lim)),
    'diario', (select json_agg(json_build_object('dia', d::date, 'local', coalesce(lo, 0), 'online', coalesce(onl, 0), 'n', coalesce(n, 0)) order by d)
               from generate_series((select desde30 from lim), (select hoy from lim), interval '1 day') d
               left join (select date_trunc('day', f) as dia, sum(total) filter (where not online) as lo, sum(total) filter (where online) as onl, count(*) as n
                          from v group by 1) s on s.dia = d),
    'top', (select json_agg(t) from (select nombre, sum(cantidad) as unidades, sum(total) as total from lineas group by producto_id, nombre order by 2 desc, 3 desc limit 6) t),
    'canales', (select json_agg(t) from (select v.origen as clave, sum(v.total) as total, count(*) as n from v where f >= (select mes from lim) group by v.origen order by 2 desc) t),
    'por_despachar', (select count(*) from v where envio_estado in ('pendiente', 'preparado'))
  );
$$;
grant execute on function tablero_inicio(uuid) to authenticated;

select tablero_inicio((select id from empresas limit 1))::text;
