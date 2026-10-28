-- 074 · Bombachas que solo se venden en el local (no están en la web): artículo BOMBIS «LOCAL», sin variantes.
-- Al definir un genérico (BOMBIS «VARIAS») se eligen los modelos de la web y lo que falta se completa con BOMBIS «LOCAL».
-- Genérico para cualquier empresa: productos.generico_local_id = el artículo "del local" con que se completa ese genérico.

alter table productos add column if not exists generico_local_id uuid references productos(id) on delete set null;

do $$
declare e uuid; gen productos%rowtype; nuevo uuid; cod text;
begin
  select * into gen from productos where codigo = '100200' and es_generico;
  if gen.id is null then raise exception 'No está BOMBIS «VARIAS»'; end if;
  e := gen.empresa_id;
  select id into nuevo from productos where empresa_id = e and nombre = 'BOMBIS «LOCAL»';
  if nuevo is null then
    cod := proximo_codigo(e, '100200');
    insert into productos (empresa_id, codigo, nombre, categoria_id, precio, tipo, tiene_variantes, activo, es_generico, descripcion)
    values (e, cod, 'BOMBIS «LOCAL»', gen.categoria_id, gen.precio, 'prenda', false, true, false, 'Bombachas que solo se venden en el local (no están en la web). Sin variantes.')
    returning id into nuevo;
    insert into variantes (empresa_id, producto_id, sku) values (e, nuevo, cod);
  end if;
  update productos set generico_local_id = nuevo where id = gen.id;
  raise notice 'BOMBIS «LOCAL» %', (select codigo from productos where id = nuevo);
end $$;

select json_build_object('local', (select json_build_object('codigo', codigo, 'precio', precio) from productos where nombre = 'BOMBIS «LOCAL»'),
  'varias', (select generico_local_id is not null from productos where codigo = '100200'));
