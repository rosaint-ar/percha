-- 061 · Facturación electrónica ARCA (27/10/2026)
--   · facturacion_config: CUIT, punto de venta (tipo "Web Services"), ambiente, certificado (público) por empresa.
--     La clave privada del certificado se guarda CIFRADA en Supabase Vault; solo la lee el servidor (edge "arca").
--   · comprobantes: cada factura / nota de crédito con su número, CAE y vencimiento. La venta nunca se traba:
--     el pedido queda "pendiente" y el servidor lo manda a ARCA (si ARCA no responde, reintenta solo).
--   · Anular una venta facturada genera sola la nota de crédito; una venta facturada no cambia de total.
--   · Monotributo → Factura C (11) / Nota de crédito C (13). Responsable inscripto → A (1/3) o B (6/8) según la clienta.

create table if not exists facturacion_config (
  empresa_id      uuid primary key references empresas(id) on delete cascade,
  cuit            text,
  punto_venta     int,
  ambiente        text not null default 'produccion' check (ambiente in ('homologacion', 'produccion')),
  csr_pem         text,
  csr_creado      timestamptz,
  cert_pem        text,
  cert_vence      timestamptz,
  key_secret_id   uuid,                    -- vault.secrets (clave privada)
  estado          text not null default 'sin_configurar' check (estado in ('sin_configurar', 'csr_listo', 'listo', 'error')),
  ultimo_error    text,
  ultima_prueba   timestamptz,
  ultimo_numero   int,
  umbral_identificar numeric(14,2) not null default 10000000,   -- desde este total ARCA pide DNI/CUIT al consumidor final
  procesando_hasta timestamptz,
  actualizado     timestamptz not null default now()
);
alter table facturacion_config enable row level security;
drop policy if exists facturacion_config_ver on facturacion_config;
create policy facturacion_config_ver on facturacion_config for select using (es_miembro(empresa_id));

-- tickets de acceso de ARCA (duran 12 h; pedir otro antes de que venza da error): solo el servidor
create table if not exists arca_tokens (
  empresa_id uuid not null references empresas(id) on delete cascade,
  ambiente   text not null,
  servicio   text not null default 'wsfe',
  token      text not null,
  sign       text not null,
  expira     timestamptz not null,
  primary key (empresa_id, ambiente, servicio)
);
alter table arca_tokens enable row level security;

create table if not exists comprobantes (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references empresas(id) on delete cascade,
  venta_id        uuid references ventas(id) on delete set null,
  tipo            int not null,            -- 11 Factura C · 13 NC C · 12 ND C · 6/8 B · 1/3 A
  punto_venta     int not null,
  numero          int,
  numero_intento  int,                     -- el número que se pidió (para recuperar el CAE si ARCA no contestó)
  fecha           date,
  total           numeric(14,2) not null,
  neto            numeric(14,2) not null default 0,
  iva             numeric(14,2) not null default 0,
  doc_tipo        int not null default 99, -- 99 sin identificar · 96 DNI · 80 CUIT · 86 CUIL
  doc_nro         text not null default '0',
  receptor_nombre text,
  receptor_condicion int not null default 5,   -- 5 consumidor final · 1 resp. inscripto · 6 monotributo · 4 exento
  receptor_domicilio text,
  asociado_id     uuid references comprobantes(id),
  estado          text not null default 'pendiente' check (estado in ('pendiente', 'autorizado', 'rechazado', 'cancelado')),
  cae             text,
  cae_vence       date,
  errores         text,
  observaciones   text,
  intentos        int not null default 0,
  respuesta       text,
  creado_por      uuid default auth.uid(),
  creado          timestamptz not null default now(),
  autorizado      timestamptz
);
create unique index if not exists comprobantes_numero on comprobantes (empresa_id, tipo, punto_venta, numero) where numero is not null;
create unique index if not exists comprobantes_una_factura on comprobantes (venta_id) where tipo in (1, 6, 11) and estado in ('pendiente', 'autorizado');
create unique index if not exists comprobantes_una_nc on comprobantes (asociado_id) where asociado_id is not null and estado in ('pendiente', 'autorizado');
create index if not exists comprobantes_pend on comprobantes (empresa_id) where estado = 'pendiente';
alter table comprobantes enable row level security;
drop policy if exists comprobantes_ver on comprobantes;
create policy comprobantes_ver on comprobantes for select using (es_miembro(empresa_id) and (venta_id is null or not venta_es_reservada(venta_id)));

