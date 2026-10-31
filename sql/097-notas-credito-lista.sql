-- 097 · Las notas de crédito emitidas antes de 096 toman la lista del cambio que las emitió (31/10/2026).
-- Hoy hay una sola: 8EE584CF ($2.000, cambio #72 a precio Contado).
update creditos c set lista_id = v.lista_id from ventas v where v.id = c.origen_venta_id and c.lista_id is null and c.tipo = 'nota_credito' and v.lista_id is not null;
select json_agg(json_build_object('codigo', c.codigo, 'monto', c.monto, 'lista', l.nombre)) from creditos c left join listas_precios l on l.id = c.lista_id;
