-- 024 · Bodies, Ligueros y arneses, Trajes de baño, Ropa: mismo criterio que conjuntos/pijamas.

-- 1) talles de bikini con la equivalencia entre paréntesis ("L (95)") → una sola escala (S/M/L/XL…); la equivalencia queda en la ficha del producto
do $$ declare e uuid; r record; begin
  for e in select id from empresas loop
    for r in select * from (values ('XS (80)','XS'),('S (85)','S'),('M (90)','M'),('L (95)','L'),('XL (100)','XL'),('XXL (105)','XXL'),
                                   ('S (85/90)','S'),('M (85/90)','M'),('M (90/95)','M'),('L (95/100)','L'),('XL (100/105)','XL'),('XL (105/110)','XL'),
                                   ('M/L (90/95)','M/L'),('S/M (85/90)','S/M'),('1 (S/M)','S/M'),('3 (L/XL)','L/XL')) m(de, a) loop
      perform atributo_fusionar_por_nombre(e, 'talle', r.de, r.a);
    end loop;
  end loop;
end $$;

-- 2) productos de color → modelo
select producto_fusionar_en(de, a, color) from (values
  ('300116','300102','Rojo'), ('300203','300202','Blanco'), ('300204','300202','Negro'),
  ('400211','400202','Rojo'), ('400212','400206','Negro'), ('400111','400102','Negro'), ('400112','400105','Blanco'), ('400104','400101','Negro'),
  ('600102','600118',null), ('600129','600122','Azul Francia'), ('600130','600122','Verde'), ('600131','600122','Fucsia'),
  ('600128','600116','Multicolor'), ('600104','600103','Reptil'),
  ('600403','600401','Margaritas'), ('600404','600401','Patch'), ('600405','600401','Print'), ('600406','600401','Proud'), ('600407','600401','San Marino'), ('600408','600401','Tropic')
) m(de, a, color);

-- 3) nombres
update productos set nombre = n.nuevo, descripcion = coalesce(descripcion || E'\n', '') || 'Nombre anterior: ' || productos.nombre from (values
  ('300108','BODY «ÁMBAR» MORLEY'), ('400102','LIGA «LEXIE»'), ('600118','BIKINI «CALLIE» MORLEY'),
  ('600303','BOMBACHA «KENDALL» CLASSIC'), ('600305','BOMBACHA «KENDALL» CULOTTELESS'), ('600302','BOMBACHA «KENDALL» ELÁSTICO ANCHO'),
  ('600304','BOMBACHA «KENDALL» EN V'), ('600301','BOMBACHA «KENDALL» TIRITAS'), ('600306','BOMBACHA «KENDALL» VEDETINA'),
  ('600401','CORPIÑO «KENDALL» BIKINI'), ('600402','CORPIÑO «NEW KENDALL» BIKINI'), ('600113','BIKINI «MALIBÚ» REGULABLE'), ('600114','BIKINI «MALIBÚ» CULOTTE'),
  ('600202','ENTERIZA «MANGO»'), ('600201','ENTERIZA «ROUSE»'), ('700101','CALZA «DEPORTIVA»')
) n(codigo, nuevo) where productos.codigo = n.codigo and productos.nombre <> n.nuevo;

-- Ropa (FactuSOL): «VEST. CORTO FIESTA» → VESTIDO «CORTO FIESTA»; «TOP CORTO» CROCHET → TOP «CORTO» CROCHET; «SHORT» CROCHET → SHORT «CROCHET»
do $$
declare r record; dentro text; fuera text; tipo text; modelo text; nuevo text; partes text[];
begin
  for r in select p.id, p.empresa_id, p.nombre from productos p join categorias c on c.id = p.categoria_id where c.nombre = 'ROPA' and p.nombre ~ '^«' loop
    dentro := btrim(substring(r.nombre from '«([^»]*)»')); fuera := btrim(coalesce(substring(r.nombre from '»(.*)$'), ''));
    dentro := regexp_replace(dentro, '^VEST[.-]?\s*', 'VESTIDO '); dentro := replace(dentro, 'TUNICA', 'TÚNICA');
    partes := regexp_split_to_array(dentro, '\s+');
    if array_length(partes, 1) >= 2 then tipo := partes[1]; modelo := array_to_string(partes[2:], ' ');
    elsif fuera <> '' then tipo := dentro; modelo := fuera; fuera := '';
    else continue; end if;
    nuevo := btrim(tipo || ' «' || modelo || '»' || case when fuera <> '' then ' ' || fuera else '' end);
    if nuevo <> r.nombre and not exists (select 1 from productos q where q.empresa_id = r.empresa_id and q.id <> r.id and lower(q.nombre) = lower(nuevo)) then
      update productos set nombre = nuevo, descripcion = coalesce(descripcion || E'\n', '') || 'Nombre anterior: ' || r.nombre where id = r.id;
    end if;
  end loop;
end $$;
update productos set nombre = replace(nombre, 'ELASTICO', 'ELÁSTICO') where nombre like '%ELASTICO%';
update productos set nombre = replace(nombre, 'AMBAR', 'ÁMBAR') where nombre like '%«AMBAR»%';

select c.nombre fam, p.codigo, p.nombre, p.activo,
  (select string_agg(distinct t.nombre, '/' order by t.nombre) from variantes v join atributos t on t.id=v.talle_id where v.producto_id=p.id and v.activa) talles,
  (select string_agg(distinct co.nombre, ', ' order by co.nombre) from variantes v join atributos co on co.id=v.color_id where v.producto_id=p.id and v.activa) colores,
  coalesce((select sum(s.cantidad) from stock s join variantes v on v.id=s.variante_id where v.producto_id=p.id and v.activa),0)::int stock
from productos p join categorias c on c.id=p.categoria_id where c.nombre in ('BODIES','LIGUEROS Y ARNESES','TRAJES DE BAÑO','ROPA','ROPA DEPORTIVA') and p.tipo='prenda' order by c.nombre, p.nombre;
