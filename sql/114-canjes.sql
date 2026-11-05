-- 114 · CANJES con influencers (05/11/2026, Diego: "un remito de CANJE entregando un producto con costo $0 y que aclare que es
-- canje para que no entre en estadísticas de venta… pasa con dos clientas (influencers) y puede pasar con más… que quede
-- asentado para estadística").
-- · ventas.tipo = 'canje': total $0, sin pagos; las prendas salen del stock (y de la web) como en una venta; guarda el costo de la
--   mercadería (ventas.costo) y lo que pagó el local por el envío (envio_costo).
-- · NO cuenta como venta: Inicio (tablero_inicio), métricas del Core (core_lineas), "más vendidos" del POS, cierres de caja
--   (fuera de la caja e historial) ni se factura. Se ve en Ventas › Canjes, con sus totales (v_canjes).
-- Las funciones se cambian agregando la condición a su texto actual: si alguna no tiene el texto esperado, no se cambia nada.
begin;

alter table ventas drop constraint if exists ventas_tipo_check;
alter table ventas add constraint ventas_tipo_check check (tipo = any (array['venta', 'cambio', 'devolucion', 'canje']));

do $$
declare
  d text; n text; opciones text;
  cambios constant text[][] := array[
    ['tablero_inicio', 'where x.empresa_id = e and x.estado <> ''anulada''', 'where x.empresa_id = e and x.estado <> ''anulada'' and x.tipo <> ''canje'''],
    ['pos_mas_vendidos', 'where v.empresa_id = p_empresa and v.estado <> ''anulada''', 'where v.empresa_id = p_empresa and v.estado <> ''anulada'' and v.tipo <> ''canje'''],
    ['caja_fuera', 'and not v.reservada and v.estado <> ''anulada''', 'and not v.reservada and v.estado <> ''anulada'' and v.tipo <> ''canje'''],
    ['caja_historial', 'where v.turno_id = t.id and v.estado <> ''anulada'' and not v.reservada) as ventas', 'where v.turno_id = t.id and v.estado <> ''anulada'' and not v.reservada and v.tipo <> ''canje'') as ventas'],
    ['factura_pedir', 'if v.estado <> ''completada'' then raise', 'if v.tipo = ''canje'' then raise exception ''Un canje no se factura (no es una venta)''; end if;
  if v.estado <> ''completada'' then raise']];
  i int;
begin
  for i in 1 .. array_length(cambios, 1) loop
    select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = cambios[i][1];
    if d is null then raise exception 'No está la función %', cambios[i][1]; end if;
    if position(cambios[i][3] in d) > 0 then continue; end if;   -- ya estaba
    if position(cambios[i][2] in d) = 0 then raise exception 'La función % no tiene el texto esperado: no se cambia nada', cambios[i][1]; end if;
    execute replace(d, cambios[i][2], cambios[i][3]);
  end loop;

  -- métricas del Core: la vista de líneas de venta deja afuera los canjes
  select pg_get_viewdef('core_lineas'::regclass, true) into d;
  if position('''canje''' in d) = 0 then
    n := replace(d, '(NOT COALESCE(v.reservada, false))', '(NOT COALESCE(v.reservada, false)) AND v.tipo <> ''canje''::text');
    if n = d then
      n := replace(d, 'NOT COALESCE(v.reservada, false)', 'NOT COALESCE(v.reservada, false) AND v.tipo <> ''canje''::text');
    end if;
    if n = d then raise exception 'core_lineas no tiene el texto esperado: no se cambia nada'; end if;
    select array_to_string(reloptions, ', ') into opciones from pg_class where oid = 'core_lineas'::regclass;
    execute 'create or replace view core_lineas' || coalesce(' with (' || opciones || ')', '') || ' as ' || n;
  end if;
end $$;

-- los canjes, para verlos y sumarlos (estadística de marketing)
create or replace view v_canjes with (security_invoker = true) as
select v.id, v.empresa_id, v.numero, v.fecha, v.estado, v.cliente_id, c.nombre as cliente_nombre, c.telefono, v.nota,
  v.envio_metodo, coalesce(v.envio_costo, 0) as envio_costo, v.envio_estado, v.envio_direccion,
  coalesce((select sum(l.cantidad) from venta_lineas l where l.venta_id = v.id and l.variante_id is not null), 0) as prendas,
  coalesce((select sum(l.cantidad * l.precio_lista) from venta_lineas l where l.venta_id = v.id and l.variante_id is not null), 0) as valor,
  coalesce(v.costo, 0) as costo_mercaderia,
  coalesce(v.costo, 0) + coalesce(v.envio_costo, 0) as costo_total,
  (select string_agg(l.cantidad::int || '× ' || l.descripcion || coalesce(' ' || nullif(concat_ws(' · ', l.color, l.talle), ''), ''), ' | ' order by l.id)
     from venta_lineas l where l.venta_id = v.id and l.variante_id is not null) as detalle
from ventas v left join clientes c on c.id = v.cliente_id
where v.tipo = 'canje';
grant select on v_canjes to authenticated;

select (select count(*) from pg_proc where proname in ('tablero_inicio','pos_mas_vendidos','caja_fuera','caja_historial','factura_pedir') and pg_get_functiondef(oid) like '%canje%') funciones_ok,
  (select position('canje' in pg_get_viewdef('core_lineas'::regclass)) > 0) core_ok;
commit;
