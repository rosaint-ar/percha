-- Augusta Core · base multiempresa (fase 1: empresas, usuarios, catálogo, variantes, stock, precios)
-- Cada fila lleva empresa_id. El acceso lo decide RLS según la membresía del usuario (empresa_usuarios).

create extension if not exists pgcrypto;

-- ---------- Empresas y usuarios ----------
create table if not exists empresas (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  razon_social  text,
  cuit          text,
  condicion_iva text not null default 'monotributo',   -- monotributo | responsable_inscripto | exento
  iibb          text,
  inicio_actividades date,
  domicilio     text, localidad text, provincia text, codigo_postal text,
  telefono      text, email text, web text,
  logo_url      text,
  config        jsonb not null default '{}'::jsonb,     -- etiquetas, moneda, arca, etc.
  activa        boolean not null default true,
  creada        timestamptz not null default now()
);

create table if not exists empresa_usuarios (
  empresa_id  uuid not null references empresas(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  nombre      text not null,
  rol         text not null default 'vendedora',          -- duenio | admin | vendedora | visor
  activo      boolean not null default true,
  creado      timestamptz not null default now(),
  primary key (empresa_id, user_id),
  constraint rol_valido check (rol in ('duenio','admin','vendedora','visor'))
);
create index if not exists empresa_usuarios_user on empresa_usuarios (user_id);

-- Funciones de ayuda para RLS (security definer: leen la membresía sin pasar por RLS)
create or replace function es_miembro(e uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from empresa_usuarios where empresa_id = e and user_id = auth.uid() and activo);
$$;
create or replace function rol_en(e uuid) returns text
language sql stable security definer set search_path = public as $$
  select rol from empresa_usuarios where empresa_id = e and user_id = auth.uid() and activo limit 1;
$$;
create or replace function es_admin(e uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(rol_en(e) in ('duenio','admin'), false);
$$;
-- Empresas del usuario (para el selector de empresa)
create or replace function mis_empresas() returns setof empresas
language sql stable security definer set search_path = public as $$
  select e.* from empresas e join empresa_usuarios eu on eu.empresa_id = e.id
  where eu.user_id = auth.uid() and eu.activo and e.activa order by e.nombre;
$$;

-- ---------- Catálogo ----------
create table if not exists categorias (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  codigo     text,
  nombre     text not null,
  orden      int  not null default 0,
  activa     boolean not null default true,
  unique (empresa_id, nombre)
);

-- Valores de los ejes de variante: talle, color, estampa
create table if not exists atributos (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  tipo       text not null,                    -- talle | color | estampa
  codigo     text not null,
  nombre     text not null,
  hex        text,                             -- color de referencia para mostrar
  orden      int  not null default 0,
  activo     boolean not null default true,
  unique (empresa_id, tipo, codigo),
  constraint tipo_valido check (tipo in ('talle','color','estampa'))
);

create table if not exists proveedores (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre     text not null,
  cuit       text, telefono text, email text, direccion text, localidad text,
  notas      text,
  activo     boolean not null default true,
  codigo_fs  text,
  unique (empresa_id, nombre)
);

create table if not exists productos (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references empresas(id) on delete cascade,
  codigo       text not null,                 -- código interno (en Augusta viene de FactuSOL)
  nombre       text not null,
  descripcion  text,
  categoria_id uuid references categorias(id),
  proveedor_id uuid references proveedores(id),
  costo        numeric(14,2) not null default 0,
  precio       numeric(14,2) not null default 0,   -- precio de lista base (sin descuentos)
  ean          text,                                -- código de barras del producto (si no tiene variantes)
  tipo         text not null default 'prenda',      -- prenda | servicio | sena | gift_card | varios
  tiene_variantes boolean not null default false,
  imagen_url   text,
  activo       boolean not null default true,
  creado       timestamptz not null default now(),
  modificado   timestamptz not null default now(),
  unique (empresa_id, codigo)
);
create index if not exists productos_nombre on productos (empresa_id, nombre);

create table if not exists variantes (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete cascade,
  talle_id    uuid references atributos(id),
  color_id    uuid references atributos(id),
  estampa_id  uuid references atributos(id),
  sku         text,
  ean         text,
  costo       numeric(14,2),                 -- si es nulo, usa el del producto
  precio      numeric(14,2),                 -- si es nulo, usa el del producto
  activa      boolean not null default true,
  creado      timestamptz not null default now(),
  unique (producto_id, talle_id, color_id, estampa_id)
);
create index if not exists variantes_ean on variantes (empresa_id, ean);
create index if not exists variantes_producto on variantes (producto_id);

-- ---------- Depósitos y stock ----------
create table if not exists depositos (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  codigo     text not null,
  nombre     text not null,
  principal  boolean not null default false,
  activo     boolean not null default true,
  unique (empresa_id, codigo)
);

create table if not exists stock (
  variante_id uuid not null references variantes(id) on delete cascade,
  deposito_id uuid not null references depositos(id) on delete cascade,
  empresa_id  uuid not null references empresas(id) on delete cascade,
  cantidad    numeric(12,3) not null default 0,
  minimo      numeric(12,3) not null default 0,
  primary key (variante_id, deposito_id)
);

-- Todo cambio de stock pasa por acá; el saldo de `stock` lo mantiene un trigger.
create table if not exists stock_movimientos (
  id          bigserial primary key,
  empresa_id  uuid not null references empresas(id) on delete cascade,
  variante_id uuid not null references variantes(id) on delete cascade,
  deposito_id uuid not null references depositos(id),
  cantidad    numeric(12,3) not null,          -- positivo entra, negativo sale
  tipo        text not null,                   -- inicial | compra | venta | devolucion | ajuste | transferencia
  referencia  text,                            -- id de venta / compra / etc.
  nota        text,
  user_id     uuid default auth.uid(),
  fecha       timestamptz not null default now()
);
create index if not exists stock_mov_variante on stock_movimientos (variante_id, fecha desc);
create index if not exists stock_mov_empresa_fecha on stock_movimientos (empresa_id, fecha desc);

create or replace function aplicar_movimiento_stock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into stock (variante_id, deposito_id, empresa_id, cantidad)
  values (new.variante_id, new.deposito_id, new.empresa_id, new.cantidad)
  on conflict (variante_id, deposito_id) do update set cantidad = stock.cantidad + excluded.cantidad;
  return new;
end $$;
drop trigger if exists trg_aplicar_movimiento on stock_movimientos;
create trigger trg_aplicar_movimiento after insert on stock_movimientos
  for each row execute function aplicar_movimiento_stock();

-- ---------- Listas de precios ----------
create table if not exists listas_precios (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  nombre        text not null,
  porcentaje    numeric(7,3) not null default 100,   -- sobre el precio de lista base del producto
  orden         int not null default 0,
  predeterminada boolean not null default false,
  activa        boolean not null default true,
  codigo_fs     int,
  unique (empresa_id, nombre)
);

-- Precio fijado a mano para una lista (si no hay fila, se calcula con el porcentaje)
create table if not exists precios (
  lista_id    uuid not null references listas_precios(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete cascade,
  variante_id uuid references variantes(id) on delete cascade,
  precio      numeric(14,2) not null,
  empresa_id  uuid not null references empresas(id) on delete cascade,
  unique (lista_id, producto_id, variante_id)
);

-- ---------- Clientes y formas de pago (base para la caja) ----------
create table if not exists clientes (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  nombre        text not null,
  tipo_doc      text,                        -- DNI | CUIT | CUIL
  documento     text,
  condicion_iva text default 'consumidor_final',
  telefono      text, email text, direccion text, localidad text,
  nacimiento    date,
  lista_id      uuid references listas_precios(id),
  notas         text,
  generico      boolean not null default false,   -- "Consumidor final" y similares
  activo        boolean not null default true,
  codigo_fs     int,
  creado        timestamptz not null default now()
);
create index if not exists clientes_nombre on clientes (empresa_id, nombre);

create table if not exists formas_pago (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  tipo        text not null default 'otro',   -- efectivo | transferencia | debito | credito | mercadopago | online | otro
  cuotas      int not null default 1,
  recargo_pct numeric(7,3) not null default 0,
  lista_id    uuid references listas_precios(id),  -- lista que aplica al pagar así (ej. Contado)
  orden       int not null default 0,
  activa      boolean not null default true,
  codigo_fs   int,
  unique (empresa_id, nombre)
);

-- ---------- modificado automático ----------
create or replace function set_modificado() returns trigger language plpgsql as $$
begin new.modificado = now(); return new; end $$;
drop trigger if exists trg_productos_modificado on productos;
create trigger trg_productos_modificado before update on productos for each row execute function set_modificado();

-- ---------- Vistas ----------
-- Stock total por variante (suma de depósitos) + datos para mostrar
create or replace view v_variantes with (security_invoker = true) as
select v.id, v.empresa_id, v.producto_id, p.codigo as producto_codigo, p.nombre as producto_nombre,
       v.sku, v.ean, v.activa,
       t.codigo as talle, t.nombre as talle_nombre, t.orden as talle_orden,
       c.codigo as color, c.nombre as color_nombre, c.hex as color_hex,
       e.codigo as estampa, e.nombre as estampa_nombre,
       coalesce(v.costo, p.costo) as costo,
       coalesce(v.precio, p.precio) as precio,
       coalesce((select sum(s.cantidad) from stock s where s.variante_id = v.id), 0) as stock
from variantes v
join productos p on p.id = v.producto_id
left join atributos t on t.id = v.talle_id
left join atributos c on c.id = v.color_id
left join atributos e on e.id = v.estampa_id;

-- Resumen por producto para el listado del catálogo
create or replace view v_productos with (security_invoker = true) as
select p.*, cat.nombre as categoria, pr.nombre as proveedor,
       (select count(*) from variantes v where v.producto_id = p.id and v.activa) as variantes,
       coalesce((select sum(s.cantidad) from stock s join variantes v on v.id = s.variante_id where v.producto_id = p.id), 0) as stock
from productos p
left join categorias cat on cat.id = p.categoria_id
left join proveedores pr on pr.id = p.proveedor_id;

-- ---------- RLS ----------
alter table empresas          enable row level security;
alter table empresa_usuarios  enable row level security;
alter table categorias        enable row level security;
alter table atributos         enable row level security;
alter table proveedores       enable row level security;
alter table productos         enable row level security;
alter table variantes         enable row level security;
alter table depositos         enable row level security;
alter table stock             enable row level security;
alter table stock_movimientos enable row level security;
alter table listas_precios    enable row level security;
alter table precios           enable row level security;
alter table clientes          enable row level security;
alter table formas_pago       enable row level security;

drop policy if exists empresas_ver on empresas;
create policy empresas_ver on empresas for select using (es_miembro(id));
drop policy if exists empresas_editar on empresas;
create policy empresas_editar on empresas for update using (es_admin(id)) with check (es_admin(id));

drop policy if exists eu_ver on empresa_usuarios;
create policy eu_ver on empresa_usuarios for select using (es_miembro(empresa_id));
drop policy if exists eu_admin on empresa_usuarios;
create policy eu_admin on empresa_usuarios for all using (es_admin(empresa_id)) with check (es_admin(empresa_id));

-- Catálogo: todos los miembros leen; dueño/admin escriben
do $$
declare t text;
begin
  foreach t in array array['categorias','atributos','proveedores','productos','variantes','depositos','stock','listas_precios','precios','clientes','formas_pago'] loop
    execute format('drop policy if exists %I_ver on %I', t, t);
    execute format('create policy %I_ver on %I for select using (es_miembro(empresa_id))', t, t);
    execute format('drop policy if exists %I_admin on %I', t, t);
    execute format('create policy %I_admin on %I for all using (es_admin(empresa_id)) with check (es_admin(empresa_id))', t, t);
  end loop;
end $$;

-- Movimientos de stock: cualquier miembro activo puede registrar (vende, ajusta); nadie edita ni borra
drop policy if exists mov_ver on stock_movimientos;
create policy mov_ver on stock_movimientos for select using (es_miembro(empresa_id));
drop policy if exists mov_insertar on stock_movimientos;
create policy mov_insertar on stock_movimientos for insert with check (es_miembro(empresa_id) and rol_en(empresa_id) <> 'visor');
-- Las vendedoras también pueden crear clientas
drop policy if exists clientes_vendedora on clientes;
create policy clientes_vendedora on clientes for insert with check (es_miembro(empresa_id) and rol_en(empresa_id) <> 'visor');

-- Las tablas crudas de FactuSOL (fs_*) quedan solo para informes: accesibles a quien pertenezca a Augusta
-- (se asignan cuando exista la empresa; ver 002).
