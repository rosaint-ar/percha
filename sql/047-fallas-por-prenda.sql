-- 047 · Fallas por prenda: cada prenda fallada es una unidad con su propia nota, su descuento y a qué listas se aplica.
--   · variante_fallas = una fila por prenda con falla. variantes.fallas queda como el total (lo mantiene un disparador),
--     así todo lo que ya lo usa (caja, web, recuentos) sigue igual.
--   · Si algo viejo cambia variantes.fallas directo (recuento, ajuste), el disparador "guardia" crea o cierra unidades.
--   · Al vender, la caja dice cuál de las fallas se lleva (falla_id) y se aplica su descuento.
--   · ventana_prenda(variante) arma en un solo pedido todo lo que muestra la ventana de una prenda.

create table if not exists variante_fallas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  variante_id uuid not null references variantes(id) on delete cascade,
  nota text,                                    -- "hilo suelto en el bretel"
  descuento_pct numeric check (descuento_pct is null or (descuento_pct >= 0 and descuento_pct <= 100)),
  listas uuid[],                                -- null = todas las listas
  estado text not null default 'disponible' check (estado in ('disponible','vendida','arreglada','sin_stock')),
  creado timestamptz not null default now(), creado_por uuid default auth.uid(),
  venta_id uuid references ventas(id) on delete set null,
  linea_id bigint references venta_lineas(id) on delete set null,
  cerrada timestamptz, cerrada_nota text
);
create index if not exists variante_fallas_var on variante_fallas (variante_id) where estado = 'disponible';
create index if not exists variante_fallas_emp on variante_fallas (empresa_id, estado);
alter table variante_fallas enable row level security;
drop policy if exists variante_fallas_ver on variante_fallas; create policy variante_fallas_ver on variante_fallas for select using (es_miembro(empresa_id));

-- unidades → total en variantes (marca de sincronía para que la guardia no se dispare)
create or replace function fallas_sincronizar() returns trigger
language plpgsql security definer set search_path = public as $$
declare vid uuid := coalesce(new.variante_id, old.variante_id);
begin
  perform set_config('percha.sync_fallas', '1', true);
  update variantes set fallas = (select count(*) from variante_fallas where variante_id = vid and estado = 'disponible'),
                       falla_nota = (select string_agg(nota, ' · ' order by creado) from variante_fallas where variante_id = vid and estado = 'disponible' and nullif(nota, '') is not null)
  where id = vid;
  perform set_config('percha.sync_fallas', '', true);
  return null;
end $$;
drop trigger if exists variante_fallas_sync on variante_fallas;
create trigger variante_fallas_sync after insert or update or delete on variante_fallas for each row execute function fallas_sincronizar();

-- total cambiado por fuera (funciones viejas) → unidades
create or replace function fallas_guardia() returns trigger
language plpgsql security definer set search_path = public as $$
declare d int;
begin
  if coalesce(current_setting('percha.sync_fallas', true), '') = '1' then return null; end if;
  d := round(coalesce(new.fallas, 0))::int - (select count(*) from variante_fallas where variante_id = new.id and estado = 'disponible')::int;
  if d > 0 then
    insert into variante_fallas (empresa_id, variante_id, nota) select new.empresa_id, new.id, new.falla_nota from generate_series(1, d);
  elsif d < 0 then
    update variante_fallas set estado = 'sin_stock', cerrada = now(), cerrada_nota = 'El stock bajó'
    where id in (select id from variante_fallas where variante_id = new.id and estado = 'disponible' order by creado desc limit -d);
  end if;
  return null;
end $$;
drop trigger if exists variantes_fallas_guardia on variantes;
create trigger variantes_fallas_guardia after update of fallas on variantes for each row when (new.fallas is distinct from old.fallas) execute function fallas_guardia();

-- lo que ya estaba marcado pasa a unidades (con la nota que tenía)
insert into variante_fallas (empresa_id, variante_id, nota)
select v.empresa_id, v.id, v.falla_nota from variantes v cross join lateral generate_series(1, round(v.fallas)::int) g
where v.fallas > 0 and not exists (select 1 from variante_fallas f where f.variante_id = v.id);

