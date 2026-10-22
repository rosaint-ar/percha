-- Primera empresa: Augusta Intimates (datos de F_EMP de FactuSOL)
insert into empresas (nombre, razon_social, cuit, condicion_iva, domicilio, localidad, provincia, codigo_postal, telefono, email, web, inicio_actividades, config)
select 'Augusta Intimates', 'AUGUSTA® INTIMATES', '23-36425562-4', 'monotributo', 'Sobremonte 489', 'Río Cuarto', 'Córdoba', '5800', '3584365289',
       'contacto@augustaintimates.com', 'www.augustaintimates.com', null,
       '{"moneda":"ARS","etiquetas":{"ancho_mm":62,"alto_mm":29,"impresora":"Brother"},"horario":{"lunes_viernes":"10-13 y 17:30-20:30","sabado":"10-13"}}'::jsonb
where not exists (select 1 from empresas where nombre = 'Augusta Intimates');

-- Las tablas crudas de FactuSOL (informes) quedan ligadas a Augusta
do $$
declare e uuid; t text;
begin
  select id into e from empresas where nombre = 'Augusta Intimates';
  foreach t in array array['fs_remitos','fs_remito_lineas','fs_articulos','fs_familias','fs_formas_pago','fs_sync_log'] loop
    execute format('drop policy if exists %I_ver on %I', t, t);
    execute format('create policy %I_ver on %I for select using (es_miembro(%L::uuid))', t, t, e);
  end loop;
end $$;
