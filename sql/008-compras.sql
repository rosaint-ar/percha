-- Percha · fase 4: compras, recepción de mercadería, curvas de talle y cuenta corriente de proveedores

-- ---------- Curvas de talle: cómo se reparte una compra entre talles ----------
create table if not exists curvas (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  reparto     jsonb not null default '[]'::jsonb,   -- [{talle_id, cantidad}]
  activa      boolean not null default true,
  unique (empresa_id, nombre)
);
alter table curvas enable row level security;
drop policy if exists curvas_ver on curvas; create policy curvas_ver on curvas for select using (es_miembro(empresa_id));
drop policy if exists curvas_admin on curvas; create policy curvas_admin on curvas for all using (es_admin(empresa_id)) with check (es_admin(empresa_id));

-- ---------- Órdenes de compra ----------
create table if not exists compras (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  numero        bigint not null,
  proveedor_id  uuid references proveedores(id),
  deposito_id   uuid references depositos(id),
  estado        text not null default 'borrador' check (estado in ('borrador','pedida','parcial','recibida','anulada')),
  fecha         date not null default current_date,
  entrega_estimada date,
  referencia    text,                               -- nº de factura o remito del proveedor
  subtotal      numeric(14,2) not null default 0,
  descuento_pct numeric(7,3) not null default 0,
  total         numeric(14,2) not null default 0,
  nota          text,
  creado_por    uuid default auth.uid(),
  creado        timestamptz not null default now(),
  modificado    timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists compras_empresa_fecha on compras (empresa_id, fecha desc);

create table if not exists compra_lineas (
  id            bigserial primary key,
  compra_id     uuid not null references compras(id) on delete cascade,
  empresa_id    uuid not null references empresas(id) on delete cascade,
  variante_id   uuid references variantes(id),
  producto_id   uuid references productos(id),
  descripcion   text not null,
  talle         text, color text,
  pedida        numeric(12,3) not null default 0,
  recibida      numeric(12,3) not null default 0,
  costo_unit    numeric(14,2) not null default 0,
  total         numeric(14,2) not null default 0
);
create index if not exists compra_lineas_compra on compra_lineas (compra_id);

-- Cada recepción (puede haber varias por orden)
create table if not exists compra_recepciones (
  id          bigserial primary key,
  compra_id   uuid not null references compras(id) on delete cascade,
  empresa_id  uuid not null references empresas(id) on delete cascade,
  fecha       timestamptz not null default now(),
  detalle     jsonb not null,                        -- [{linea_id, cantidad}]
  nota        text,
  user_id     uuid default auth.uid()
);

-- ---------- Cuenta corriente de proveedores ----------
create table if not exists proveedor_movimientos (
  id            bigserial primary key,
  empresa_id    uuid not null references empresas(id) on delete cascade,
  proveedor_id  uuid not null references proveedores(id),
  tipo          text not null check (tipo in ('compra','pago','nota_credito','ajuste')),
  monto         numeric(14,2) not null,              -- positivo = debemos más; negativo = pagamos / nos descuentan
  fecha         date not null default current_date,
  compra_id     uuid references compras(id),
  forma_pago_id uuid references formas_pago(id),
  referencia    text,
  nota          text,
  user_id       uuid default auth.uid(),
  creado        timestamptz not null default now()
);
create index if not exists provmov_proveedor on proveedor_movimientos (proveedor_id, fecha desc);

-- RLS
do $$
declare t text;
begin
  foreach t in array array['compras','compra_lineas','compra_recepciones','proveedor_movimientos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_ver on %I', t, t);
    execute format('create policy %I_ver on %I for select using (es_miembro(empresa_id))', t, t);
    execute format('drop policy if exists %I_admin on %I', t, t);
    execute format('create policy %I_admin on %I for all using (es_admin(empresa_id)) with check (es_admin(empresa_id))', t, t);
  end loop;
end $$;

drop trigger if exists trg_compras_modificado on compras;
create trigger trg_compras_modificado before update on compras for each row execute function set_modificado();

-- ---------- Guardar una orden completa (cabecera + líneas) ----------
-- p = { id?, empresa_id, proveedor_id, deposito_id, fecha, entrega_estimada, referencia, descuento_pct, nota, estado,
--       lineas: [{variante_id, producto_id, descripcion, talle, color, pedida, costo_unit}] }
create or replace function compras_guardar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e uuid := (p->>'empresa_id')::uuid; c_id uuid := (p->>'id')::uuid; l jsonb; sub numeric := 0; tot numeric; num bigint; est text;
begin
  if not es_admin(e) then raise exception 'Solo administración carga compras'; end if;
  for l in select * from jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) loop
    sub := sub + round((l->>'pedida')::numeric * (l->>'costo_unit')::numeric, 2);
  end loop;
  tot := round(sub * (1 - coalesce((p->>'descuento_pct')::numeric, 0) / 100), 2);
  if c_id is null then
    num := proximo_numero(e, 'compra');
    insert into compras (empresa_id, numero, proveedor_id, deposito_id, estado, fecha, entrega_estimada, referencia, subtotal, descuento_pct, total, nota)
    values (e, num, (p->>'proveedor_id')::uuid, (p->>'deposito_id')::uuid, coalesce(p->>'estado', 'borrador'), coalesce((p->>'fecha')::date, current_date), (p->>'entrega_estimada')::date, p->>'referencia', sub, coalesce((p->>'descuento_pct')::numeric, 0), tot, p->>'nota')
    returning id into c_id;
  else
    select estado into est from compras where id = c_id and empresa_id = e;
    if est is null then raise exception 'Compra inexistente'; end if;
    if est in ('recibida', 'anulada') then raise exception 'Esta compra ya está cerrada'; end if;
    update compras set proveedor_id = (p->>'proveedor_id')::uuid, deposito_id = (p->>'deposito_id')::uuid, estado = coalesce(p->>'estado', estado), fecha = coalesce((p->>'fecha')::date, fecha), entrega_estimada = (p->>'entrega_estimada')::date, referencia = p->>'referencia', subtotal = sub, descuento_pct = coalesce((p->>'descuento_pct')::numeric, 0), total = tot, nota = p->>'nota' where id = c_id;
    -- las líneas se reemplazan, conservando lo ya recibido por variante
    delete from compra_lineas where compra_id = c_id and recibida = 0;
  end if;
  for l in select * from jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) loop
    if exists (select 1 from compra_lineas where compra_id = c_id and variante_id = (l->>'variante_id')::uuid and recibida > 0) then
      update compra_lineas set pedida = greatest((l->>'pedida')::numeric, recibida), costo_unit = (l->>'costo_unit')::numeric, total = round(greatest((l->>'pedida')::numeric, recibida) * (l->>'costo_unit')::numeric, 2)
      where compra_id = c_id and variante_id = (l->>'variante_id')::uuid;
    else
      insert into compra_lineas (compra_id, empresa_id, variante_id, producto_id, descripcion, talle, color, pedida, costo_unit, total)
      values (c_id, e, (l->>'variante_id')::uuid, (l->>'producto_id')::uuid, l->>'descripcion', l->>'talle', l->>'color', (l->>'pedida')::numeric, (l->>'costo_unit')::numeric, round((l->>'pedida')::numeric * (l->>'costo_unit')::numeric, 2));
    end if;
  end loop;
  return jsonb_build_object('id', c_id, 'numero', (select numero from compras where id = c_id), 'total', tot);
