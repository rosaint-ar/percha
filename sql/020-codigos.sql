-- 020 · Códigos coherentes: 6 dígitos = 2 de familia + 4 correlativos. La familia la define la categoría.
--   10 Bombachas · 20 Conjuntos · 30 Bodies · 40 Ligueros y arneses · 50 Pijamas · 60 Trajes de baño · 70 Ropa deportiva
--   80 Ropa · 90 Accesorios · 91 Calzado · 92 Sexitive · 93 Lonas · 94 Pareos · 99 Varios (seña, envío, gift card, fallados)
--   Se recodifica solo lo que no cumple (P-1, 500000 en calzado, etc.); no hay etiquetas impresas que cuidar. El SKU de las variantes sigue al código.

update categorias c set codigo = m.cod from (values
  ('BOMBACHAS','10'),('CONJUNTOS','20'),('BODIES','30'),('LIGUEROS Y ARNESES','40'),('PIJAMAS','50'),('TRAJES DE BAÑO','60'),('ROPA DEPORTIVA','70'),
  ('ROPA','80'),('ACCESORIOS','90'),('CALZADO','91'),('SEXITIVE','92'),('LONAS PLAYERAS','93'),('PAREOS Y PAÑUELOS','94'),('VARIOS','99')) m(nombre, cod)
where upper(c.nombre) = m.nombre;

-- sin categoría: por el prefijo del código
update productos p set categoria_id = c.id from categorias c where p.categoria_id is null and c.empresa_id = p.empresa_id and c.codigo = left(p.codigo, 2) and p.codigo ~ '^\d{6}$';

-- basura de pruebas (el BOXTEST tiene una venta anulada: queda inactivo) y duplicados
update productos set activo = false, nombre = nombre || ' (repetida)' where codigo = '990102' and nombre = 'GIFT CARD' and exists (select 1 from productos q where q.codigo = '300000');

-- próximo libre dentro de la familia: FF0001, FF0002…
create or replace function proximo_codigo_familia(e uuid, p_fam text) returns text
language plpgsql stable security definer set search_path = public as $$
declare n int := 0; cod text;
begin
  loop n := n + 1; cod := p_fam || lpad(n::text, 4, '0'); exit when not exists (select 1 from productos where empresa_id = e and codigo = cod); end loop;
  return cod;
end $$;

-- recodificar lo que no cumple: los x00000 de servicios (seña, envío, gift, varios) quedan como están (99 los contiene);
-- cambia: códigos no numéricos, y numéricos cuyo prefijo no es el de su categoría
do $$
declare r record; nuevo text; fam text;
begin
  for r in
    select p.id, p.empresa_id, p.codigo, c.codigo fam
    from productos p join categorias c on c.id = p.categoria_id
    where c.codigo is not null and p.tipo = 'prenda'
      and (p.codigo !~ '^\d{6}$' or left(p.codigo, 2) <> c.codigo)
    order by p.codigo
  loop
    nuevo := proximo_codigo_familia(r.empresa_id, r.fam);
    update productos set codigo = nuevo, descripcion = coalesce(descripcion || E'\n', '') || 'Código anterior: ' || r.codigo where id = r.id;
    update variantes set sku = nuevo || substring(sku from length(r.codigo) + 1) where producto_id = r.id and sku like r.codigo || '%';
    update variantes set sku = nuevo where producto_id = r.id and (sku is null or sku = '');
  end loop;
end $$;

-- variantes sin sku o con sku ajeno al código del producto: se normaliza a código[-talle][-color]
update variantes v set sku = s.sku_nuevo
from (select v2.id, p.codigo || coalesce('-' || t.codigo, '') || coalesce('-' || co.codigo, '') sku_nuevo, p.codigo
      from variantes v2 join productos p on p.id = v2.producto_id left join atributos t on t.id = v2.talle_id left join atributos co on co.id = v2.color_id) s
where s.id = v.id and (v.sku is null or v.sku = '' or v.sku not like s.codigo || '%');

select c.codigo fam, c.nombre, count(*) productos, count(*) filter (where left(p.codigo,2) <> c.codigo or p.codigo !~ '^\d{6}$') fuera_de_familia
from productos p join categorias c on c.id = p.categoria_id group by 1,2 order by 1;
