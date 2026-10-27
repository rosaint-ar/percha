-- 063 · Fecha de la factura elegible y revisión antes de emitir (27/10/2026)
--   factura_pedir acepta p.fecha (por defecto hoy). ARCA (productos) acepta hasta 5 días atrás y nunca antes que la última
--   autorizada del mismo tipo y punto de venta. factura_fechas(e) le dice a la pantalla qué rango ofrecer.
create or replace function factura_pedir(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v ventas%rowtype; cfg facturacion_config%rowtype; emp empresas%rowtype; t int; dt int; dn text; cond int; nuevo uuid; fch date; hoy date := (now() at time zone 'America/Argentina/Cordoba')::date; minimo date;
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
  -- fecha: la elegida (ARCA acepta hasta 5 días atrás y nunca antes que la última emitida en ese punto de venta)
  fch := coalesce(nullif(p->>'fecha', '')::date, hoy);
  minimo := greatest(hoy - 5, coalesce((select max(fecha) from comprobantes where empresa_id = v.empresa_id and punto_venta = cfg.punto_venta and tipo = t and estado = 'autorizado'), hoy - 5));
  if fch > hoy then raise exception 'La factura no puede tener fecha futura'; end if;
  if fch < minimo then raise exception 'La fecha más vieja que acepta ARCA es el %', to_char(minimo, 'DD/MM/YYYY'); end if;
  insert into comprobantes (empresa_id, venta_id, tipo, punto_venta, total, neto, doc_tipo, doc_nro, receptor_nombre, receptor_condicion, receptor_domicilio, fecha)
  values (v.empresa_id, v.id, t, cfg.punto_venta, v.total, v.total, dt, dn, nullif(btrim(p->>'nombre'), ''), cond, nullif(btrim(p->>'domicilio'), ''), fch)
  returning id into nuevo;
  -- el documento queda guardado en la ficha de la clienta para la próxima
  if v.cliente_id is not null and dt <> 99 then
    update clientes set documento = coalesce(documento, dn), tipo_doc = coalesce(tipo_doc, case dt when 80 then 'CUIT' when 86 then 'CUIL' else 'DNI' end) where id = v.cliente_id;
  end if;
  return jsonb_build_object('id', nuevo);
end $$;


create or replace function factura_fechas(e uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare hoy date := (now() at time zone 'America/Argentina/Cordoba')::date; cfg facturacion_config%rowtype; t int; ult date; proximo int;
begin
  if not es_miembro(e) then raise exception 'Sin permiso'; end if;
  select * into cfg from facturacion_config where empresa_id = e;
  t := case when (select condicion_iva from empresas where id = e) = 'responsable_inscripto' then 6 else 11 end;
  select max(fecha), max(numero) into ult, proximo from comprobantes where empresa_id = e and punto_venta = cfg.punto_venta and tipo = t and estado = 'autorizado';
  return jsonb_build_object('hoy', hoy, 'minimo', greatest(hoy - 5, coalesce(ult, hoy - 5)), 'ultima', ult, 'proximo', greatest(coalesce(proximo, 0), coalesce(cfg.ultimo_numero, 0)) + 1, 'punto_venta', cfg.punto_venta, 'tipo', t);
end $$;