create or replace function comprobante_letra(t int) returns text language sql immutable as $$
  select case when t in (1, 2, 3) then 'A' when t in (6, 7, 8) then 'B' when t in (11, 12, 13) then 'C' end $$;
create or replace function comprobante_nombre(t int) returns text language sql immutable as $$
  select case when t in (1, 6, 11) then 'Factura' when t in (3, 8, 13) then 'Nota de crédito' when t in (2, 7, 12) then 'Nota de débito' end || ' ' || comprobante_letra(t) $$;

create or replace view v_comprobantes with (security_invoker = true) as
select c.*, comprobante_letra(c.tipo) letra, comprobante_nombre(c.tipo) nombre_tipo,
       case when c.numero is not null then lpad(c.punto_venta::text, 5, '0') || '-' || lpad(c.numero::text, 8, '0') end numero_mostrar,
       v.numero venta_numero, v.fecha venta_fecha, v.estado venta_estado,
       a.tipo asociado_tipo, a.numero asociado_numero, a.punto_venta asociado_pv, a.fecha asociado_fecha
from comprobantes c left join ventas v on v.id = c.venta_id left join comprobantes a on a.id = c.asociado_id;

-- ---------- configuración (administración) ----------
create or replace function facturacion_config_guardar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e uuid := (p->>'empresa_id')::uuid; cu text;
begin
  if not es_admin(e) then raise exception 'Solo administración'; end if;
  cu := nullif(regexp_replace(coalesce(p->>'cuit', ''), '\D', '', 'g'), '');
  if cu is not null and length(cu) <> 11 then raise exception 'El CUIT tiene que tener 11 números'; end if;
  insert into facturacion_config (empresa_id) values (e) on conflict (empresa_id) do nothing;
  update facturacion_config set
    cuit = coalesce(cu, cuit),
    punto_venta = case when p ? 'punto_venta' then nullif(p->>'punto_venta', '')::int else punto_venta end,
    ambiente = coalesce(nullif(p->>'ambiente', ''), ambiente),
    umbral_identificar = coalesce(nullif(p->>'umbral_identificar', '')::numeric, umbral_identificar),
    actualizado = now()
  where empresa_id = e;
  -- datos que van impresos en la factura
  update empresas set
    razon_social = coalesce(nullif(p->>'razon_social', ''), razon_social),
    iibb = case when p ? 'iibb' then nullif(p->>'iibb', '') else iibb end,
    inicio_actividades = case when p ? 'inicio_actividades' then nullif(p->>'inicio_actividades', '')::date else inicio_actividades end,
    condicion_iva = coalesce(nullif(p->>'condicion_iva', ''), condicion_iva),
    cuit = coalesce(case when cu is not null then substr(cu, 1, 2) || '-' || substr(cu, 3, 8) || '-' || substr(cu, 11, 1) end, cuit)
  where id = e;
  return (select to_jsonb(f) - 'key_secret_id' from facturacion_config f where empresa_id = e);
end $$;

