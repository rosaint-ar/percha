-- 031 · Arranque real (23/10): se borran las ventas de prueba, se cargan los remitos de FactuSOL del 22/10 y la numeración empieza de 1.
-- 1) pruebas afuera (todas anuladas): ventas 1-8 con líneas, pagos, movimientos de stock (venta + anulación, suman 0), turnos y crédito de prueba
delete from stock_movimientos where referencia in (select id::text from ventas where numero <= 8 and estado = 'anulada');
delete from venta_pagos where venta_id in (select id from ventas where numero <= 8 and estado = 'anulada');
delete from venta_lineas where venta_id in (select id from ventas where numero <= 8 and estado = 'anulada');
delete from canal_pedidos where venta_id in (select id from ventas where numero <= 8 and estado = 'anulada');
delete from creditos where codigo = '08644A26';
delete from ventas where numero <= 8 and estado = 'anulada';
delete from caja_movimientos;
delete from caja_turnos;
-- 2) remitos de FactuSOL del 22/10 (ventas por WhatsApp, contado por transferencia) como ventas de Percha
select set_config('request.jwt.claims', '{"sub":"5f43c17d-958a-4ef7-badc-1a4001a20747","role":"authenticated"}', false);
select set_config('role', 'authenticated', false);
update ventas set numero = 1000 where numero = 9;   -- la de TN se renumera al final
update secuencias set valor = 0 where nombre = 'venta';
with c1 as (insert into clientes (empresa_id, nombre, telefono) values ('82c05bbf-e63e-4d25-a762-6f1ee6d27f43', 'Clienta WhatsApp +54 9 11 6441-0722', '+54 9 11 6441-0722') returning id)
select caja_registrar_venta(jsonb_build_object('empresa_id','82c05bbf-e63e-4d25-a762-6f1ee6d27f43','offline_id',gen_random_uuid(),'tipo','venta','estado','completada','cliente_id',(select id from c1),
  'lista_id','1c43546f-a0fd-446d-a4bf-d0654b90c7d4','descuento_pct',0,'descuento',2,'recargo',0,'origen','factusol','referencia','1303','nota','FactuSOL remito 1303 · 22/10 20:22 · ONLINE-CONTADO (WhatsApp)',
  'lineas', jsonb_build_array(
     jsonb_build_object('variante_id','6a84a8c4-450a-4bcb-bce0-023bbfa1fe41','producto_id','abb2f171-32fc-4b0d-82ce-f9e4a3d754a2','descripcion','PIJAMA «CIELO»','talle','XL','color','Rosa','cantidad',1,'precio_lista',59990,'precio_unit',47992,'descuento_pct',0,'total',47992,'costo_unit',22000),
     jsonb_build_object('variante_id','077d9605-8fad-46e2-8b7a-a5a53500e85b','producto_id','f27f3521-73ff-4fb7-b340-675f96d63ee2','descripcion','Envío','talle',null,'color',null,'cantidad',1,'precio_lista',6000,'precio_unit',6000,'descuento_pct',0,'total',6000,'costo_unit',3020)),
  'pagos', jsonb_build_array(jsonb_build_object('forma_pago_id','25ff43aa-7f2d-4d38-a8c1-4570674ea0e7','credito_id',null,'monto',53990,'cuotas',1,'recargo_pct',0)), 'creditos_a_emitir', '[]'::jsonb)) r1303;
with c2 as (insert into clientes (empresa_id, nombre, telefono) values ('82c05bbf-e63e-4d25-a762-6f1ee6d27f43', 'Clienta WhatsApp 54 9 3585 60-9827', '54 9 3585 60-9827') returning id)
select caja_registrar_venta(jsonb_build_object('empresa_id','82c05bbf-e63e-4d25-a762-6f1ee6d27f43','offline_id',gen_random_uuid(),'tipo','venta','estado','completada','cliente_id',(select id from c2),
  'lista_id','1c43546f-a0fd-446d-a4bf-d0654b90c7d4','descuento_pct',0,'descuento',6,'recargo',0,'origen','factusol','referencia','1304','nota','FactuSOL remito 1304 · 22/10 20:24 · ONLINE-CONTADO (WhatsApp)',
  'lineas', jsonb_build_array(
     jsonb_build_object('variante_id','3b5032a8-12fa-49d7-b4f3-2cfd01566ba3','producto_id','abb2f171-32fc-4b0d-82ce-f9e4a3d754a2','descripcion','PIJAMA «CIELO»','talle','L','color','Celeste','cantidad',3,'precio_lista',59990,'precio_unit',47992,'descuento_pct',0,'total',143976,'costo_unit',22000)),
  'pagos', jsonb_build_array(jsonb_build_object('forma_pago_id','25ff43aa-7f2d-4d38-a8c1-4570674ea0e7','credito_id',null,'monto',143970,'cuotas',1,'recargo_pct',0)), 'creditos_a_emitir', '[]'::jsonb)) r1304;
-- fecha real del remito
update ventas set fecha = '2026-10-22 20:22-03' where origen = 'factusol' and referencia = '1303';
update ventas set fecha = '2026-10-22 20:24-03' where origen = 'factusol' and referencia = '1304';
-- la de Tienda Nube pasa a ser la #3
update ventas set numero = 3 where numero = 1000; update secuencias set valor = 3 where nombre = 'venta';
-- 3) el conteo de Emi ya tenía descontadas estas ventas: Cielo XL Rosa y L Celeste vuelven a lo contado (0 y 0)
insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota)
select v.empresa_id, v.id, (select id from depositos where principal limit 1), -coalesce((select sum(cantidad) from stock s where s.variante_id = v.id), 0), 'ajuste', 'Conteo físico de Emi 23/10: ya incluía los remitos 1303/1304'
from variantes v where v.id in ('6a84a8c4-450a-4bcb-bce0-023bbfa1fe41', '3b5032a8-12fa-49d7-b4f3-2cfd01566ba3') and coalesce((select sum(cantidad) from stock s where s.variante_id = v.id), 0) <> 0;
select v.numero, v.estado, v.origen, v.referencia, v.fecha, v.total::int, c.nombre cliente from ventas v left join clientes c on c.id = v.cliente_id order by v.numero;