-- vender prendas con falla: primero la elegida en la caja, después las más viejas
create or replace function fallas_vender(p_variante uuid, p_cant numeric, p_falla uuid, p_venta uuid, p_linea bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update variante_fallas set estado = 'vendida', venta_id = p_venta, linea_id = p_linea, cerrada = now()
  where id in (select id from variante_fallas where variante_id = p_variante and estado = 'disponible'
               order by (id = p_falla) desc nulls last, creado limit greatest(round(p_cant), 0)::int);
end $$;

-- guardar las fallas de una prenda desde la ventana. p = {variante_id, unidades:[{id?, nota, descuento_pct, listas}], cerrar:[{id, estado:'arreglada'|'sin_stock'}]}
create or replace function fallas_guardar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v variantes%rowtype; u jsonb; st numeric; n int; adm boolean;
begin
  select * into v from variantes where id = (p->>'variante_id')::uuid;
  if v.id is null or not es_miembro(v.empresa_id) or rol_en(v.empresa_id) = 'visor' then raise exception 'Sin permiso'; end if;
  adm := es_admin(v.empresa_id);
  for u in select * from jsonb_array_elements(coalesce(p->'cerrar', '[]'::jsonb)) loop
    update variante_fallas set estado = coalesce(u->>'estado', 'arreglada'), cerrada = now(), cerrada_nota = nullif(u->>'nota', '')
    where id = (u->>'id')::uuid and variante_id = v.id and estado = 'disponible';
  end loop;
  for u in select * from jsonb_array_elements(coalesce(p->'unidades', '[]'::jsonb)) loop
    if nullif(u->>'id', '') is null then
      insert into variante_fallas (empresa_id, variante_id, nota, descuento_pct, listas)
      values (v.empresa_id, v.id, nullif(btrim(u->>'nota'), ''), case when adm then nullif(u->>'descuento_pct', '')::numeric end,
              case when adm and jsonb_typeof(u->'listas') = 'array' and jsonb_array_length(u->'listas') > 0 then array(select jsonb_array_elements_text(u->'listas')::uuid) end);
    else
      update variante_fallas set nota = nullif(btrim(u->>'nota'), ''),
        descuento_pct = case when adm then nullif(u->>'descuento_pct', '')::numeric else descuento_pct end,
        listas = case when adm then (case when jsonb_typeof(u->'listas') = 'array' and jsonb_array_length(u->'listas') > 0 then array(select jsonb_array_elements_text(u->'listas')::uuid) end) else listas end
      where id = (u->>'id')::uuid and variante_id = v.id and estado = 'disponible';
    end if;
  end loop;
  select coalesce(sum(cantidad), 0) into st from stock where variante_id = v.id;
  select count(*) into n from variante_fallas where variante_id = v.id and estado = 'disponible';
  if n > greatest(st, 0) then raise exception 'Hay % con falla y el stock es %: no puede haber más con falla que stock', n, greatest(st, 0)::int; end if;
  return jsonb_build_object('fallas', n, 'stock', st);
end $$;

-- todo lo que muestra la ventana de una prenda, en un solo pedido
create or replace function ventana_prenda(p_variante uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not es_miembro(v.empresa_id) then null else jsonb_build_object(
    'variante', to_jsonb(vv) - 'costo',
    'costo', case when es_admin(v.empresa_id) then vv.costo end,
    'producto', jsonb_build_object('id', p.id, 'nombre', p.nombre, 'codigo', p.codigo, 'precio', p.precio, 'imagen_url', p.imagen_url, 'tiene_variantes', p.tiene_variantes),
    'por_deposito', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'nombre', d.nombre, 'principal', d.principal, 'cantidad', coalesce((select sum(s.cantidad) from stock s where s.variante_id = v.id and s.deposito_id = d.id), 0)) order by d.principal desc, d.nombre), '[]'::jsonb)
                     from depositos d where d.empresa_id = v.empresa_id and d.activo),
    'fallas', (select coalesce(jsonb_agg(to_jsonb(f) order by f.creado), '[]'::jsonb) from variante_fallas f where f.variante_id = v.id and f.estado = 'disponible'),
    'revisar', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'motivo', r.motivo, 'detalle', r.detalle, 'creado', r.creado) order by r.creado), '[]'::jsonb) from stock_revisar r where r.variante_id = v.id and r.resuelto is null),
    'movimientos', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select m.fecha, m.tipo, m.motivo, m.cantidad, m.nota, m.usuario, m.venta_numero, m.recuento_nombre from v_movimientos m where m.variante_id = v.id order by m.fecha desc limit 6) x)
  ) end
  from variantes v join productos p on p.id = v.producto_id join v_variantes vv on vv.id = v.id where v.id = p_variante;
