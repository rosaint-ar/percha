-- 068 · Lista de precios de cada canal (Tienda Nube), parte de la conexión, y envío de precios a la web
-- La lista del canal es una lista más (regla sobre la base, redondeo, excepciones, rebajas) que no aparece en la caja del local.
-- Lo que se manda a la web: precio normal = la lista del canal sin rebajas; precio promocional = con las rebajas que valen en ese canal.
-- Los descuentos "como el panel de Tienda Nube" son rebajas (promociones tipo 'rebaja') con canales = {tiendanube}.

alter table listas_precios add column if not exists canal text;                                   -- null = lista del local
alter table listas_precios add column if not exists conexion_id uuid references conexiones(id) on delete set null;
create unique index if not exists listas_precios_un_canal on listas_precios (empresa_id, canal) where canal is not null and activa;

alter table conexiones add column if not exists empujar_precios boolean not null default false;   -- Percha manda los precios a la web
alter table conexiones add column if not exists ultimo_envio_precios timestamptz;

-- lo que Percha le mandó a la web (para ver qué cambió y cuándo)
create table if not exists canal_precio_envios (
  id          bigserial primary key,
  empresa_id  uuid not null references empresas(id) on delete cascade,
  conexion_id uuid not null references conexiones(id) on delete cascade,
  variante_id uuid references variantes(id) on delete set null,
  producto_ext text, variante_ext text,
  precio_antes numeric, precio_despues numeric,
  promo_antes numeric, promo_despues numeric,
  fecha       timestamptz not null default now(),
  user_id     uuid,
  error       text
);
create index if not exists canal_precio_envios_cx on canal_precio_envios (conexion_id, fecha desc);
alter table canal_precio_envios enable row level security;
drop policy if exists canal_precio_envios_ver on canal_precio_envios; create policy canal_precio_envios_ver on canal_precio_envios for select using (es_admin(empresa_id));

-- la lista de Tienda Nube de la conexión que ya existe: arranca igual que la base (la web no cambia)
insert into listas_precios (empresa_id, nombre, porcentaje, orden, predeterminada, activa, redondeo, toma_rebajas, canal, conexion_id)
select c.empresa_id, 'Tienda Nube', 100, 90, false, true, '10+', true, 'tiendanube', c.id
from conexiones c
where c.canal = 'tiendanube'
  and not exists (select 1 from listas_precios l where l.empresa_id = c.empresa_id and l.canal = 'tiendanube' and l.activa)
on conflict (empresa_id, nombre) do update set canal = 'tiendanube', conexion_id = excluded.conexion_id, activa = true;

-- cada 10 minutos: si la conexión tiene prendido "Percha manda los precios", manda lo que cambió (rebajas que vencen o empiezan, cambios de precio)
select cron.unschedule('percha_tn_precios') where exists (select 1 from cron.job where jobname = 'percha_tn_precios');
select cron.schedule('percha_tn_precios', '*/10 * * * *', $$select cron_llamar('tn-precios')$$);
