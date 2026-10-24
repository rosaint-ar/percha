-- 041 · Empresas y bancos propios para los medios de pago (además de los que Percha ya conoce).
--       Se reconocen solos al crear un medio cuyo nombre contenga su nombre o alguna de sus palabras.

create table if not exists medios_entidades (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  tipo text not null check (tipo in ('proveedor', 'banco')),
  clave text not null,                  -- lo que se guarda en formas_pago.proveedor / banco
  nombre text not null,
  sigla text not null,
  color text not null default '#6B5CA5',
  palabras text[] not null default '{}', -- otras formas de escribirlo en el nombre del medio
  creado timestamptz not null default now(),
  unique (empresa_id, tipo, clave)
);
alter table medios_entidades enable row level security;
drop policy if exists medios_entidades_ver on medios_entidades;
create policy medios_entidades_ver on medios_entidades for select using (es_miembro(empresa_id));
drop policy if exists medios_entidades_admin on medios_entidades;
create policy medios_entidades_admin on medios_entidades for all using (es_admin(empresa_id)) with check (es_admin(empresa_id));

create or replace function formas_pago_reconocer() returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb; n text := lower(translate(coalesce(new.nombre, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')); x record; prov text; banco text;
begin
  r := medio_pago_reconocer(new.nombre, new.tipo, new.cuotas);
  prov := r->>'proveedor'; banco := r->>'banco';
  -- las empresas y bancos propios de la empresa
  for x in select * from medios_entidades where empresa_id = new.empresa_id loop
    if exists (select 1 from unnest(array_append(x.palabras, x.nombre)) w
               where length(trim(w)) >= 2 and position(lower(translate(trim(w), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) in n) > 0) then
      if x.tipo = 'proveedor' and prov is null then prov := x.clave; end if;
      if x.tipo = 'banco' and banco is null then banco := x.clave; end if;
    end if;
  end loop;
  if tg_op = 'INSERT' or new.nombre is distinct from old.nombre then
    if new.grupo is null or (tg_op = 'UPDATE' and new.grupo is not distinct from old.grupo) then new.grupo := r->>'grupo'; end if;
    if new.proveedor is null or (tg_op = 'UPDATE' and new.proveedor is not distinct from old.proveedor) then new.proveedor := prov; end if;
    if new.banco is null or (tg_op = 'UPDATE' and new.banco is not distinct from old.banco) then new.banco := banco; end if;
  end if;
  -- cuotas escritas en el nombre ("3 cuotas", "6 cuotas") si no se cargaron
  if coalesce(new.cuotas, 1) = 1 and n ~ '([0-9]+) ?cuotas' then new.cuotas := substring(n from '([0-9]+) ?cuotas')::int; end if;
  -- el tipo que usa la caja sigue al grupo
  if new.grupo is not null and (new.tipo is null or new.tipo = 'otro' or tg_op = 'INSERT' or new.grupo is distinct from old.grupo) then
    new.tipo := case new.grupo when 'efectivo' then 'efectivo' when 'transferencia' then 'transferencia' when 'debito' then 'debito' when 'credito' then 'credito' when 'online' then 'online' else 'otro' end;
  end if;
  return new;
end $$;

delete from medios_entidades where clave = 'clover' and nombre = 'Clover';
select count(*) entidades from medios_entidades;
