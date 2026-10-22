-- Percha · Conexiones con canales de venta (Tienda Nube, Mercado Libre) y cruce de catálogo

-- Credenciales de las apps de Percha en cada plataforma (solo las leen las funciones con service role)
create table if not exists app_config (
  clave text primary key,
  valor text not null
);
alter table app_config enable row level security;   -- sin policies: nadie la lee desde el navegador

create table if not exists conexiones (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  canal       text not null check (canal in ('tiendanube','mercadolibre')),
  nombre      text,                       -- nombre de la tienda en el canal
  externo_id  text not null,              -- store_id de TN / user_id de ML
  url         text,
  estado      text not null default 'activa' check (estado in ('activa','pausada','error')),
  config      jsonb not null default '{}'::jsonb,   -- {cruzar_por: 'sku'|'barcode', deposito_id, ...}
  ultima_sync timestamptz,
  ultimo_error text,
  creada      timestamptz not null default now(),
  unique (empresa_id, canal, externo_id)
);
-- Tokens aparte: la tabla no tiene policy de lectura, solo la usan las funciones (service role)
create table if not exists conexion_secretos (
  conexion_id   uuid primary key references conexiones(id) on delete cascade,
  access_token  text not null,
  refresh_token text,
  scope         text,
  vence         timestamptz,
  actualizado   timestamptz not null default now()
);
alter table conexiones enable row level security;
alter table conexion_secretos enable row level security;
drop policy if exists conexiones_ver on conexiones; create policy conexiones_ver on conexiones for select using (es_miembro(empresa_id));
drop policy if exists conexiones_admin on conexiones; create policy conexiones_admin on conexiones for all using (es_admin(empresa_id)) with check (es_admin(empresa_id));

-- Estados del OAuth (para atar la vuelta del canal con la empresa que inició)
create table if not exists oauth_estados (
  estado      text primary key,
  empresa_id  uuid not null references empresas(id) on delete cascade,
  canal       text not null,
  user_id     uuid not null,
  creado      timestamptz not null default now()
);
alter table oauth_estados enable row level security;

-- Catálogo del canal, tal como está publicado, y a qué variante de Percha corresponde
create table if not exists canal_items (
  id              bigserial primary key,
  empresa_id      uuid not null references empresas(id) on delete cascade,
  conexion_id     uuid not null references conexiones(id) on delete cascade,
  producto_ext    text not null,          -- id del producto en el canal
  variante_ext    text not null,          -- id de la variante en el canal
  nombre          text,
  valores         text,                   -- "S / Rosa"
  sku             text,
  barcode         text,
  mpn             text,
  precio          numeric(14,2),
  precio_promo    numeric(14,2),
  stock           numeric(12,3),          -- null = sin control de stock en el canal
  publicado       boolean,
  url             text,
  imagen          text,
  variante_id     uuid references variantes(id) on delete set null,   -- cruce con Percha
  cruce           text not null default 'ninguno' check (cruce in ('sku','barcode','manual','ninguno')),
  actualizado     timestamptz not null default now(),
  unique (conexion_id, variante_ext)
);
create index if not exists canal_items_variante on canal_items (variante_id);
alter table canal_items enable row level security;
drop policy if exists canal_items_ver on canal_items; create policy canal_items_ver on canal_items for select using (es_miembro(empresa_id));
drop policy if exists canal_items_admin on canal_items; create policy canal_items_admin on canal_items for update using (es_admin(empresa_id)) with check (es_admin(empresa_id));

-- Cruce: canal vs Percha, con stock de los dos lados
create or replace view v_cruce_canal with (security_invoker = true) as
select ci.*, cx.canal, cx.nombre as conexion_nombre,
       v.sku as sku_percha, v.ean as ean_percha, v.producto_nombre as producto_percha, v.talle_nombre, v.color_nombre,
       v.precio as precio_percha, v.stock as stock_percha,
       case when ci.variante_id is null then 'sin_cruzar'
            when ci.stock is null then 'sin_control'
            when ci.stock = v.stock then 'igual'
            else 'distinto' end as estado_stock
from canal_items ci
join conexiones cx on cx.id = ci.conexion_id
left join v_variantes v on v.id = ci.variante_id;

-- Variantes de Percha que no están en ningún canal (para "qué falta publicar")
create or replace view v_variantes_sin_canal with (security_invoker = true) as
select v.*, c.id as conexion_id
from v_variantes v
cross join conexiones c
where c.empresa_id = v.empresa_id and c.estado = 'activa' and v.activa
  and not exists (select 1 from canal_items ci where ci.conexion_id = c.id and ci.variante_id = v.id);

-- Resumen por conexión
create or replace function resumen_conexion(c uuid) returns json
language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'items', (select count(*) from canal_items where conexion_id = c),
    'cruzados', (select count(*) from canal_items where conexion_id = c and variante_id is not null),
    'sin_cruzar', (select count(*) from canal_items where conexion_id = c and variante_id is null),
    'stock_distinto', (select count(*) from v_cruce_canal where conexion_id = c and estado_stock = 'distinto'),
    'percha_sin_publicar', (select count(*) from v_variantes_sin_canal where conexion_id = c),
    'ultima_sync', (select ultima_sync from conexiones where id = c)
  );
$$;
