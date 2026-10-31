-- 103 · (31/10/2026, Diego)
-- 1) Pedidos de la web al instante: Tienda Nube avisa (webhook) a tn-pedidos apenas se paga / actualiza / cancela un pedido,
--    con una llave propia en la dirección (app_config.tn_webhook_key). El cron de cada 2 minutos queda de respaldo.
--    conexiones.pedidos_hasta: un trabajo por vez por tienda (aviso + cron a la vez no cargan dos veces el mismo pedido).
-- 2) "Tenés que mostrarle todas las ventas a las vendedoras": el rol vendedora ve todas las ventas (ventas_todas).
begin;
alter table conexiones add column if not exists pedidos_hasta timestamptz;
insert into app_config (clave, valor) select 'tn_webhook_key', replace(gen_random_uuid()::text, '-', '') where not exists (select 1 from app_config where clave = 'tn_webhook_key');
create or replace function permisos_rol(p_rol text) returns jsonb language sql immutable as $$
  select case p_rol
    when 'duenio' then '{"inicio":true,"vender":true,"descuentos":true,"ventas_todas":true,"ventas_propias":true,"catalogo_ver":true,"catalogo_editar":true,"costos":true,"clientes":true,"compras":true,"conexiones":true,"configuracion":true,"instructivo":true}'::jsonb
    when 'admin'  then '{"inicio":true,"vender":true,"descuentos":true,"ventas_todas":true,"ventas_propias":true,"catalogo_ver":true,"catalogo_editar":true,"costos":true,"clientes":true,"compras":true,"conexiones":true,"configuracion":true,"instructivo":true}'::jsonb
    when 'vendedora' then '{"inicio":false,"vender":true,"descuentos":false,"ventas_todas":true,"ventas_propias":true,"catalogo_ver":true,"catalogo_editar":false,"costos":false,"clientes":true,"compras":false,"conexiones":false,"configuracion":false,"instructivo":true}'::jsonb
    else '{"inicio":false,"vender":false,"descuentos":false,"ventas_todas":false,"ventas_propias":false,"catalogo_ver":true,"catalogo_editar":false,"costos":false,"clientes":false,"compras":false,"conexiones":false,"configuracion":false,"instructivo":true}'::jsonb
  end
$$;
select json_object_agg(nombre, (permisos_rol(rol) || coalesce(permisos, '{}'::jsonb))->'ventas_todas') from empresa_usuarios where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and activo;
commit;
