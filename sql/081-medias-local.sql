-- 081 · Medias que solo se venden en el local: MEDIAS «LOCAL» (sin variantes, no está en la web), completa al genérico MEDIAS VARIAS.
-- Stock 0: se cuenta después (Diego 28/10). Las medias de los BOX MÁ de los pedidos web 2415 y 2414 ("soquete sin elección", la web no dice cuál)
-- se definen como MEDIAS «LOCAL».
do $$
declare e uuid; gen productos%rowtype; nuevo uuid; cod text;
begin
  select * into gen from productos where codigo = '900203' and es_generico;
  if gen.id is null then raise exception 'No está MEDIAS VARIAS'; end if;
  e := gen.empresa_id;
  select id into nuevo from productos where empresa_id = e and nombre = 'MEDIAS «LOCAL»';
  if nuevo is null then
    cod := proximo_codigo(e, '900203');
    insert into productos (empresa_id, codigo, nombre, categoria_id, precio, tipo, tiene_variantes, activo, es_generico, descripcion)
    values (e, cod, 'MEDIAS «LOCAL»', gen.categoria_id, gen.precio, 'prenda', false, true, false, 'Medias que solo se venden en el local (no están en la web). Sin variantes.')
    returning id into nuevo;
    insert into variantes (empresa_id, producto_id, sku) values (e, nuevo, cod);
  end if;
  update productos set generico_local_id = nuevo where id = gen.id;
end $$;

select set_config('request.jwt.claims', '{"sub":"5f43c17d-958a-4ef7-badc-1a4001a20747","role":"authenticated"}', true);
do $$
declare x record; vloc uuid := (select v.id from variantes v join productos p on p.id = v.producto_id where p.nombre = 'MEDIAS «LOCAL»' limit 1);
begin
  for x in select pd.* from v_pendientes_definir pd where pd.desde_nombre = 'MEDIAS VARIAS' and pd.venta_numero in (3, 7) loop
    perform venta_definir(jsonb_build_object('linea_id', x.linea_id, 'desde_variante_id', x.desde_variante_id, 'asignaciones', jsonb_build_array(jsonb_build_object('variante_id', vloc, 'cantidad', x.pendiente))));
  end loop;
  -- MEDIAS «LOCAL» todavía no se contó: el aviso de "sin stock" de estas dos se da por visto
  update stock_revisar set resuelto = now(), resolucion = 'MEDIAS «LOCAL» todavía no se contó (box MÁ de la web)' where variante_id = vloc and resuelto is null;
end $$;

select json_build_object('medias_local', (select json_build_object('codigo', codigo, 'precio', precio) from productos where nombre = 'MEDIAS «LOCAL»'),
  'pendientes_definir', (select count(*) from v_pendientes_definir), 'revisar', (select count(*) from stock_revisar where resuelto is null),
  'stock', (select stock from v_variantes where producto_nombre = 'MEDIAS «LOCAL»'));
