-- 033 · Sincronización FactuSOL → Percha mientras el local siga cargando en FactuSOL.
-- El script local (PC de Diego) lee el .accdb del Drive y manda los remitos nuevos a `factusol_cargar` (con la cron_key).
-- `factusol_importar_ventas` convierte en ventas de Percha los remitos posteriores al arranque (app_config.factusol_desde_codigo),
-- salvo los de "ONLINE - LISTA" (son pedidos de Tienda Nube: ya entran por la conexión).

alter table fs_remitos add column if not exists obs text;
alter table fs_remitos add column if not exists descuento numeric(14,2) not null default 0;
alter table fs_remitos add column if not exists venta_id uuid references ventas(id) on delete set null;
alter table fs_remitos add column if not exists omitido text;      -- por qué no se importó (Tienda Nube, anterior al arranque…)
alter table fs_remitos add column if not exists problema text;     -- qué no se pudo resolver al importar
alter table fs_sync_log add column if not exists detalle jsonb;

insert into app_config (clave, valor) values ('factusol_desde_codigo', '1304') on conflict (clave) do nothing;

-- los dos remitos ya cargados a mano (1303/1304) eran ventas por WhatsApp
update ventas set origen = 'whatsapp' where origen = 'factusol' and referencia in ('1303','1304');
update ventas v set referencia = 'FactuSOL ' || referencia where origen = 'whatsapp' and referencia in ('1303','1304');
update fs_remitos r set venta_id = v.id from ventas v where v.referencia = 'FactuSOL ' || r.codigo and r.ejercicio = 2026 and r.venta_id is null;

