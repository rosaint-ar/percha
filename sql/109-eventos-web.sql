-- 109 · Eventos de la web (CyberMonday y los que vengan), 01/11/2026.
-- El descuento es una REBAJA de Percha (promociones tipo 'rebaja' + rebaja_precios, canales {tiendanube}):
-- tn-precios la manda a Tienda Nube como precio promocional y, al vencer, vuelve solo al precio de antes.
-- Acá va solo lo que muestra augustaintimates.com: textos y horario exacto (la rebaja vale por día; el reloj de la web, por hora).
-- La web lee la vista pública v_web_evento (sin costos ni nada interno).
create table if not exists web_eventos (
  id           bigserial primary key,
  empresa_id   uuid not null references empresas(id) on delete cascade,
  promocion_id uuid not null references promociones(id) on delete cascade,
  nombre       text not null,
  desde        timestamptz not null,
  hasta        timestamptz not null check (hasta > desde),
  pct          integer not null check (pct between 5 and 90),
  titulo       text, bajada text, texto_barra text, texto_popup text,
  activo       boolean not null default true,
  creado       timestamptz not null default now()
);
alter table web_eventos enable row level security;
drop policy if exists web_eventos_ver on web_eventos;
create policy web_eventos_ver on web_eventos for select using (es_miembro(empresa_id));
drop policy if exists web_eventos_admin on web_eventos;
create policy web_eventos_admin on web_eventos for all using (es_admin(empresa_id)) with check (es_admin(empresa_id));

-- Productos de Tienda Nube del evento = las variantes con precio en la rebaja, cruzadas con la web.
create or replace view v_web_evento as
select e.id, e.nombre, e.desde, e.hasta, e.titulo, e.bajada, e.texto_barra, e.texto_popup, e.pct as max_pct,
  coalesce((select jsonb_agg(x.j) from (select distinct jsonb_build_object('product_id', ci.producto_ext::bigint) j
     from rebaja_precios rp join canal_items ci on ci.variante_id = rp.variante_id
     join conexiones c on c.id = ci.conexion_id and c.canal = 'tiendanube'
     where rp.promocion_id = e.promocion_id) x), '[]'::jsonb) as items
from web_eventos e join promociones p on p.id = e.promocion_id and p.activa
where e.activo and e.hasta > now() and e.desde < now() + interval '7 days';
grant select on v_web_evento to anon, authenticated;
