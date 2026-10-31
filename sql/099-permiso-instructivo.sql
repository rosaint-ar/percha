-- 099 · Permiso "Ver el instructivo" (31/10/2026, Diego: "recordá sumarlo dentro de los permisos para que pueda seleccionarlo").
-- Todos los roles lo traen prendido; en Configuración › Usuarios se puede apagar por persona. El instructivo muestra a cada
-- uno solo los temas de lo que tiene habilitado.
create or replace function permisos_rol(p_rol text) returns jsonb language sql immutable as $$
  select case p_rol
    when 'duenio' then '{"inicio":true,"vender":true,"descuentos":true,"ventas_todas":true,"ventas_propias":true,"catalogo_ver":true,"catalogo_editar":true,"costos":true,"clientes":true,"compras":true,"conexiones":true,"configuracion":true,"instructivo":true}'::jsonb
    when 'admin'  then '{"inicio":true,"vender":true,"descuentos":true,"ventas_todas":true,"ventas_propias":true,"catalogo_ver":true,"catalogo_editar":true,"costos":true,"clientes":true,"compras":true,"conexiones":true,"configuracion":true,"instructivo":true}'::jsonb
    when 'vendedora' then '{"inicio":false,"vender":true,"descuentos":false,"ventas_todas":false,"ventas_propias":true,"catalogo_ver":true,"catalogo_editar":false,"costos":false,"clientes":true,"compras":false,"conexiones":false,"configuracion":false,"instructivo":true}'::jsonb
    else '{"inicio":false,"vender":false,"descuentos":false,"ventas_todas":false,"ventas_propias":false,"catalogo_ver":true,"catalogo_editar":false,"costos":false,"clientes":false,"compras":false,"conexiones":false,"configuracion":false,"instructivo":true}'::jsonb
  end
$$;
select json_object_agg(nombre, (permisos_rol(rol) || coalesce(permisos, '{}'::jsonb))->'instructivo') from empresa_usuarios where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and activo;
