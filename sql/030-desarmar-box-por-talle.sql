-- 030 · Los boxes de TN tenían stock POR TALLE Y COLOR (box L/Celeste 2, L/Rosa 3…). Al desarmarlos (026) las unidades fueron a la
--       variante "sin definir" del pijama. Acá se reparten a su talle/color real según lo que decía TN en el último sync.
create or replace function box_repartir_sin_definir(p_kit_codigo text, p_comp_codigo text) returns int
language plpgsql security definer set search_path = public as $$
declare k productos%rowtype; comp productos%rowtype; r record; v_ind uuid; v_dest uuid; dep uuid; n int := 0; disponible numeric;
begin
  select * into k from productos where codigo = p_kit_codigo; select * into comp from productos where codigo = p_comp_codigo;
  if k.id is null or comp.id is null then return 0; end if;
  dep := (select id from depositos where empresa_id = k.empresa_id and principal limit 1);
  v_ind := variante_indefinida(comp.id);
  for r in
    select ci.talle_canal, ci.color_canal, ci.stock from canal_items ci
    where ci.producto_ext in (select ci2.producto_ext from canal_items ci2 join variantes v on v.id = ci2.variante_id where v.producto_id = k.id) and coalesce(ci.stock, 0) > 0
  loop
    disponible := coalesce((select sum(cantidad) from stock where variante_id = v_ind), 0);
    exit when disponible <= 0;
    select v.id into v_dest from variantes v left join atributos t on t.id = v.talle_id left join atributos co on co.id = v.color_id
    where v.producto_id = comp.id and v.activa and lower(t.nombre) = lower(split_part(r.talle_canal, '/', 1)) and lower(co.nombre) = lower(r.color_canal) limit 1;
    if v_dest is null then continue; end if;
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) values (k.empresa_id, v_ind, dep, -least(r.stock, disponible), 'ajuste', 'Box ' || k.nombre || ': era ' || r.talle_canal || ' / ' || r.color_canal);
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) values (k.empresa_id, v_dest, dep, least(r.stock, disponible), 'ajuste', 'Box ' || k.nombre || ': era ' || r.talle_canal || ' / ' || r.color_canal);
    n := n + least(r.stock, disponible)::int;
  end loop;
  -- si no quedó nada sin definir, esa variante se apaga
  if coalesce((select sum(cantidad) from stock where variante_id = v_ind), 0) = 0 then update variantes set activa = false where id = v_ind; end if;
  return n;
end $$;
select box_repartir_sin_definir('500245', '500123') cielo, box_repartir_sin_definir('500246', '500124') magnolia;
select p.codigo, p.nombre, coalesce(t.nombre,'sin definir') talle, coalesce(co.nombre,'') color, coalesce((select sum(cantidad) from stock s where s.variante_id=v.id),0)::int stock
from variantes v join productos p on p.id=v.producto_id left join atributos t on t.id=v.talle_id left join atributos co on co.id=v.color_id
where p.codigo in ('500123','500124') and (v.activa or coalesce((select sum(cantidad) from stock s where s.variante_id=v.id),0) <> 0) order by p.codigo, t.orden, t.nombre, co.nombre;