end $$;

-- ---------- Recibir mercadería ----------
-- p = { empresa_id, compra_id, nota, lineas: [{linea_id, cantidad}], actualizar_costos: true, asentar_deuda: true }
create or replace function compras_recibir(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e uuid := (p->>'empresa_id')::uuid; c compras%rowtype; l jsonb; ln compra_lineas%rowtype; dep uuid; recibido_total numeric := 0; monto_recibido numeric := 0; pend numeric;
begin
  if not es_admin(e) then raise exception 'Solo administración recibe mercadería'; end if;
  select * into c from compras where id = (p->>'compra_id')::uuid and empresa_id = e for update;
  if c.id is null then raise exception 'Compra inexistente'; end if;
  if c.estado in ('recibida', 'anulada') then raise exception 'Esta compra ya está cerrada'; end if;
  dep := coalesce(c.deposito_id, (select id from depositos where empresa_id = e and principal limit 1));
  for l in select * from jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) loop
    if coalesce((l->>'cantidad')::numeric, 0) <= 0 then continue; end if;
    select * into ln from compra_lineas where id = (l->>'linea_id')::bigint and compra_id = c.id for update;
    if ln.id is null then raise exception 'Línea inexistente'; end if;
    update compra_lineas set recibida = recibida + (l->>'cantidad')::numeric where id = ln.id;
    if ln.variante_id is not null then
      insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
      values (e, ln.variante_id, dep, (l->>'cantidad')::numeric, 'compra', c.id::text, 'Compra #' || c.numero, auth.uid());
      if coalesce((p->>'actualizar_costos')::boolean, true) then
        update productos set costo = ln.costo_unit where id = ln.producto_id and ln.costo_unit > 0;
        update variantes set costo = null where id = ln.variante_id;   -- la variante vuelve a tomar el costo del producto
      end if;
    end if;
    recibido_total := recibido_total + (l->>'cantidad')::numeric;
    monto_recibido := monto_recibido + round((l->>'cantidad')::numeric * ln.costo_unit, 2);
  end loop;
  if recibido_total = 0 then raise exception 'No se indicó ninguna cantidad'; end if;
  insert into compra_recepciones (compra_id, empresa_id, detalle, nota) values (c.id, e, p->'lineas', p->>'nota');
  select coalesce(sum(pedida - recibida), 0) into pend from compra_lineas where compra_id = c.id;
  update compras set estado = case when pend <= 0 then 'recibida' else 'parcial' end where id = c.id;
  -- la deuda con el proveedor crece con lo efectivamente recibido (con el descuento de la orden)
  if coalesce((p->>'asentar_deuda')::boolean, true) and c.proveedor_id is not null then
    insert into proveedor_movimientos (empresa_id, proveedor_id, tipo, monto, compra_id, referencia, nota)
    values (e, c.proveedor_id, 'compra', round(monto_recibido * (1 - c.descuento_pct / 100), 2), c.id, c.referencia, 'Recepción compra #' || c.numero);
  end if;
  return jsonb_build_object('recibido', recibido_total, 'estado', case when pend <= 0 then 'recibida' else 'parcial' end);
