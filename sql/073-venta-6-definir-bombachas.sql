-- 073 · Venta #6 (23/10, FactuSOL 1306, 9 Bombis varias): se define con las bombachas que se bajaron de la web después de venderlas
-- (ajustes "Tienda Nube 24/10…" en bombachas + Less New Martina Fucsia del 27/10). Esos ajustes se devuelven: el stock final no cambia.
create temp table _aj as
select m.id, m.variante_id, -m.cantidad cant, m.deposito_id, m.empresa_id
from stock_movimientos m join variantes v on v.id = m.variante_id join productos p on p.id = v.producto_id join categorias c on c.id = p.categoria_id
where c.nombre = 'BOMBACHAS' and m.tipo = 'ajuste' and m.cantidad < 0
  and ((m.nota like 'Tienda Nube 24/10: lo de la web es lo que hay en el local%' and m.fecha::date = '2026-10-24')
    or (m.nota = 'Igual a Tienda Nube (27/10)' and p.codigo = '100159'));

select set_config('request.jwt.claims', '{"sub":"5f43c17d-958a-4ef7-badc-1a4001a20747","role":"authenticated"}', true);

do $$
declare lin record; res jsonb; tot numeric;
begin
  select sum(cant) into tot from _aj;
  if tot <> 9 then raise exception 'Se esperaban 9 unidades y hay %', tot; end if;
  select l.id linea_id, pd.desde_variante_id into lin from v_pendientes_definir pd join venta_lineas l on l.id = pd.linea_id join ventas v on v.id = l.venta_id where v.numero = 6 and l.descripcion = 'BOMBIS «VARIAS»';
  res := venta_definir(jsonb_build_object('linea_id', lin.linea_id, 'desde_variante_id', lin.desde_variante_id,
           'asignaciones', (select jsonb_agg(jsonb_build_object('variante_id', variante_id, 'cantidad', c)) from (select variante_id, sum(cant) c from _aj group by 1) x)));
  -- la baja que se hizo como ajuste era esta venta: se devuelve, así no se descuenta dos veces
  insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota)
  select empresa_id, variante_id, deposito_id, cant, 'ajuste', 'Devuelve el ajuste: era la venta #6 del 23/10 (se definió qué bombachas fueron)' from _aj;
  raise notice '%', res;
end $$;

select json_agg(x) from (select vv.producto_nombre, concat_ws(' · ', vv.talle_nombre, vv.color_nombre) var, a.cant vendidas, vv.stock stock_hoy
  from (select variante_id, sum(cant) cant from _aj group by 1) a join v_variantes vv on vv.id = a.variante_id order by 1) x;