create or replace function quitar_acentos(t text) returns text language sql immutable as $$
  select lower(translate(coalesce(t, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
$$;

-- ---------- Importar a Percha los remitos pendientes ----------
create or replace function factusol_importar_ventas(p_empresa uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e uuid := coalesce(p_empresa, (select id from empresas order by creada limit 1));
  desde int := coalesce((select valor from app_config where clave = 'factusol_desde_codigo'), '0')::int;
  r record; l record; prod record; var_id uuid; lineas jsonb; probl text[]; fp uuid; fp_nombre text; origen text;
  res jsonb; importados jsonb := '[]'::jsonb; omitidos int := 0; v_fecha timestamptz; dep uuid; total_l numeric; desc_ numeric; rec_ numeric;
begin
  if not es_servicio() and not es_admin(e) then raise exception 'Solo administración puede traer ventas de FactuSOL'; end if;
  -- lo que sigue registra ventas sin sesión de vendedora
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  dep := (select id from depositos where empresa_id = e and principal limit 1);
  for r in select * from fs_remitos where ejercicio = 2026 and codigo > desde and venta_id is null and omitido is null order by codigo loop
    if r.cliente_nombre ilike 'ONLINE - LISTA%' then
      update fs_remitos set omitido = 'Pedido de Tienda Nube: entra por la conexión' where id = r.id; omitidos := omitidos + 1; continue;
    end if;
    if not exists (select 1 from fs_remito_lineas where remito_id = r.id) then
      update fs_remitos set omitido = 'Sin renglones' where id = r.id; omitidos := omitidos + 1; continue;
    end if;
    origen := case when r.cliente_nombre ilike 'ONLINE%' or r.obs ilike '%wsp%' or r.obs ilike '%whats%' then 'whatsapp' else 'local' end;
    lineas := '[]'::jsonb; probl := '{}'; total_l := 0;
    for l in select * from fs_remito_lineas where remito_id = r.id order by pos loop
      select p.id, p.nombre, p.tipo, p.tiene_variantes into prod from productos p where p.empresa_id = e and p.codigo = l.articulo;
      if prod.id is null then
        select p.id, p.nombre, p.tipo, p.tiene_variantes into prod from productos p where p.empresa_id = e and p.activo
          and (quitar_acentos(p.nombre) = quitar_acentos(l.descripcion) or p.descripcion ilike '%Nombre anterior: ' || l.descripcion || '%') limit 1;
      end if;
      var_id := null;
      if prod.id is not null then
        select v.id into var_id from variantes v
          left join atributos t on t.id = v.talle_id left join atributos c on c.id = v.color_id
          where v.producto_id = prod.id
            and (l.talle is null or upper(t.codigo) = upper(l.talle) or quitar_acentos(t.nombre) = quitar_acentos(l.talle))
            and (l.color is null or upper(c.codigo) = upper(l.color) or quitar_acentos(c.nombre) = quitar_acentos(l.color))
          order by (t.id is not null)::int + (c.id is not null)::int desc limit 1;
        if var_id is null and (l.talle is not null or l.color is not null) then
          -- talle o color que Percha no tiene para ese producto → unidad "sin definir"
          var_id := variante_indefinida(prod.id);
          probl := probl || (l.descripcion || ' ' || coalesce(l.talle, '') || ' ' || coalesce(l.color, '') || ': talle/color no encontrado, quedó sin definir');
        elsif var_id is null then
          select v.id into var_id from variantes v where v.producto_id = prod.id and v.activa order by (v.talle_id is null and v.color_id is null)::int desc limit 1;
        end if;
      elsif l.articulo not in ('100000','200000','300000','400000') then
        probl := probl || (l.articulo || ' ' || l.descripcion || ': producto no existe en Percha, sin stock');
      end if;
      total_l := total_l + l.total;
      lineas := lineas || jsonb_build_object('variante_id', var_id, 'producto_id', prod.id, 'descripcion', coalesce(prod.nombre, l.descripcion), 'talle', l.talle, 'color', l.color,
        'cantidad', l.cantidad, 'precio_lista', l.precio, 'precio_unit', l.precio, 'descuento_pct', 0, 'total', l.total, 'costo_unit', coalesce(l.costo_unit, 0));
    end loop;
    desc_ := case when total_l > r.total then round(total_l - r.total, 2) else 0 end;
    rec_ := case when r.total > total_l then round(r.total - total_l, 2) else 0 end;
    -- forma de pago: por código de FactuSOL, si no por nombre, si no se crea (inactiva) para no mentir
    select id into fp from formas_pago where empresa_id = e and codigo_fs = r.forma_pago limit 1;
    if fp is null then
      select nombre into fp_nombre from fs_formas_pago where codigo = r.forma_pago;
      select id into fp from formas_pago where empresa_id = e and lower(nombre) = lower(coalesce(fp_nombre, '')) limit 1;
      if fp is null then
        insert into formas_pago (empresa_id, nombre, tipo, activa, codigo_fs) values (e, coalesce(fp_nombre, 'FactuSOL ' || r.forma_pago), 'otro', false, r.forma_pago) returning id into fp;
      else update formas_pago set codigo_fs = r.forma_pago where id = fp; end if;
    end if;
    v_fecha := (r.fecha::text || ' ' || coalesce(r.hora::text, '12:00:00'))::timestamp at time zone 'America/Argentina/Cordoba';
    res := caja_registrar_venta(jsonb_build_object('empresa_id', e, 'estado', 'completada', 'tipo', 'venta', 'fecha', v_fecha, 'deposito_id', dep,
      'lista_id', (select id from listas_precios where empresa_id = e and predeterminada limit 1), 'descuento_pct', 0, 'descuento', desc_, 'recargo', rec_,
      'origen', origen, 'referencia', 'FactuSOL ' || r.codigo,
      'nota', 'FactuSOL remito ' || r.codigo || ' · ' || coalesce(r.cliente_nombre, '') || coalesce(' · ' || nullif(r.obs, ''), '') || case when array_length(probl, 1) > 0 then ' · REVISAR: ' || array_to_string(probl, '; ') else '' end,
      'lineas', lineas, 'pagos', jsonb_build_array(jsonb_build_object('forma_pago_id', fp, 'monto', r.total)), 'creditos_a_emitir', '[]'::jsonb));
    update fs_remitos set venta_id = (res->>'id')::uuid, problema = nullif(array_to_string(probl, '; '), '') where id = r.id;
    importados := importados || jsonb_build_object('remito', r.codigo, 'ticket', res->>'numero', 'total', r.total, 'origen', origen, 'problema', nullif(array_to_string(probl, '; '), ''));
  end loop;
  return jsonb_build_object('importados', importados, 'omitidos', omitidos);
end $$;

-- ---------- Recibir remitos del script local (autenticado con la cron_key) ----------
create or replace function factusol_cargar(p_clave text, p_archivo_modificado timestamptz, p_remitos jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; l jsonb; n int := 0; nl int := 0; res jsonb; rid text;
begin
  if p_clave is null or p_clave <> coalesce((select valor from app_config where clave = 'cron_key'), '') then raise exception 'Clave inválida'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_remitos, '[]'::jsonb)) loop
    rid := '2026-1-' || (r->>'codigo');
    insert into fs_remitos (id, ejercicio, codigo, fecha, hora, cliente_cod, cliente_nombre, forma_pago, total, total_lineas, facturado, tpv_id, almacen, obs, descuento, sincronizado)
    values (rid, 2026, (r->>'codigo')::int, (r->>'fecha')::date, nullif(r->>'hora', '')::time, (r->>'cliente_cod')::int, r->>'cliente_nombre', (r->>'forma_pago')::int,
            (r->>'total')::numeric, (r->>'total_lineas')::numeric, coalesce((r->>'facturado')::boolean, false), nullif(r->>'tpv_id', ''), r->>'almacen', nullif(r->>'obs', ''), coalesce((r->>'descuento')::numeric, 0), now())
    on conflict (id) do update set fecha = excluded.fecha, hora = excluded.hora, cliente_cod = excluded.cliente_cod, cliente_nombre = excluded.cliente_nombre, forma_pago = excluded.forma_pago,
      total = excluded.total, total_lineas = excluded.total_lineas, facturado = excluded.facturado, tpv_id = excluded.tpv_id, obs = excluded.obs, descuento = excluded.descuento, sincronizado = now();
    -- los renglones se reemplazan solo si el remito todavía no se importó (si ya es venta, se edita desde Percha)
    if not exists (select 1 from fs_remitos where id = rid and venta_id is not null) then
      delete from fs_remito_lineas where remito_id = rid;
      for l in select * from jsonb_array_elements(coalesce(r->'lineas', '[]'::jsonb)) loop
        insert into fs_remito_lineas (remito_id, pos, articulo, descripcion, talle, color, cantidad, precio, total, costo_unit)
        values (rid, (l->>'pos')::int, l->>'articulo', l->>'descripcion', nullif(l->>'talle', ''), nullif(l->>'color', ''), (l->>'cantidad')::numeric, (l->>'precio')::numeric, (l->>'total')::numeric, (l->>'costo_unit')::numeric);
        nl := nl + 1;
      end loop;
    end if;
    n := n + 1;
  end loop;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);   -- la clave ya se validó: importa como servicio
  res := factusol_importar_ventas(null);
  insert into fs_sync_log (archivo, ejercicio, remitos, lineas, archivo_modificado, hecho, detalle) values ('0012026.accdb', 2026, n, nl, p_archivo_modificado, now(), res);
  return jsonb_build_object('recibidos', n, 'renglones', nl, 'ultimo_codigo', (select max(codigo) from fs_remitos where ejercicio = 2026)) || res;
end $$;

create or replace function factusol_ultimo_codigo(p_clave text) returns int
language sql security definer set search_path = public as $$
  select case when p_clave = (select valor from app_config where clave = 'cron_key') then (select max(codigo) from fs_remitos where ejercicio = 2026) else null end;
$$;

-- Estado para la pantalla de Ventas
create or replace function factusol_estado() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'archivo_modificado', (select archivo_modificado from fs_sync_log order by hecho desc limit 1),
    'ultima_sync', (select hecho from fs_sync_log order by hecho desc limit 1),
    'ultimo_codigo', (select max(codigo) from fs_remitos where ejercicio = 2026),
    'pendientes', (select count(*) from fs_remitos where ejercicio = 2026 and codigo > coalesce((select valor from app_config where clave = 'factusol_desde_codigo'), '0')::int and venta_id is null and omitido is null),
    'con_problema', (select count(*) from fs_remitos where ejercicio = 2026 and problema is not null)
  );
$$;
revoke all on function factusol_cargar(text, timestamptz, jsonb) from public; grant execute on function factusol_cargar(text, timestamptz, jsonb) to anon, authenticated;
revoke all on function factusol_ultimo_codigo(text) from public; grant execute on function factusol_ultimo_codigo(text) to anon, authenticated;

select numero, origen, referencia, (select codigo from fs_remitos where venta_id = v.id) remito from ventas v order by numero;
