-- 065 · Listas de precios con reglas (como Rosaint: una lista base y las demás se derivan) + rebajas
-- Lista (la predeterminada) = el precio de cada producto. Cada otra lista = Lista × porcentaje, con excepciones por familia o
-- producto, precio fijo puntual (tabla precios) y redondeo (por defecto, para arriba a $10).
-- Rebaja = promoción tipo 'rebaja': baja el precio de la prenda ANTES de la lista (Magnolia 75.000 → 59.990; Contado = 59.990 × 0,80).
-- Puede ser un % sobre Lista o un precio fijo por producto o por talle/color (rebaja_precios). En la web va como precio tachado.

alter table listas_precios add column if not exists redondeo text not null default '10+';
alter table listas_precios add column if not exists toma_rebajas boolean not null default true;

create table if not exists lista_excepciones (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  lista_id    uuid not null references listas_precios(id) on delete cascade,
  categoria_id uuid references categorias(id) on delete cascade,
  producto_id uuid references productos(id) on delete cascade,
  porcentaje  numeric(7,3) not null,               -- sobre Lista, como listas_precios.porcentaje
  creada      timestamptz not null default now(),
  check ((categoria_id is null) <> (producto_id is null)),
  unique (lista_id, categoria_id, producto_id)
);
alter table lista_excepciones enable row level security;
drop policy if exists lista_excepciones_ver on lista_excepciones; create policy lista_excepciones_ver on lista_excepciones for select using (es_miembro(empresa_id));
drop policy if exists lista_excepciones_admin on lista_excepciones; create policy lista_excepciones_admin on lista_excepciones for all using (es_admin(empresa_id)) with check (es_admin(empresa_id));

-- rebajas
do $$ begin
  alter table promociones drop constraint if exists promociones_tipo_check;
  alter table promociones add constraint promociones_tipo_check check (tipo in ('porcentaje','monto','nxm','cantidad','rebaja'));
end $$;
create table if not exists rebaja_precios (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references empresas(id) on delete cascade,
  promocion_id uuid not null references promociones(id) on delete cascade,
  producto_id  uuid not null references productos(id) on delete cascade,
  variante_id  uuid references variantes(id) on delete cascade,   -- null = todo el producto
  precio       numeric(14,2) not null check (precio >= 0)
);
create unique index if not exists rebaja_precios_uno on rebaja_precios (promocion_id, producto_id, coalesce(variante_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists rebaja_precios_prod on rebaja_precios (producto_id);
alter table rebaja_precios enable row level security;
drop policy if exists rebaja_precios_ver on rebaja_precios; create policy rebaja_precios_ver on rebaja_precios for select using (es_miembro(empresa_id));
drop policy if exists rebaja_precios_admin on rebaja_precios; create policy rebaja_precios_admin on rebaja_precios for all using (es_admin(empresa_id)) with check (es_admin(empresa_id));

-- el mayorista no toma las rebajas (es Lista −40% siempre)
update listas_precios set toma_rebajas = false where nombre ilike 'mayorista%' and toma_rebajas;
