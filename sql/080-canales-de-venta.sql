-- 080 · Etiquetas de canal de las ventas (Local, WhatsApp, Web…): se crean en Configuración › Canales de venta,
-- se ponen solas (caja = Local, pedidos de la web = Tienda Nube) y se pueden cambiar en cada venta (28/10/2026, pedido de Diego).
create table if not exists venta_canales (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  clave text not null,                 -- lo que se guarda en ventas.origen
  nombre text not null,
  color text,                          -- #hex para la etiqueta
  online boolean not null default false,
  activo boolean not null default true,
  orden int not null default 0,
  unique (empresa_id, clave)
);
alter table venta_canales enable row level security;
drop policy if exists venta_canales_ver on venta_canales; create policy venta_canales_ver on venta_canales for select using (es_miembro(empresa_id));
drop policy if exists venta_canales_admin on venta_canales; create policy venta_canales_admin on venta_canales for all using (es_admin(empresa_id)) with check (es_admin(empresa_id));

insert into venta_canales (empresa_id, clave, nombre, color, online, orden)
select e.id, x.c, x.n, x.col, x.o, x.ord from empresas e,
  (values ('local', 'Local', '#7c6fd6', false, 1), ('whatsapp', 'WhatsApp', '#25a366', true, 2), ('tiendanube', 'Web (Tienda Nube)', '#2c3357', true, 3), ('online', 'Otra venta online', '#8a8f98', true, 9)) x(c, n, col, o, ord)
on conflict (empresa_id, clave) do nothing;
-- las conexiones que tenga cada empresa (Mercado Libre, etc.)
insert into venta_canales (empresa_id, clave, nombre, online, orden)
select distinct c.empresa_id, c.canal, case c.canal when 'mercadolibre' then 'Mercado Libre' else initcap(c.canal) end, true, 5 from conexiones c
on conflict (empresa_id, clave) do nothing;

-- cambiar la etiqueta de una venta (también las de la web, si hace falta)
create or replace function venta_cambiar_canal(p_venta uuid, p_clave text) returns void language plpgsql security definer set search_path = public as $$
declare v ventas%rowtype;
begin
  select * into v from ventas where id = p_venta;
  if v.id is null or not es_miembro(v.empresa_id) or not (puede(v.empresa_id, 'ventas_todas') or venta_visible(v.id)) or not puede(v.empresa_id, 'vender') then raise exception 'Sin permiso'; end if;
  if not exists (select 1 from venta_canales where empresa_id = v.empresa_id and clave = p_clave) then raise exception 'Ese canal no existe'; end if;
  update ventas set origen = p_clave where id = v.id;
end $$;

select json_agg(json_build_object('clave', clave, 'nombre', nombre)) from venta_canales;