-- clave privada en Vault: solo el servidor
create or replace function arca_clave_guardar(e uuid, pem text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  if not es_servicio() then raise exception 'Solo el servidor'; end if;
  insert into facturacion_config (empresa_id) values (e) on conflict (empresa_id) do nothing;
  select key_secret_id into sid from facturacion_config where empresa_id = e;
  if sid is not null and exists (select 1 from vault.secrets where id = sid) then perform vault.update_secret(sid, pem);
  else sid := vault.create_secret(pem, 'arca_clave_' || e::text || '_' || extract(epoch from now())::bigint, 'Clave privada del certificado ARCA'); end if;
  update facturacion_config set key_secret_id = sid, actualizado = now() where empresa_id = e;
end $$;
create or replace function arca_clave(e uuid) returns text
language plpgsql security definer set search_path = public, vault as $$
begin
  if not es_servicio() then raise exception 'Solo el servidor'; end if;
  return (select s.decrypted_secret from vault.decrypted_secrets s join facturacion_config f on f.key_secret_id = s.id where f.empresa_id = e);
end $$;
revoke execute on function arca_clave(uuid) from public, anon, authenticated;
revoke execute on function arca_clave_guardar(uuid, text) from public, anon, authenticated;

-- turno para mandar a ARCA (uno a la vez por empresa: la numeración es correlativa)
create or replace function arca_tomar_turno(e uuid, segundos int default 90) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not es_servicio() then raise exception 'Solo el servidor'; end if;
  update facturacion_config set procesando_hasta = now() + make_interval(secs => segundos)
  where empresa_id = e and (procesando_hasta is null or procesando_hasta < now());
  return found;
end $$;
create or replace function arca_soltar_turno(e uuid) returns void
language sql security definer set search_path = public as $$ update facturacion_config set procesando_hasta = null where empresa_id = e and es_servicio() $$;

-- ---------- pedir la factura de una venta ----------
create or replace function factura_pedir(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v ventas%rowtype; cfg facturacion_config%rowtype; emp empresas%rowtype; t int; dt int; dn text; cond int; nuevo uuid;
begin
  select * into v from ventas where id = (p->>'venta_id')::uuid;
  if v.id is null or not es_miembro(v.empresa_id) or rol_en(v.empresa_id) = 'visor' then raise exception 'Sin permiso'; end if;
  if v.reservada then raise exception 'Las ventas reservadas no se facturan desde acá'; end if;
  if v.estado <> 'completada' then raise exception 'Solo se facturan ventas completadas (esta está %)', v.estado; end if;
  if coalesce(v.total, 0) <= 0 then raise exception 'La venta no tiene importe para facturar'; end if;
  select * into cfg from facturacion_config where empresa_id = v.empresa_id;
  if cfg.estado is distinct from 'listo' or cfg.punto_venta is null then raise exception 'La facturación todavía no está configurada (Configuración › Facturación)'; end if;
  if exists (select 1 from comprobantes where venta_id = v.id and tipo in (1, 6, 11) and estado in ('pendiente', 'autorizado')) then raise exception 'Esta venta ya tiene factura'; end if;
  select * into emp from empresas where id = v.empresa_id;
  dt := coalesce(nullif(p->>'doc_tipo', '')::int, 99);
  dn := coalesce(nullif(regexp_replace(coalesce(p->>'doc_nro', ''), '\D', '', 'g'), ''), '0');
  if dt = 99 then dn := '0'; end if;
  if dt <> 99 and dn = '0' then raise exception 'Falta el número de documento'; end if;
  if dt = 80 and length(dn) <> 11 then raise exception 'El CUIT tiene que tener 11 números'; end if;
  if dt = 96 and length(dn) not between 7 and 8 then raise exception 'El DNI tiene que tener 7 u 8 números'; end if;
  if dt = 99 and v.total >= cfg.umbral_identificar then raise exception 'Para ventas de % o más ARCA pide el DNI o CUIT de la clienta', to_char(cfg.umbral_identificar, 'FM$999G999G999'); end if;
  cond := coalesce(nullif(p->>'condicion', '')::int, case when dt = 80 then 6 else 5 end);
  t := case when emp.condicion_iva = 'responsable_inscripto' then (case when cond = 1 then 1 else 6 end) else 11 end;
  insert into comprobantes (empresa_id, venta_id, tipo, punto_venta, total, neto, doc_tipo, doc_nro, receptor_nombre, receptor_condicion, receptor_domicilio)
  values (v.empresa_id, v.id, t, cfg.punto_venta, v.total, v.total, dt, dn, nullif(btrim(p->>'nombre'), ''), cond, nullif(btrim(p->>'domicilio'), ''))
  returning id into nuevo;
  -- el documento queda guardado en la ficha de la clienta para la próxima
  if v.cliente_id is not null and dt <> 99 then
    update clientes set documento = coalesce(documento, dn), tipo_doc = coalesce(tipo_doc, case dt when 80 then 'CUIT' when 86 then 'CUIL' else 'DNI' end) where id = v.cliente_id;
  end if;
  return jsonb_build_object('id', nuevo);
end $$;

-- volver a intentar una que ARCA rechazó (por ejemplo después de corregir el documento): se pide de nuevo con factura_pedir
-- una pendiente que no salió todavía se puede cancelar
create or replace function comprobante_cancelar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c comprobantes%rowtype;
begin
  select * into c from comprobantes where id = p_id;
  if c.id is null or not es_admin(c.empresa_id) then raise exception 'Solo administración'; end if;
  if c.estado <> 'pendiente' then raise exception 'Solo se cancela lo que todavía no salió a ARCA'; end if;
  if c.numero_intento is not null then raise exception 'Ya se pidió a ARCA: esperá a que conteste'; end if;
  update comprobantes set estado = 'cancelado', errores = 'Cancelado a mano' where id = p_id;
end $$;

-- ---------- anular una venta facturada → nota de crédito; no cambiar el total de una venta facturada ----------
create or replace function ventas_factura_guardia() returns trigger
language plpgsql security definer set search_path = public as $$
declare f comprobantes%rowtype;
begin
  select * into f from comprobantes where venta_id = new.id and tipo in (1, 6, 11) and estado in ('pendiente', 'autorizado') order by creado desc limit 1;
  if f.id is null then return new; end if;
  if new.estado = 'anulada' and old.estado <> 'anulada' then
    if f.estado = 'pendiente' and f.numero_intento is null then
      update comprobantes set estado = 'cancelado', errores = 'Venta anulada antes de facturar' where id = f.id;
    elsif not exists (select 1 from comprobantes where asociado_id = f.id and estado in ('pendiente', 'autorizado')) then
      insert into comprobantes (empresa_id, venta_id, tipo, punto_venta, total, neto, doc_tipo, doc_nro, receptor_nombre, receptor_condicion, receptor_domicilio, asociado_id)
      values (f.empresa_id, f.venta_id, case f.tipo when 11 then 13 when 6 then 8 when 1 then 3 end, f.punto_venta, f.total, f.neto, f.doc_tipo, f.doc_nro, f.receptor_nombre, f.receptor_condicion, f.receptor_domicilio, f.id);
    end if;
  elsif new.total is distinct from old.total and new.estado <> 'anulada' then
    raise exception 'La venta ya está facturada: para cambiar el importe anulala (sale sola la nota de crédito) y cargala de nuevo';
  end if;
  return new;
end $$;
drop trigger if exists ventas_factura_guardia on ventas;
create trigger ventas_factura_guardia before update of estado, total on ventas for each row execute function ventas_factura_guardia();

-- el servidor revisa cada minuto si hay algo pendiente (solo llama si hay)
create or replace function arca_cron() returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from comprobantes where estado = 'pendiente' and creado < now() - interval '20 seconds') then perform cron_llamar('arca'); end if;
end $$;
select cron.unschedule('percha_arca') where exists (select 1 from cron.job where jobname = 'percha_arca');
select cron.schedule('percha_arca', '* * * * *', 'select arca_cron()');

-- ventas con su factura
create or replace view v_ventas with (security_invoker = true) as
SELECT v.id, v.empresa_id, v.numero, v.tipo, v.estado, v.fecha, v.caja_id, v.turno_id, v.cliente_id, v.vendedora_id, v.lista_id, v.subtotal, v.descuento_pct,
  v.descuento, v.recargo, v.total, v.pagado, v.saldo, v.costo, v.venta_origen_id, v.origen, v.referencia, v.nota, v.offline_id, v.anulada_por, v.anulada_fecha,
  v.anulada_motivo, v.creado_por, v.creado,
  c.nombre AS cliente_nombre, eu.nombre AS vendedora_nombre,
  (SELECT count(*) FROM venta_lineas l WHERE l.venta_id = v.id) AS lineas,
  (SELECT string_agg(fp.nombre, ' + ') FROM venta_pagos vp LEFT JOIN formas_pago fp ON fp.id = vp.forma_pago_id WHERE vp.venta_id = v.id) AS pagos,
  fc.id AS factura_id, fc.estado AS factura_estado, fc.tipo AS factura_tipo,
  case when fc.numero is not null then comprobante_letra(fc.tipo) || ' ' || lpad(fc.punto_venta::text, 5, '0') || '-' || lpad(fc.numero::text, 8, '0') end AS factura_numero,
  nc.id AS nc_id, nc.estado AS nc_estado
FROM ventas v
LEFT JOIN clientes c ON c.id = v.cliente_id
LEFT JOIN empresa_usuarios eu ON eu.empresa_id = v.empresa_id AND eu.user_id = v.vendedora_id
LEFT JOIN LATERAL (SELECT * FROM comprobantes x WHERE x.venta_id = v.id AND x.tipo IN (1, 6, 11) AND x.estado <> 'cancelado' ORDER BY (x.estado = 'autorizado') DESC, x.creado DESC LIMIT 1) fc ON true
LEFT JOIN LATERAL (SELECT * FROM comprobantes x WHERE x.asociado_id = fc.id AND x.estado <> 'cancelado' ORDER BY x.creado DESC LIMIT 1) nc ON true;

-- Augusta: arranca con lo que ya se sabe (CUIT de la empresa); el punto de venta lo crea Emi en ARCA
insert into facturacion_config (empresa_id, cuit)
select id, nullif(regexp_replace(coalesce(cuit, ''), '\D', '', 'g'), '') from empresas
on conflict (empresa_id) do nothing;
