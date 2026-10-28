-- 082 · Entrar con PIN de 4 en los equipos autorizados (28/10/2026, pedido de Diego).
-- La primera vez, en cada equipo, se entra con correo y contraseña; ahí se elige un PIN y el equipo guarda una llave propia.
-- Después se entra eligiendo el nombre y poniendo el PIN: lo controla la función "pin" con la llave del equipo,
-- así que el PIN solo sirve en ese equipo. 5 PIN mal seguidos → ese equipo vuelve a pedir la contraseña.
create table if not exists pin_equipos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  llave_hash text not null,            -- sha256 de la llave que guarda el equipo
  pin_hash text not null,              -- pbkdf2 del PIN (con sal)
  pin_sal text not null,
  equipo text,                         -- "Chrome en Windows", para reconocerlo
  intentos int not null default 0,
  activo boolean not null default true,
  creado timestamptz not null default now(),
  ultimo_uso timestamptz
);
create index if not exists pin_equipos_user on pin_equipos(user_id);
-- sin políticas: solo la función del servidor la lee (los hash no salen nunca al navegador)
alter table pin_equipos enable row level security;

-- cuántos equipos con PIN tiene cada persona de la empresa (para el panel de Usuarios)
create or replace function pin_equipos_contar(e uuid) returns table(user_id uuid, equipos int)
language sql stable security definer set search_path = public as $$
  select p.user_id, count(*)::int from pin_equipos p
  join empresa_usuarios u on u.user_id = p.user_id and u.empresa_id = e
  where p.activo and es_admin(e) group by p.user_id;
$$;

-- quitar el PIN de todos los equipos de una persona (si se pierde un celular, etc.)
create or replace function pin_equipos_quitar(e uuid, p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not es_admin(e) or not exists (select 1 from empresa_usuarios where empresa_id = e and user_id = p_user) then raise exception 'Sin permiso'; end if;
  update pin_equipos set activo = false where user_id = p_user and activo;
  get diagnostics n = row_count; return n;
end $$;
revoke all on function pin_equipos_contar(uuid) from anon; revoke all on function pin_equipos_quitar(uuid, uuid) from anon;

select count(*) from pin_equipos;