$$;

-- avisos de "stock a revisar" que se dan por vistos desde la ventana (después de corregir lo que haga falta)
create or replace function stock_revisar_visto(p_variante uuid, p_nota text default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not exists (select 1 from variantes where id = p_variante and es_miembro(empresa_id) and rol_en(empresa_id) <> 'visor') then raise exception 'Sin permiso'; end if;
  update stock_revisar set resuelto = now(), resuelto_por = auth.uid(), resolucion = coalesce(nullif(p_nota, ''), 'Revisado') where variante_id = p_variante and resuelto is null;
  get diagnostics n = row_count; return n;
end $$;

-- lista de prendas con falla (para Inventario › Con falla)
create or replace view v_fallas with (security_invoker = true) as
select f.*, v.producto_id, v.producto_codigo, v.producto_nombre, v.talle_nombre, v.color_nombre, v.color_hex, v.precio, v.stock, v.foto, v.sku
from variante_fallas f join v_variantes v on v.id = f.variante_id;

-- ===== funciones de venta adaptadas (generado desde la versión en la base) =====
CREATE OR REPLACE FUNCTION public.venta_linea_mover_stock(e uuid, v_id uuid, v_num bigint, v_lin bigint, dep uuid, l jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare tipo_prod text; c jsonb; comp record; v_comp uuid; cant numeric := (l->>'cantidad')::numeric; mov_tipo text; vid uuid; es_falla boolean; antes numeric; f numeric; sin_control boolean;
begin
  mov_tipo := case when cant < 0 then 'devolucion' else 'venta' end;
  select tipo into tipo_prod from productos where id = (l->>'producto_id')::uuid;
  if tipo_prod = 'kit' then
    if jsonb_typeof(l->'componentes') = 'array' and jsonb_array_length(l->'componentes') > 0 then
      for c in select * from jsonb_array_elements(l->'componentes') loop
        insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id, linea_id)
        values (e, (c->>'variante_id')::uuid, dep, -(sign(cant) * (c->>'cantidad')::numeric), mov_tipo, v_id::text, coalesce('Venta #' || v_num, 'Venta') || ' · kit ' || (l->>'descripcion'), auth.uid(), v_lin);
      end loop;
    else
      for comp in select variante_id, componente_producto_id, filtro, cantidad from producto_componentes where producto_id = (l->>'producto_id')::uuid loop
        v_comp := coalesce(comp.variante_id,
                           case when comp.componente_producto_id is not null then variante_indefinida(comp.componente_producto_id) end,
                           case when comp.filtro->>'defecto_producto_id' is not null then variante_indefinida((comp.filtro->>'defecto_producto_id')::uuid) end);
        if v_comp is not null then
          insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id, linea_id)
          values (e, v_comp, dep, -(cant * comp.cantidad), mov_tipo, v_id::text, coalesce('Venta #' || v_num, 'Venta') || ' · kit ' || (l->>'descripcion') || case when comp.variante_id is null then ' (sin definir)' else '' end, auth.uid(), v_lin);
        end if;
      end loop;
    end if;
  elsif l->>'variante_id' is not null then
    vid := (l->>'variante_id')::uuid; es_falla := coalesce((l->>'falla')::boolean, false);
    select coalesce(sum(cantidad), 0) into antes from stock where variante_id = vid;
    select v.fallas, p.es_generico or coalesce(v.sku, '') like '%-SD' into f, sin_control from variantes v join productos p on p.id = v.producto_id where v.id = vid;
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id, linea_id)
    values (e, vid, dep, -cant, mov_tipo, v_id::text, coalesce('Venta #' || v_num, 'Venta') || case when es_falla then ' · con falla' else '' end, auth.uid(), v_lin);
    if es_falla then
      update venta_lineas set falla = true where id = v_lin;
      perform fallas_vender(vid, cant, nullif(l->>'falla_id', '')::uuid, v_id, v_lin);
    elsif cant > 0 and not sin_control then
      -- se vendió más de lo que había: queda el recordatorio para corregir el stock
      if antes < cant then
        insert into stock_revisar (empresa_id, variante_id, venta_id, linea_id, motivo, detalle)
        values (e, vid, v_id, v_lin, 'sin_stock', coalesce('Venta #' || v_num, 'Venta') || ': se vendieron ' || cant::int || ' y el sistema tenía ' || antes::int);
      elsif f > 0 and antes - f < cant then
        insert into stock_revisar (empresa_id, variante_id, venta_id, linea_id, motivo, detalle)
        values (e, vid, v_id, v_lin, 'falla', coalesce('Venta #' || v_num, 'Venta') || ': se vendió sin marcar la falla y solo quedaban las que tienen falla');
      end if;
      -- nunca puede haber más con falla que stock
      update variantes set fallas = greatest(antes - cant, 0) where id = vid and fallas > greatest(antes - cant, 0);
    end if;
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.caja_anular_venta(p_venta uuid, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v ventas%rowtype; m record;
begin
  select * into v from ventas where id = p_venta for update;
  if v.id is null or not es_miembro(v.empresa_id) then raise exception 'Venta inexistente'; end if;
  if not es_admin(v.empresa_id) and v.creado_por <> auth.uid() then raise exception 'Solo administración puede anular ventas de otra persona'; end if;
  if v.estado = 'anulada' then raise exception 'Ya estaba anulada'; end if;
  for m in select * from stock_movimientos where referencia = v.id::text and tipo in ('venta','devolucion') loop
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
    values (v.empresa_id, m.variante_id, m.deposito_id, -m.cantidad, 'ajuste', v.id::text, 'Anulación venta #' || v.numero, auth.uid());
  end loop;
  -- ventas viejas (sin unidad de falla registrada): se suma al total; las nuevas: la misma prenda vuelve a estar disponible
  update variantes x set fallas = x.fallas + l.cantidad from venta_lineas l where l.venta_id = v.id and l.falla and l.variante_id = x.id
    and not exists (select 1 from variante_fallas f where f.linea_id = l.id);
  update variante_fallas set estado = 'disponible', venta_id = null, linea_id = null, cerrada = null where venta_id = v.id and estado = 'vendida';
  update creditos c set saldo = c.saldo + vp.monto, estado = 'vigente' from venta_pagos vp where vp.venta_id = v.id and vp.credito_id = c.id;
  update creditos set estado = 'anulado' where origen_venta_id = v.id and saldo = monto;
  update ventas set estado = 'anulada', anulada_por = auth.uid(), anulada_fecha = now(), anulada_motivo = p_motivo where id = v.id;
end $function$
;

CREATE OR REPLACE FUNCTION public.reservada_anular(e uuid, p_pin text, p_venta uuid, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v ventas%rowtype; m record;
begin
  if not reservado_pin_ok(e, p_pin) then raise exception 'Clave incorrecta'; end if;
  select * into v from ventas where id = p_venta and empresa_id = e and reservada for update;
  if v.id is null then raise exception 'Venta inexistente'; end if;
  if v.estado = 'anulada' then raise exception 'Ya estaba anulada'; end if;
  for m in select * from stock_movimientos where referencia = v.id::text and tipo in ('venta','devolucion') loop
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
    values (v.empresa_id, m.variante_id, m.deposito_id, -m.cantidad, 'ajuste', v.id::text, 'Anulación de venta', auth.uid());
  end loop;
  -- ventas viejas (sin unidad de falla registrada): se suma al total; las nuevas: la misma prenda vuelve a estar disponible
  update variantes x set fallas = x.fallas + l.cantidad from venta_lineas l where l.venta_id = v.id and l.falla and l.variante_id = x.id
    and not exists (select 1 from variante_fallas f where f.linea_id = l.id);
  update variante_fallas set estado = 'disponible', venta_id = null, linea_id = null, cerrada = null where venta_id = v.id and estado = 'vendida';
  update ventas set estado = 'anulada', anulada_por = auth.uid(), anulada_fecha = now(), anulada_motivo = p_motivo where id = v.id;
end $function$
;

select jsonb_build_object('unidades', (select count(*) from variante_fallas where estado = 'disponible'), 'total_variantes', (select sum(fallas) from variantes), 'notas', (select jsonb_agg(nota) from variante_fallas where nota is not null)) r;
