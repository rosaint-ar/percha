-- 022 · Conjuntos: un producto por modelo, el color es variante.
--   Tienda Nube tiene un producto por color (CONJUNTO «ALICE» SALMÓN); al crearlos desde el canal quedaron como productos aparte.
--   Acá se fusionan en el modelo base como color (talles × color), moviendo stock, ventas, cruce con TN y kits; el producto de color se borra.
--   También: nombres con la convención de Emi («EMMA SOFT», «MARTHA SOFT» → «BECCA SOFT», «SERAPHINE SOFT»), talles raros unificados.

-- fusionar un producto entero en otro, como un color (p_color null = conserva el color que ya tenía cada variante)
create or replace function producto_fusionar_en(p_de_codigo text, p_a_codigo text, p_color text) returns text
language plpgsql security definer set search_path = public as $$
declare de productos%rowtype; a productos%rowtype; v record; c_id uuid; t_id uuid; t_nom text; v_dest uuid; n int := 0;
begin
  select * into de from productos where codigo = p_de_codigo; select * into a from productos where codigo = p_a_codigo;
  if de.id is null or a.id is null then return p_de_codigo || ': no existe'; end if;
  if p_color is not null then c_id := atributo_desde_canal(a.empresa_id, 'color', p_color); end if;
  for v in select * from variantes where producto_id = de.id loop
    -- talle: el mismo; si el destino usa la forma corta ("L" en vez de "L (95)"), se adapta
    t_id := v.talle_id;
    if t_id is not null then
      select nombre into t_nom from atributos where id = t_id;
      if t_nom ~ '\s\(.*\)$' and not exists (select 1 from variantes w where w.producto_id = a.id and w.talle_id = t_id) then
        select id into t_id from atributos where empresa_id = a.empresa_id and tipo = 'talle' and nombre = regexp_replace(t_nom, '\s*\(.*\)$', '') limit 1;
        t_id := coalesce(t_id, v.talle_id);
      end if;
    end if;
    select id into v_dest from variantes where producto_id = a.id and talle_id is not distinct from t_id and color_id is not distinct from coalesce(c_id, v.color_id) and estampa_id is not distinct from v.estampa_id;
    if v_dest is null then
      insert into variantes (empresa_id, producto_id, talle_id, color_id, estampa_id, sku, ean, precio, costo, activa)
      values (a.empresa_id, a.id, t_id, coalesce(c_id, v.color_id), v.estampa_id,
              a.codigo || coalesce('-' || (select codigo from atributos where id = t_id), '') || coalesce('-' || (select codigo from atributos where id = coalesce(c_id, v.color_id)), ''),
              v.ean, v.precio, v.costo, v.activa) returning id into v_dest;
    end if;
    perform variante_fusionar(v.id, v_dest); n := n + 1;
  end loop;
  update productos set imagen_url = coalesce(imagen_url, de.imagen_url), tiene_variantes = true where id = a.id;
  update venta_lineas set producto_id = a.id where producto_id = de.id;
  delete from precios where producto_id = de.id;
  delete from productos where id = de.id;
  return p_de_codigo || ' → ' || p_a_codigo || ' (' || coalesce(p_color, 'mismo color') || ', ' || n || ' var.)';
end $$;

-- talles raros de CHARO (FactuSOL) → como los escribe Emi en TN
do $$ declare e uuid; begin
  for e in select id from empresas loop
    perform atributo_fusionar_por_nombre(e, 'talle', '(85/90)', '1 (85/90)');
    perform atributo_fusionar_por_nombre(e, 'talle', '(95/100)', '2 (95/100)');
  end loop;
end $$;

