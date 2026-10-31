-- 105 · Lo que piden y no hay (31/10/2026, Diego: "un módulo donde la vendedora pueda ir anotando lo que las clientas pidan y no
-- tenemos, así Emi lo ve para conseguir o reponer").
-- pedidos_clientas: cada pedido anotado (de una prenda del catálogo —producto y, si se sabe, talle y color— o algo que no tenemos,
-- escrito a mano), con la clienta y su teléfono para avisarle cuando llegue.
-- estado: pendiente → conseguido (llegó / ya hay) → avisada (se le escribió) · o descartado.
-- pedidos_clientas_listar(e, estado): con el stock de HOY de esa prenda (si ya hay, se avisa) y quién lo anotó.
begin;
create table if not exists pedidos_clientas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  producto_id uuid references productos(id) on delete set null,
  variante_id uuid references variantes(id) on delete set null,
  descripcion text not null,
  talle text, color text,
  cantidad int not null default 1 check (cantidad > 0),
  cliente_nombre text, telefono text, nota text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'conseguido', 'avisada', 'descartado')),
  resuelto timestamptz, resuelto_por uuid
);
create index if not exists pedidos_clientas_empresa on pedidos_clientas (empresa_id, estado, creado desc);
alter table pedidos_clientas enable row level security;
drop policy if exists pedidos_clientas_ver on pedidos_clientas;
create policy pedidos_clientas_ver on pedidos_clientas for select using (es_miembro(empresa_id) and (puede(empresa_id, 'vender') or puede(empresa_id, 'compras')));
drop policy if exists pedidos_clientas_alta on pedidos_clientas;
create policy pedidos_clientas_alta on pedidos_clientas for insert with check (es_miembro(empresa_id) and (puede(empresa_id, 'vender') or puede(empresa_id, 'compras')));
drop policy if exists pedidos_clientas_cambiar on pedidos_clientas;
create policy pedidos_clientas_cambiar on pedidos_clientas for update using (es_miembro(empresa_id) and (puede(empresa_id, 'vender') or puede(empresa_id, 'compras')));
drop policy if exists pedidos_clientas_borrar on pedidos_clientas;
create policy pedidos_clientas_borrar on pedidos_clientas for delete using (es_miembro(empresa_id) and (puede(empresa_id, 'vender') or puede(empresa_id, 'compras')));

create or replace function pedidos_clientas_listar(e uuid, p_estado text default 'abiertos') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_miembro(e) or not (puede(e, 'vender') or puede(e, 'compras')) then raise exception 'Sin permiso'; end if;
  return coalesce((select jsonb_agg(x order by x.creado desc) from (
    select p.*, pr.nombre producto_nombre, pr.codigo producto_codigo,
      (select nombre from empresa_usuarios u where u.empresa_id = e and u.user_id = p.creado_por) anoto,
      -- el stock de hoy: de esa variante si se eligió talle y color; si no, de todo el producto
      case when p.variante_id is not null then (select coalesce(sum(s.cantidad), 0) - coalesce(max(v.fallas), 0) from variantes v left join stock s on s.variante_id = v.id where v.id = p.variante_id)
           when p.producto_id is not null then (select coalesce(sum(s.cantidad), 0) from variantes v join stock s on s.variante_id = v.id where v.producto_id = p.producto_id and v.activa)
      end stock_hoy
    from pedidos_clientas p left join productos pr on pr.id = p.producto_id
    where p.empresa_id = e and (p_estado = 'todos' or (p_estado = 'abiertos' and p.estado in ('pendiente', 'conseguido')) or p.estado = p_estado)
    order by p.creado desc limit 500) x), '[]'::jsonb);
end $$;
revoke all on function pedidos_clientas_listar(uuid, text) from anon;
grant execute on function pedidos_clientas_listar(uuid, text) to authenticated;
commit;
