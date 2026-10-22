-- Enviar TODO el stock de Percha al canal (primera sincronización o después de una conciliación grande)
create or replace function encolar_todo(p_conexion uuid) returns int
language plpgsql security definer set search_path = public as $$
declare e uuid; n int;
begin
  select empresa_id into e from conexiones where id = p_conexion;
  if e is null or not es_admin(e) then raise exception 'Sin permiso'; end if;
  insert into canal_cola (empresa_id, conexion_id, variante_id)
  select e, p_conexion, ci.variante_id from canal_items ci
  where ci.conexion_id = p_conexion and ci.variante_id is not null
    and not exists (select 1 from canal_cola q where q.conexion_id = p_conexion and q.variante_id = ci.variante_id and q.estado = 'pendiente')
  group by ci.variante_id;
  get diagnostics n = row_count;
  return n;
end $$;