-- fusiones: producto de color → modelo base
select producto_fusionar_en(de, a, color) from (values
  ('200185','200146','Azul'), ('200317','200314','Salmón'), ('200187','200148','Salmón'), ('200188','200148','Verde agua'),
  ('200136','200132','Negro con nude'), ('200218','200214','Negro'), ('200219','200214','Blanco'), ('200220','200214','Gris'),
  ('200105','200103','Orquídea'), ('200108','200106','Rojo'), ('200203','200201','Fucsia'), ('200209','200201','Nude'),
  ('200189','200158','Azul Marino'), ('200193','200175','Crema'), ('200137','200215','Blanco'), ('200139','200215','Negro'), ('200161','200215','Nude'),
  ('200308','200302','Azul Marino'), ('200117','200116','Blanco'), ('200194','200179','Verde Seco'), ('200216','200204','Crema'), ('200217','200204','Rosa'),
  ('200124','200204','Aqua II'), ('200186','200147','Aqua'),
  ('200125','200122','Beige'), ('200126','200122','Blanco'), ('200127','200122','Gris'), ('200129','200122','Habano'), ('200130','200122','Negro'),
  ('200138','200181','Rojo'), ('200174','200128','Uva'), ('200316','200313','Verde Seco'), ('200315','200306','Salmón'), ('200403','200402','Limón'),
  ('200190','200164','Beige'), ('200191','200165','Beige'), ('200192','200169','Jean'), ('200195','200184',null), ('200701','200702','Nude')
) m(de, a, color);

-- nombres: el color sale del nombre (ya es variante); convención de Emi para las líneas SOFT; tela afuera
update productos set nombre = n.nuevo, descripcion = coalesce(descripcion || E'\n', '') || 'Nombre anterior: ' || productos.nombre from (values
  ('200114','CONJUNTO «FELI»'), ('200121','CONJUNTO «LUCY»'), ('200135','CONJUNTO «QUEEN»'), ('200131','CONJUNTO «MILA»'), ('200305','CONJUNTO «LALI»'),
  ('200214','CONJUNTO «BECCA SOFT»'), ('200501','CORSET «SERAPHINE SOFT»'), ('200401','TOP «JUANI» MORLEY'), ('200702','CORPIÑO «BANDEAU» STRAPLESS'),
  ('200122','CONJUNTO «MARTHA» CLASSIC'), ('200147','CONJUNTO «MARTHA» FLORES'), ('200142','CONJUNTO «MILA» CLASSIC'), ('200140','CONJUNTO «MILA» PRINT')
) n(codigo, nuevo) where productos.codigo = n.codigo and productos.nombre <> n.nuevo;

select p.codigo, p.nombre, p.activo,
  (select string_agg(distinct t.nombre, '/' order by t.nombre) from variantes v join atributos t on t.id=v.talle_id where v.producto_id=p.id and v.activa) talles,
  (select string_agg(distinct co.nombre, ', ' order by co.nombre) from variantes v join atributos co on co.id=v.color_id where v.producto_id=p.id and v.activa) colores,
  coalesce((select sum(s.cantidad) from stock s join variantes v on v.id=s.variante_id where v.producto_id=p.id and v.activa),0)::int stock
from productos p join categorias c on c.id=p.categoria_id where c.nombre='CONJUNTOS' and p.tipo='prenda' order by p.nombre;

-- restos: talle "37 al 39" (de calzado) en el bandeau → fuera; stock negativo de MARTHA CLASSIC → 0; SEGUNDA PIEL sin variante → única
delete from variantes v using productos p, atributos t where p.id = v.producto_id and p.codigo = '200702' and t.id = v.talle_id and t.nombre = '37 al 39'
  and not exists (select 1 from venta_lineas l where l.variante_id = v.id) and coalesce((select sum(cantidad) from stock s where s.variante_id = v.id), 0) = 0;
insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota)
select v.empresa_id, v.id, s.deposito_id, -s.cantidad, 'ajuste', 'Corrección: stock negativo a 0' from variantes v join stock s on s.variante_id = v.id join productos p on p.id = v.producto_id where p.codigo = '200122' and s.cantidad < 0;
insert into variantes (empresa_id, producto_id, sku) select empresa_id, id, codigo from productos p where codigo = '200801' and not exists (select 1 from variantes v where v.producto_id = p.id);
