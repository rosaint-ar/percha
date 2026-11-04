-- 113 · Lo nuevo de Percha va solo a Tienda Nube, OCULTO, y las fotos de Tienda Nube vuelven a Percha (04/11/2026, Diego:
-- "como la idea es no tocar más Tienda Nube… cuando creo un producto nuevo o agrego un color nuevo, que impacte directo en
-- Tienda Nube pero OCULTO… cuando cargue las fotos a Tienda Nube que impacten en Percha").
-- · productos.publicar_web: "En la web" de la ficha. Las prendas que HOY no están en la web quedan en false (no se suben solas).
-- · canal_publicar: la cola de lo que hay que subir (la procesa tn-publicar cada minuto, con 2 min de calma desde el último cambio).
--   variantes = las que se crearon (null = todas las que falten: cuando se prende "En la web" en una prenda vieja).
-- · conexiones.ultima_sync_fotos: desde cuándo mirar cambios de la web (fotos y visible/oculto).
begin;

alter table productos add column if not exists publicar_web boolean not null default true;
update productos p set publicar_web = false
where not exists (select 1 from variantes v join canal_items ci on ci.variante_id = v.id where v.producto_id = p.id);

create table if not exists canal_publicar (
  id bigserial primary key,
  empresa_id uuid not null references empresas(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete cascade,
  variantes uuid[],
  estado text not null default 'pendiente',   -- pendiente | hecho | error | omitido
  detalle jsonb,
  error text,
  intentos int not null default 0,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  hecho timestamptz
);
create unique index if not exists canal_publicar_abierta on canal_publicar (producto_id) where estado in ('pendiente', 'error');
create index if not exists canal_publicar_estado on canal_publicar (estado, actualizado);
alter table canal_publicar enable row level security;
drop policy if exists canal_publicar_ver on canal_publicar;
create policy canal_publicar_ver on canal_publicar for select using (es_miembro(empresa_id));
grant select on canal_publicar to authenticated;

alter table conexiones add column if not exists ultima_sync_fotos timestamptz;
update conexiones set ultima_sync_fotos = now() where canal = 'tiendanube' and ultima_sync_fotos is null;

-- anotar en la cola (si la prenda va a la web y la empresa tiene la web conectada y manejada por Percha)
create or replace function encolar_publicar(p_producto uuid, p_variante uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pr productos%rowtype;
begin
  select * into pr from productos where id = p_producto;
  if pr.id is null or not pr.activo or not pr.publicar_web or pr.es_generico or pr.tipo not in ('prenda', 'varios') then return; end if;
  if not exists (select 1 from conexiones where empresa_id = pr.empresa_id and canal = 'tiendanube' and estado = 'activa' and empujar_stock) then return; end if;
  insert into canal_publicar as c (empresa_id, producto_id, variantes)
  values (pr.empresa_id, pr.id, case when p_variante is null then null else array[p_variante] end)
  on conflict (producto_id) where estado in ('pendiente', 'error') do update set
    variantes = case when c.variantes is null or excluded.variantes is null then null else (select array(select distinct x from unnest(c.variantes || excluded.variantes) x)) end,
    estado = 'pendiente', intentos = 0, error = null, actualizado = now();
end $$;

-- una variante nueva (o reactivada) que no está en la web
create or replace function trg_variante_a_publicar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.activa and (tg_op = 'INSERT' or not coalesce(old.activa, false))
     and not exists (select 1 from canal_items where variante_id = new.id) then
    perform encolar_publicar(new.producto_id, new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_variante_a_publicar on variantes;
create trigger trg_variante_a_publicar after insert or update of activa on variantes for each row execute function trg_variante_a_publicar();

-- se prendió "En la web" (o se reactivó la prenda): todo lo que le falte
create or replace function trg_producto_a_publicar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.publicar_web and new.activo and (not coalesce(old.publicar_web, false) or not coalesce(old.activo, false))
     and exists (select 1 from variantes v where v.producto_id = new.id and v.activa and not exists (select 1 from canal_items ci where ci.variante_id = v.id)) then
    perform encolar_publicar(new.id, null);
  end if;
  return new;
end $$;
drop trigger if exists trg_producto_a_publicar on productos;
create trigger trg_producto_a_publicar after update of publicar_web, activo on productos for each row execute function trg_producto_a_publicar();

-- cada minuto
select cron.unschedule('percha_tn_publicar') where exists (select 1 from cron.job where jobname = 'percha_tn_publicar');
select cron.schedule('percha_tn_publicar', '* * * * *', $$select cron_llamar('tn-publicar')$$);

select (select count(*) from productos where publicar_web) en_web, (select count(*) from productos where not publicar_web) solo_local;
commit;
