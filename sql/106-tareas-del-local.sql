-- 106 · Tareas del local (31/10/2026, Diego: "un módulo de tareas diarias… tareas de rutina, como limpiar el piso, chequear la
-- vidriera, apagar el aire, poner la alarma… al abrir y cerrar la caja y durante la jornada… totalmente amable y no autoritario…
-- tipo gamificado, así es agradable para la vendedora").
-- · tareas: la rutina del local. momento = 'apertura' | 'cierre' | 'hora' (a una hora) | 'cada' (cada tantos minutos durante el día).
--   dias: 1=lunes … 7=domingo (null = todos). puntos: lo que suma al hacerla.
-- · tareas_hechas: cada vez que alguien la marca (con sus puntos), por día. Se puede deshacer en el día.
-- · tareas_hoy(e): las de hoy con lo hecho, más los puntos de quien mira (hoy / semana / total) y la racha del local
--   (días seguidos con todas las tareas del día hechas).
begin;
create table if not exists tareas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null, emoji text not null default '✨', ayuda text,
  momento text not null default 'apertura' check (momento in ('apertura', 'cierre', 'hora', 'cada')),
  hora time, cada_min int check (cada_min is null or cada_min >= 15),
  dias int[], puntos int not null default 10 check (puntos >= 0),
  orden int not null default 0, activa boolean not null default true, creado timestamptz not null default now()
);
create table if not exists tareas_hechas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  tarea_id uuid not null references tareas(id) on delete cascade,
  fecha date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  hecha timestamptz not null default now(), hecha_por uuid default auth.uid(),
  turno_id uuid references caja_turnos(id) on delete set null, puntos int not null default 0
);
create index if not exists tareas_hechas_dia on tareas_hechas (empresa_id, fecha);
alter table tareas enable row level security;
alter table tareas_hechas enable row level security;
drop policy if exists tareas_ver on tareas;
create policy tareas_ver on tareas for select using (es_miembro(empresa_id));
drop policy if exists tareas_admin on tareas;
create policy tareas_admin on tareas for all using (es_miembro(empresa_id) and puede(empresa_id, 'configuracion')) with check (es_miembro(empresa_id) and puede(empresa_id, 'configuracion'));
drop policy if exists tareas_hechas_ver on tareas_hechas;
create policy tareas_hechas_ver on tareas_hechas for select using (es_miembro(empresa_id));
drop policy if exists tareas_hechas_alta on tareas_hechas;
create policy tareas_hechas_alta on tareas_hechas for insert with check (es_miembro(empresa_id) and hecha_por = auth.uid());
drop policy if exists tareas_hechas_deshacer on tareas_hechas;
create policy tareas_hechas_deshacer on tareas_hechas for delete using (es_miembro(empresa_id) and hecha_por = auth.uid() and fecha = (now() at time zone 'America/Argentina/Buenos_Aires')::date);

-- las tareas que tocan un día (activas, de ese día de la semana, que ya existían)
create or replace function tareas_del_dia(e uuid, d date) returns setof tareas language sql stable security definer set search_path = public as $$
  select * from tareas t where t.empresa_id = e and t.activa and (t.dias is null or cardinality(t.dias) = 0 or extract(isodow from d)::int = any(t.dias))
    and (t.creado at time zone 'America/Argentina/Buenos_Aires')::date <= d
$$;
revoke all on function tareas_del_dia(uuid, date) from anon, public;

