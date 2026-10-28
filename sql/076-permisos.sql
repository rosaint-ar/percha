-- 076 · Permisos por usuario (28/10/2026, pedido de Diego: "Aldi como vendedora solo debería ver algunas cosas de la venta")
-- empresa_usuarios.permisos jsonb: lo que cambia respecto de su rol (null = lo del rol). La base de datos aplica las ventas:
-- sin "ventas_todas", cada usuaria ve solo SUS ventas de HOY (Inicio, totales y márgenes quedan fuera).

alter table empresa_usuarios add column if not exists permisos jsonb;

-- lo que trae cada rol
create or replace function permisos_rol(p_rol text) returns jsonb language sql immutable as $$
  select case p_rol
    when 'duenio' then '{"inicio":true,"vender":true,"descuentos":true,"ventas_todas":true,"ventas_propias":true,"catalogo_ver":true,"catalogo_editar":true,"costos":true,"clientes":true,"compras":true,"conexiones":true,"configuracion":true}'::jsonb
    when 'admin'  then '{"inicio":true,"vender":true,"descuentos":true,"ventas_todas":true,"ventas_propias":true,"catalogo_ver":true,"catalogo_editar":true,"costos":true,"clientes":true,"compras":true,"conexiones":true,"configuracion":true}'::jsonb
    when 'vendedora' then '{"inicio":false,"vender":true,"descuentos":false,"ventas_todas":false,"ventas_propias":true,"catalogo_ver":true,"catalogo_editar":false,"costos":false,"clientes":true,"compras":false,"conexiones":false,"configuracion":false}'::jsonb
    else '{"inicio":false,"vender":false,"descuentos":false,"ventas_todas":false,"ventas_propias":false,"catalogo_ver":true,"catalogo_editar":false,"costos":false,"clientes":false,"compras":false,"conexiones":false,"configuracion":false}'::jsonb
  end
$$;

create or replace function mis_permisos(e uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select permisos_rol(rol) || coalesce(permisos, '{}'::jsonb) from empresa_usuarios where empresa_id = e and user_id = auth.uid() and activo), '{}'::jsonb)
$$;

create or replace function puede(e uuid, k text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((mis_permisos(e)->>k)::boolean, false)
$$;

-- una venta se ve si no es reservada y: puede ver todas, o es suya y de hoy
create or replace function venta_visible(p_venta uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from ventas v where v.id = p_venta and es_miembro(v.empresa_id) and not v.reservada
    and (puede(v.empresa_id, 'ventas_todas')
         or (puede(v.empresa_id, 'ventas_propias') and auth.uid() in (v.creado_por, v.vendedora_id)
             and v.fecha >= (date_trunc('day', now() at time zone 'America/Argentina/Cordoba') at time zone 'America/Argentina/Cordoba'))))
$$;

drop policy if exists ventas_ver on ventas;
create policy ventas_ver on ventas for select using (es_miembro(empresa_id) and not reservada
  and (puede(empresa_id, 'ventas_todas')
       or (puede(empresa_id, 'ventas_propias') and auth.uid() in (creado_por, vendedora_id)
           and fecha >= (date_trunc('day', now() at time zone 'America/Argentina/Cordoba') at time zone 'America/Argentina/Cordoba'))));
drop policy if exists venta_lineas_ver on venta_lineas;
create policy venta_lineas_ver on venta_lineas for select using (es_miembro(empresa_id) and venta_visible(venta_id));
drop policy if exists venta_pagos_ver on venta_pagos;
create policy venta_pagos_ver on venta_pagos for select using (es_miembro(empresa_id) and venta_visible(venta_id));

-- cambio o devolución: la vendedora busca el ticket original aunque no pueda listar ventas viejas
-- (acepta "1234" o "R-12" para las pagadas en efectivo). Devuelve solo lo necesario para cargar el cambio.
create or replace function venta_para_cambio(e uuid, p_numero text) returns jsonb language plpgsql stable security definer set search_path = public as $$
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
    'lineas', (select coalesce(jsonb_agg(to_jsonb(l) order by l.id), '[]'::jsonb) from venta_lineas l where l.venta_id = v.id and l.cantidad > 0));
end $$;

select json_build_object('aldi', (select mis_permisos_de from (select permisos_rol(rol) || coalesce(permisos, '{}'::jsonb) mis_permisos_de from empresa_usuarios where nombre = 'Aldi') x));
