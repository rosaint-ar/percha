-- 050 · Promociones por canal (genérico, para cualquier empresa): canales text[] (null = todos) en la promoción y en cada escalón.
--   Canales: local y whatsapp siempre; más cada conexión de la empresa (tiendanube, mercadolibre…). Reemplaza "canal" (local/online/ambos).
alter table promociones add column if not exists canales text[];
update promociones set canales = case canal when 'local' then array['local','whatsapp'] when 'online' then array['tiendanube','mercadolibre','online'] else null end where canales is null and canal <> 'ambos';
select jsonb_agg(jsonb_build_object('nombre', nombre, 'canales', canales, 'escalones', escalones)) from promociones;