create or replace function tareas_hoy(e uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date; d date; racha int := 0; i int;
begin
  if not es_miembro(e) then raise exception 'Sin permiso'; end if;
  -- racha del local: días seguidos (hacia atrás desde ayer; hoy suma si ya está completo) con todas las tareas del día hechas
  for i in 0..120 loop
    d := hoy - i;
    if not exists (select 1 from tareas_del_dia(e, d)) then
      if i = 0 then continue; end if;
      if exists (select 1 from tareas where empresa_id = e and (creado at time zone 'America/Argentina/Buenos_Aires')::date <= d) then continue; end if;   -- un día sin tareas no corta la racha
      exit;
    end if;
    if exists (select 1 from tareas_del_dia(e, d) t where not exists (select 1 from tareas_hechas h where h.tarea_id = t.id and h.fecha = d)) then
      if i = 0 then continue; end if;   -- hoy todavía se está haciendo
      exit;
    end if;
    racha := racha + 1;
  end loop;
  return jsonb_build_object(
    'tareas', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'nombre', t.nombre, 'emoji', t.emoji, 'ayuda', t.ayuda, 'momento', t.momento, 'hora', to_char(t.hora, 'HH24:MI'),
        'cada_min', t.cada_min, 'puntos', t.puntos,
        'hechas', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'hecha', h.hecha, 'mia', h.hecha_por = auth.uid(), 'por', (select nombre from empresa_usuarios u where u.empresa_id = e and u.user_id = h.hecha_por)) order by h.hecha)
          from tareas_hechas h where h.tarea_id = t.id and h.fecha = hoy), '[]'::jsonb)) order by t.orden, t.hora nulls first, t.nombre) from tareas_del_dia(e, hoy) t), '[]'::jsonb),
    'yo', jsonb_build_object(
      'hoy', (select coalesce(sum(puntos), 0) from tareas_hechas where empresa_id = e and hecha_por = auth.uid() and fecha = hoy),
      'semana', (select coalesce(sum(puntos), 0) from tareas_hechas where empresa_id = e and hecha_por = auth.uid() and fecha > hoy - 7),
      'total', (select coalesce(sum(puntos), 0) from tareas_hechas where empresa_id = e and hecha_por = auth.uid()),
      'hechas', (select count(*) from tareas_hechas where empresa_id = e and hecha_por = auth.uid())),
    'racha', racha);
end $$;
revoke all on function tareas_hoy(uuid) from anon;
grant execute on function tareas_hoy(uuid) to authenticated;

-- tareas de prueba para Augusta (cosas necesarias del local; se cambian en Configuración › Tareas)
insert into tareas (empresa_id, nombre, emoji, ayuda, momento, hora, cada_min, puntos, orden)
select '82c05bbf-e63e-4d25-a762-6f1ee6d27f43', x.n, x.em, x.ay, x.mo, x.ho::time, x.ca, x.pu, x.o from (values
  ('Prender las luces y la música', '💡', 'Que el local se vea lindo y con onda desde que entra la primera clienta.', 'apertura', null, null, 5, 1),
  ('Revisar la vidriera', '🪟', 'Que esté ordenada, con las prendas bien puestas y los precios a la vista.', 'apertura', null, null, 10, 2),
  ('Pasar la escoba o el trapo al piso', '🧹', 'Un piso limpio cambia todo.', 'apertura', null, null, 10, 3),
  ('Ordenar el probador', '🪞', 'Espejo limpio, perchas en su lugar y nada olvidado adentro.', 'apertura', null, null, 5, 4),
  ('Acomodar perchas y mesas', '👗', 'Talles en orden y prendas dobladas: así se encuentra todo rápido.', 'cada', null, 180, 10, 5),
  ('Mirar los WhatsApp pendientes', '💬', 'Que ninguna clienta quede esperando respuesta.', 'hora', '13:00', null, 5, 6),
  ('Mirar los WhatsApp pendientes', '💬', 'Que ninguna clienta quede esperando respuesta.', 'hora', '18:00', null, 5, 7),
  ('Apagar el aire o la calefacción', '❄️', 'Ahorramos energía y cuidamos el equipo.', 'cierre', null, null, 5, 8),
  ('Apagar las luces y la vidriera', '🌙', null, 'cierre', null, null, 5, 9),
  ('Sacar la basura', '🗑️', null, 'cierre', null, null, 5, 10),
  ('Poner la alarma y cerrar con llave', '🔒', 'Lo último antes de irte: el local queda cuidado.', 'cierre', null, null, 10, 11)
) x(n, em, ay, mo, ho, ca, pu, o)
where not exists (select 1 from tareas where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43');
select count(*) tareas from tareas where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43';
commit;
