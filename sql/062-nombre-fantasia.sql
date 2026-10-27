-- 062 · La factura muestra el nombre de fantasía en grande y la razón social en chico (Diego, 27/10/2026)
--   facturacion_config_guardar acepta también 'nombre' (nombre de fantasía = empresas.nombre)
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
  update empresas set
    nombre = coalesce(nullif(btrim(p->>'nombre'), ''), nombre),
    razon_social = coalesce(nullif(p->>'razon_social', ''), razon_social),
    iibb = case when p ? 'iibb' then nullif(p->>'iibb', '') else iibb end,
    inicio_actividades = case when p ? 'inicio_actividades' then nullif(p->>'inicio_actividades', '')::date else inicio_actividades end,
    condicion_iva = coalesce(nullif(p->>'condicion_iva', ''), condicion_iva),
    cuit = coalesce(case when cu is not null then substr(cu, 1, 2) || '-' || substr(cu, 3, 8) || '-' || substr(cu, 11, 1) end, cuit)
  where id = e;
  return (select to_jsonb(f) - 'key_secret_id' from facturacion_config f where empresa_id = e);
end $$;