end $$;

-- ---------- Anular una orden (solo si no recibió nada) ----------
create or replace function compras_anular(p_compra uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c compras%rowtype;
begin
  select * into c from compras where id = p_compra for update;
  if c.id is null or not es_admin(c.empresa_id) then raise exception 'Sin permiso'; end if;
  if exists (select 1 from compra_lineas where compra_id = c.id and recibida > 0) then raise exception 'Ya se recibió mercadería de esta compra: no se puede anular'; end if;
  update compras set estado = 'anulada' where id = c.id;
end $$;

-- ---------- Vistas ----------
create or replace view v_compras with (security_invoker = true) as
select c.*, pr.nombre as proveedor,
       (select count(*) from compra_lineas l where l.compra_id = c.id) as lineas,
       (select coalesce(sum(pedida), 0) from compra_lineas l where l.compra_id = c.id) as unidades,
       (select coalesce(sum(recibida), 0) from compra_lineas l where l.compra_id = c.id) as unidades_recibidas
from compras c left join proveedores pr on pr.id = c.proveedor_id;

create or replace view v_proveedores with (security_invoker = true) as
select p.*, coalesce((select sum(monto) from proveedor_movimientos m where m.proveedor_id = p.id), 0) as saldo,
       (select max(fecha) from compras c where c.proveedor_id = p.id and c.estado <> 'anulada') as ultima_compra
from proveedores p;
