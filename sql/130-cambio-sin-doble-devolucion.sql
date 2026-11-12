-- 130 · Cambios: no se puede devolver dos veces lo mismo de un ticket (relevamiento 12/11).
-- venta_para_cambio devolvía siempre los renglones completos de la venta: otro cambio sobre el mismo ticket volvía a
-- ofrecer lo ya devuelto (dos notas de crédito / plata de más / stock inflado). Ahora cada renglón trae lo que QUEDA por
-- devolver (lo comprado menos lo devuelto en cambios no anulados de ese ticket, por prenda) y no aparecen los ya devueltos.
create or replace function public.venta_para_cambio(e uuid, p_numero text)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare n bigint; v ventas%rowtype;
begin
  if not es_miembro(e) or not puede(e, 'vender') then raise exception 'Sin permiso'; end if;
  if p_numero ~* '^\s*r\s*-?\s*\d+\s*$' then n := 1000000 + regexp_replace(p_numero, '\D', '', 'g')::bigint;
  elsif p_numero ~ '^\s*#?\s*\d+\s*$' then n := regexp_replace(p_numero, '\D', '', 'g')::bigint;
  else return null; end if;
  select * into v from ventas where empresa_id = e and numero = n;
  if v.id is null then return null; end if;
  return jsonb_build_object('id', v.id, 'numero', v.numero, 'mostrar', case when v.reservada then 'R-' || lpad((v.numero - 1000000)::text, 6, '0') else '#' || lpad(v.numero::text, 6, '0') end,
    'fecha', v.fecha, 'total', v.total, 'estado', v.estado, 'lista_id', v.lista_id,
    'pagos', (select coalesce(jsonb_agg(jsonb_build_object('forma_pago_id', pg.forma_pago_id, 'credito_id', pg.credito_id, 'nombre', coalesce(f.nombre, 'Nota de crédito'), 'tipo', f.tipo, 'monto', pg.monto) order by pg.monto desc), '[]'::jsonb)
      from venta_pagos pg left join formas_pago f on f.id = pg.forma_pago_id where pg.venta_id = v.id and pg.monto > 0),
    'lineas', (
      with dev as (   -- lo ya devuelto de cada prenda en cambios de este ticket
        select vl.variante_id, sum(-vl.cantidad) cant from venta_lineas vl join ventas c on c.id = vl.venta_id
        where c.venta_origen_id = v.id and c.estado <> 'anulada' and vl.cantidad < 0 group by vl.variante_id),
      ls as (
        select l.*, sum(l.cantidad) over (partition by l.variante_id order by l.id) acum from venta_lineas l where l.venta_id = v.id and l.cantidad > 0),
      quedan as (   -- lo devuelto se descuenta de los primeros renglones de esa prenda
        select ls.*, greatest(0, least(ls.cantidad, ls.acum - coalesce(d.cant, 0))) queda from ls left join dev d on d.variante_id is not distinct from ls.variante_id)
      select coalesce(jsonb_agg((to_jsonb(q) - 'acum' - 'queda') || jsonb_build_object('cantidad', q.queda, 'comprado', q.cantidad) order by q.id), '[]'::jsonb)
      from quedan q where q.queda > 0));
end $function$;
