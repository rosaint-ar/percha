-- 095 · Pantuflones animados por talle (y color) como la web (28/10/2026, Diego: "sí, corregí las dos cosas").
-- Antes: T.2 (37 al 40) y T.3 (41 al 43) de la web iban juntos a una variante "sin talle"; Capibara iba solo por color y
-- Winnie Pooh en una sola variante. Ahora cada talle (y color) de la web tiene su variante. Nada se borra: las variantes que
-- sobran (todas en 0) se apagan. El stock total no cambia. También: Pantubota «WINTER» Negro 39/40 a $30.000 (estaba en $3.000.030.000, igual en la web: ya corregida).
begin;
update variantes set precio = 30000 where id = '3eb2420d-2b9a-4121-8bb6-7ffd99328fc7' and precio > 1000000;
update canal_items set precio = 30000, actualizado = now() where id = 1213;

update canal_items set variante_id = '703e13a3-121a-4b5e-be23-f153ae933211', cruce = 'manual', actualizado = now() where id = 2086;  -- PANTUFLON «CHANCHITO» T.3 (41 al 43)
update canal_items set variante_id = '3631c2a2-beae-4cf8-9e83-ced6f3d84963', cruce = 'manual', actualizado = now() where id = 2085;  -- PANTUFLON «CHANCHITO» T. 2 (37 al 40)
update canal_items set variante_id = 'b772bd87-f3de-4a34-9d3e-0ce794d2ec51', cruce = 'manual', actualizado = now() where id = 2101;  -- PANTUFLON «HAMBURGUESA» T.3 (41 al 43)
update canal_items set variante_id = 'a3af98eb-2a33-4340-bdbd-b7ff323878b7', cruce = 'manual', actualizado = now() where id = 2100;  -- PANTUFLON «HAMBURGUESA» T. 2 (37 al 40)
update canal_items set variante_id = 'c22776a6-55c9-4216-a86b-62ed213cd613', cruce = 'manual', actualizado = now() where id = 2090;  -- PANTUFLON «KITTY» T. 2 (37 al 40)
update canal_items set variante_id = '65f151d5-7973-4e7d-ab54-ecd91947ea94', cruce = 'manual', actualizado = now() where id = 2091;  -- PANTUFLON «KITTY» T. 3 (41 al 43)
update canal_items set variante_id = '44422588-2cf9-4132-af45-7854b0acb965', cruce = 'manual', actualizado = now() where id = 3271;  -- PANTUFLON «PAPAS FRITAS» T. 2 (37 al 40)
update canal_items set variante_id = '110866a1-5a6c-4187-9599-ebae9a1af09b', cruce = 'manual', actualizado = now() where id = 3272;  -- PANTUFLON «PAPAS FRITAS» T. 3 (41 al 43)
update canal_items set variante_id = 'b9397439-ff5a-4329-8f2b-051009f6190c', cruce = 'manual', actualizado = now() where id = 4078;  -- PANTUFLON «PERRITO» T.3 (41 al 43)
update canal_items set variante_id = '041989e6-8c5c-45af-85ab-89fa4fd02a07', cruce = 'manual', actualizado = now() where id = 4077;  -- PANTUFLON «PERRITO» T. 2 (37 al 40)
update canal_items set variante_id = 'fcd1dc56-bfb1-4b0e-a280-5255ca79b05b', cruce = 'manual', actualizado = now() where id = 2462;  -- PANTUFLON «SELECCIÓN» T. 2 (37 al 40)
update canal_items set variante_id = '75551562-7d3a-4207-a2dd-8d153bb4514b', cruce = 'manual', actualizado = now() where id = 2463;  -- PANTUFLON «SELECCIÓN» T. 3 (41 al 43)
update canal_items set variante_id = '8eac54ef-eeda-4ea6-912f-ddbca4c2717d', cruce = 'manual', actualizado = now() where id = 2171;  -- PANTUFLON «STITCH» T. 3 (41 al 43)
update canal_items set variante_id = '80940dd9-a332-44f8-a4eb-3e39beebead7', cruce = 'manual', actualizado = now() where id = 2170;  -- PANTUFLON «STITCH» T. 2 (37 al 40)
update canal_items set variante_id = '17ffd5a3-e575-41c1-bd71-5e140251a5d8', cruce = 'manual', actualizado = now() where id = 2096;  -- PANTUFLON «UNICORNIO» T. 3 (41 al 43)
update canal_items set variante_id = '472f3767-00c3-40d9-98b8-85e35c908072', cruce = 'manual', actualizado = now() where id = 2095;  -- PANTUFLON «UNICORNIO» T. 2 (37 al 40)
update canal_items set variante_id = 'cc1dd32c-a6a5-4f5a-aee5-04c1f0efc747', cruce = 'manual', actualizado = now() where id = 3474;  -- PANTUFLON «VAQUITA» T. 2 (37 al 40)
update canal_items set variante_id = '4b2c1287-2c33-4321-bd35-6537100e4f12', cruce = 'manual', actualizado = now() where id = 3475;  -- PANTUFLON «VAQUITA» T. 3 (41 al 43)
update canal_items set variante_id = 'b3f3ad75-6f7d-4610-8de1-32009f1962e6', cruce = 'manual', actualizado = now() where id = 2080;  -- PANTUFLON «GATITO» NEGRO T. 2 (37 al 40)
update canal_items set variante_id = 'e7b8bd86-8438-43f8-b360-5d41934bd154', cruce = 'manual', actualizado = now() where id = 2081;  -- PANTUFLON «GATITO» NEGRO T. 3 (41 al 43)
update variantes set color_id = '010a7f29-27e9-4946-8ac0-8c351e69eed2', sku = '910109-BAB-CAM' where id = 'b8e99356-a761-458f-a452-885c91aa50d2';  -- Capibara 26 al 29 → Camel
insert into variantes (empresa_id, producto_id, talle_id, color_id, sku) values ('82c05bbf-e63e-4d25-a762-6f1ee6d27f43', '9c1b0bc4-bd36-49ba-a511-e6976626e086', '845c20ef-a098-42b5-b395-40ecf6c8ee1f', 'b1123240-c606-480b-bcd6-54db944f23d0', '910109-BAB-MAR');  -- Capibara 26 al 29 Marrón oscuro
update variantes set color_id = '010a7f29-27e9-4946-8ac0-8c351e69eed2', sku = '910109-KID-CAM' where id = '61d4da33-fcba-4f6c-9478-c811f1258637';  -- Capibara 30 al 33 → Camel
insert into variantes (empresa_id, producto_id, talle_id, color_id, sku) values ('82c05bbf-e63e-4d25-a762-6f1ee6d27f43', '9c1b0bc4-bd36-49ba-a511-e6976626e086', '6d95a67a-0ac0-421d-a730-632c7c93eb22', 'b1123240-c606-480b-bcd6-54db944f23d0', '910109-KID-MAR');  -- Capibara 30 al 33 Marrón oscuro
update variantes set color_id = '010a7f29-27e9-4946-8ac0-8c351e69eed2', sku = '910109-T.1-CAM' where id = 'ba80713a-d6d1-4f5a-8ac7-ff1772b3490f';  -- Capibara 34 al 36 → Camel
insert into variantes (empresa_id, producto_id, talle_id, color_id, sku) values ('82c05bbf-e63e-4d25-a762-6f1ee6d27f43', '9c1b0bc4-bd36-49ba-a511-e6976626e086', '92c1ab69-4709-4c9d-898d-ce2a9528872c', 'b1123240-c606-480b-bcd6-54db944f23d0', '910109-T.1-MAR');  -- Capibara 34 al 36 Marrón oscuro
update variantes set color_id = '010a7f29-27e9-4946-8ac0-8c351e69eed2', sku = '910109-T.2-CAM' where id = 'da2edb02-9d25-412a-ad66-7f05bfc0e25f';  -- Capibara 37 al 39 → Camel
insert into variantes (empresa_id, producto_id, talle_id, color_id, sku) values ('82c05bbf-e63e-4d25-a762-6f1ee6d27f43', '9c1b0bc4-bd36-49ba-a511-e6976626e086', '50235cfc-ecd7-4ebc-88da-88899b79ffc1', 'b1123240-c606-480b-bcd6-54db944f23d0', '910109-T.2-MAR');  -- Capibara 37 al 39 Marrón oscuro
update variantes set color_id = '010a7f29-27e9-4946-8ac0-8c351e69eed2', sku = '910109-T.3-CAM' where id = '046ea1b4-7cb4-4c13-b4a0-cf9c5bce666d';  -- Capibara 40 al 42 → Camel
insert into variantes (empresa_id, producto_id, talle_id, color_id, sku) values ('82c05bbf-e63e-4d25-a762-6f1ee6d27f43', '9c1b0bc4-bd36-49ba-a511-e6976626e086', 'ea39f6fa-5cca-49b5-bc5d-e323f0582240', 'b1123240-c606-480b-bcd6-54db944f23d0', '910109-T.3-MAR');  -- Capibara 40 al 42 Marrón oscuro
update canal_items set variante_id = (select id from variantes where producto_id = '9c1b0bc4-bd36-49ba-a511-e6976626e086' and talle_id = '6d95a67a-0ac0-421d-a730-632c7c93eb22' and color_id = 'b1123240-c606-480b-bcd6-54db944f23d0'), cruce = 'manual', actualizado = now() where id = 3260;  -- Kids (30 al 33) / Marrón oscuro
update canal_items set variante_id = (select id from variantes where producto_id = '9c1b0bc4-bd36-49ba-a511-e6976626e086' and talle_id = '845c20ef-a098-42b5-b395-40ecf6c8ee1f' and color_id = 'b1123240-c606-480b-bcd6-54db944f23d0'), cruce = 'manual', actualizado = now() where id = 3258;  -- Baby (26 al 29) / Marrón oscuro
update canal_items set variante_id = (select id from variantes where producto_id = '9c1b0bc4-bd36-49ba-a511-e6976626e086' and talle_id = '92c1ab69-4709-4c9d-898d-ce2a9528872c' and color_id = 'b1123240-c606-480b-bcd6-54db944f23d0'), cruce = 'manual', actualizado = now() where id = 3262;  -- T. 1 (34 al 36) / Marrón oscuro
update canal_items set variante_id = (select id from variantes where producto_id = '9c1b0bc4-bd36-49ba-a511-e6976626e086' and talle_id = '50235cfc-ecd7-4ebc-88da-88899b79ffc1' and color_id = 'b1123240-c606-480b-bcd6-54db944f23d0'), cruce = 'manual', actualizado = now() where id = 3264;  -- T. 2 (37 al 40) / Marrón oscuro
update canal_items set variante_id = (select id from variantes where producto_id = '9c1b0bc4-bd36-49ba-a511-e6976626e086' and talle_id = 'ea39f6fa-5cca-49b5-bc5d-e323f0582240' and color_id = 'b1123240-c606-480b-bcd6-54db944f23d0'), cruce = 'manual', actualizado = now() where id = 3266;  -- T. 3 (41 al 43) / Marrón oscuro
update canal_items set variante_id = (select id from variantes where producto_id = '9c1b0bc4-bd36-49ba-a511-e6976626e086' and talle_id = '845c20ef-a098-42b5-b395-40ecf6c8ee1f' and color_id = '010a7f29-27e9-4946-8ac0-8c351e69eed2'), cruce = 'manual', actualizado = now() where id = 3259;  -- Baby (26 al 29) / Camel
update canal_items set variante_id = (select id from variantes where producto_id = '9c1b0bc4-bd36-49ba-a511-e6976626e086' and talle_id = '6d95a67a-0ac0-421d-a730-632c7c93eb22' and color_id = '010a7f29-27e9-4946-8ac0-8c351e69eed2'), cruce = 'manual', actualizado = now() where id = 3261;  -- Kids (30 al 33) / Camel
update canal_items set variante_id = (select id from variantes where producto_id = '9c1b0bc4-bd36-49ba-a511-e6976626e086' and talle_id = '92c1ab69-4709-4c9d-898d-ce2a9528872c' and color_id = '010a7f29-27e9-4946-8ac0-8c351e69eed2'), cruce = 'manual', actualizado = now() where id = 3263;  -- T. 1 (34 al 36) / Camel
update canal_items set variante_id = (select id from variantes where producto_id = '9c1b0bc4-bd36-49ba-a511-e6976626e086' and talle_id = '50235cfc-ecd7-4ebc-88da-88899b79ffc1' and color_id = '010a7f29-27e9-4946-8ac0-8c351e69eed2'), cruce = 'manual', actualizado = now() where id = 3265;  -- T. 2 (37 al 40) / Camel
update canal_items set variante_id = (select id from variantes where producto_id = '9c1b0bc4-bd36-49ba-a511-e6976626e086' and talle_id = 'ea39f6fa-5cca-49b5-bc5d-e323f0582240' and color_id = '010a7f29-27e9-4946-8ac0-8c351e69eed2'), cruce = 'manual', actualizado = now() where id = 3267;  -- T. 3 (41 al 43) / Camel
insert into variantes (empresa_id, producto_id, talle_id, sku) values ('82c05bbf-e63e-4d25-a762-6f1ee6d27f43', '1609abbd-a7a0-43c3-887f-1caee483fbc2', '845c20ef-a098-42b5-b395-40ecf6c8ee1f', '910121-BAB');  -- Winnie 26 al 29
insert into variantes (empresa_id, producto_id, talle_id, sku) values ('82c05bbf-e63e-4d25-a762-6f1ee6d27f43', '1609abbd-a7a0-43c3-887f-1caee483fbc2', '6d95a67a-0ac0-421d-a730-632c7c93eb22', '910121-KID');  -- Winnie 30 al 33
insert into variantes (empresa_id, producto_id, talle_id, sku) values ('82c05bbf-e63e-4d25-a762-6f1ee6d27f43', '1609abbd-a7a0-43c3-887f-1caee483fbc2', '92c1ab69-4709-4c9d-898d-ce2a9528872c', '910121-T.1');  -- Winnie 34 al 36
insert into variantes (empresa_id, producto_id, talle_id, sku) values ('82c05bbf-e63e-4d25-a762-6f1ee6d27f43', '1609abbd-a7a0-43c3-887f-1caee483fbc2', '50235cfc-ecd7-4ebc-88da-88899b79ffc1', '910121-T.2');  -- Winnie 37 al 39
insert into variantes (empresa_id, producto_id, talle_id, sku) values ('82c05bbf-e63e-4d25-a762-6f1ee6d27f43', '1609abbd-a7a0-43c3-887f-1caee483fbc2', 'ea39f6fa-5cca-49b5-bc5d-e323f0582240', '910121-T.3');  -- Winnie 40 al 42
update canal_items set variante_id = (select id from variantes where producto_id = '1609abbd-a7a0-43c3-887f-1caee483fbc2' and talle_id = '845c20ef-a098-42b5-b395-40ecf6c8ee1f'), cruce = 'manual', actualizado = now() where id = 2184;  -- Winnie Baby  (28 al 30)
update canal_items set variante_id = (select id from variantes where producto_id = '1609abbd-a7a0-43c3-887f-1caee483fbc2' and talle_id = 'ea39f6fa-5cca-49b5-bc5d-e323f0582240'), cruce = 'manual', actualizado = now() where id = 2188;  -- Winnie T. 3 (41 al 43)
update canal_items set variante_id = (select id from variantes where producto_id = '1609abbd-a7a0-43c3-887f-1caee483fbc2' and talle_id = '6d95a67a-0ac0-421d-a730-632c7c93eb22'), cruce = 'manual', actualizado = now() where id = 2185;  -- Winnie Kids (31 al 33)
update canal_items set variante_id = (select id from variantes where producto_id = '1609abbd-a7a0-43c3-887f-1caee483fbc2' and talle_id = '92c1ab69-4709-4c9d-898d-ce2a9528872c'), cruce = 'manual', actualizado = now() where id = 2186;  -- Winnie T. 1 (34 al 36)
update canal_items set variante_id = (select id from variantes where producto_id = '1609abbd-a7a0-43c3-887f-1caee483fbc2' and talle_id = '50235cfc-ecd7-4ebc-88da-88899b79ffc1'), cruce = 'manual', actualizado = now() where id = 2187;  -- Winnie T. 2 (37 al 40)

-- el stock de Capibara pasa a su talle y color (queda registrado como movimiento)
select set_config('request.jwt.claims', '{"sub":"5f43c17d-958a-4ef7-badc-1a4001a20747","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
perform stock_mover('78ecf7ea-f965-485d-8d56-03da52489454', (select id from variantes where producto_id = '9c1b0bc4-bd36-49ba-a511-e6976626e086' and talle_id = '6d95a67a-0ac0-421d-a730-632c7c93eb22' and color_id = '010a7f29-27e9-4946-8ac0-8c351e69eed2'), 1, 'Capibara por talle y color, como la web: Kids (30 al 33) Camel');
perform stock_mover('c72dc9d8-d0a2-417c-be2a-11392bd658fd', (select id from variantes where producto_id = '9c1b0bc4-bd36-49ba-a511-e6976626e086' and talle_id = '6d95a67a-0ac0-421d-a730-632c7c93eb22' and color_id = 'b1123240-c606-480b-bcd6-54db944f23d0'), 2, 'Capibara por talle y color, como la web: Kids (30 al 33) Marrón oscuro');
end $$;
reset role;

-- variantes que sobran (todas en 0): se apagan
update variantes set activa = false where id = 'c1640385-6a3c-4e12-97b8-ab085e0d0530' and coalesce((select sum(cantidad) from stock s where s.variante_id = variantes.id), 0) = 0;  -- PANTUFLÓN «CHANCHITO» sin talle
update variantes set activa = false where id = '031cce9a-a297-4464-9c56-2683438ab6e3' and coalesce((select sum(cantidad) from stock s where s.variante_id = variantes.id), 0) = 0;  -- PANTUFLÓN «HAMBURGUESA» sin talle
update variantes set activa = false where id = 'b5b39a7f-6cb4-4194-9e9d-0ad5a327a704' and coalesce((select sum(cantidad) from stock s where s.variante_id = variantes.id), 0) = 0;  -- PANTUFLÓN «KITTY» sin talle
update variantes set activa = false where id = '0fdfdc8a-5446-441a-abd8-403ee2d4b68a' and coalesce((select sum(cantidad) from stock s where s.variante_id = variantes.id), 0) = 0;  -- PANTUFLÓN «PAPAS FRITAS» sin talle
update variantes set activa = false where id = '1ad28e7f-2107-4368-85bc-9f75435b5c6e' and coalesce((select sum(cantidad) from stock s where s.variante_id = variantes.id), 0) = 0;  -- PANTUFLÓN «PERRITO» sin talle
update variantes set activa = false where id = 'ba56f8fd-554d-41d3-b2ab-44ab8635fddd' and coalesce((select sum(cantidad) from stock s where s.variante_id = variantes.id), 0) = 0;  -- PANTUFLÓN «PERRITO» 35/36 (publicación oculta)
update variantes set activa = false where id = 'd8c5adbc-c031-4abf-a840-8cb89a17e985' and coalesce((select sum(cantidad) from stock s where s.variante_id = variantes.id), 0) = 0;  -- PANTUFLÓN «PERRITO» 37/38 (publicación oculta)
update variantes set activa = false where id = '997e6ae0-cde5-4897-9d2c-c92142d339d7' and coalesce((select sum(cantidad) from stock s where s.variante_id = variantes.id), 0) = 0;  -- PANTUFLÓN «PERRITO» 39/40 (publicación oculta)
update variantes set activa = false where id = '71e217d8-a17d-4670-b8e9-2c48af3982ea' and coalesce((select sum(cantidad) from stock s where s.variante_id = variantes.id), 0) = 0;  -- PANTUFLÓN «SELECCIÓN» sin talle
update variantes set activa = false where id = 'df49724e-a067-4702-833b-3cc49263a8e6' and coalesce((select sum(cantidad) from stock s where s.variante_id = variantes.id), 0) = 0;  -- PANTUFLÓN «STITCH» sin talle
update variantes set activa = false where id = 'a2f44de3-a358-4d6b-8117-30128ca02019' and coalesce((select sum(cantidad) from stock s where s.variante_id = variantes.id), 0) = 0;  -- PANTUFLÓN «UNICORNIO» sin talle
update variantes set activa = false where id = 'e570110b-59d9-479e-8830-9f0a1bb2c860' and coalesce((select sum(cantidad) from stock s where s.variante_id = variantes.id), 0) = 0;  -- PANTUFLÓN «VAQUITA» sin talle
update variantes set activa = false where id = '22b2ed92-0a70-46f5-ace3-c8805a5f0e81' and coalesce((select sum(cantidad) from stock s where s.variante_id = variantes.id), 0) = 0;  -- PANTUFLÓN «VAQUITA» 35/36 (publicación oculta)
update variantes set activa = false where id = '6390851c-ab3d-4bda-8f67-d60b81529803' and coalesce((select sum(cantidad) from stock s where s.variante_id = variantes.id), 0) = 0;  -- PANTUFLÓN «VAQUITA» 37/38 (publicación oculta)
update variantes set activa = false where id = '73c485ac-0bfc-48ff-bdf5-0a0f405d10c7' and coalesce((select sum(cantidad) from stock s where s.variante_id = variantes.id), 0) = 0;  -- PANTUFLÓN «VAQUITA» 39/40 (publicación oculta)
update variantes set activa = false where id = '8549b244-19e0-4a66-9f89-d0dcc0226ce2' and coalesce((select sum(cantidad) from stock s where s.variante_id = variantes.id), 0) = 0;  -- PANTUFLÓN «GATITO» NEGRO sin talle
update variantes set activa = false where id = '78ecf7ea-f965-485d-8d56-03da52489454' and coalesce((select sum(cantidad) from stock s where s.variante_id = variantes.id), 0) = 0;  -- Capibara Camel sin talle
update variantes set activa = false where id = 'c72dc9d8-d0a2-417c-be2a-11392bd658fd' and coalesce((select sum(cantidad) from stock s where s.variante_id = variantes.id), 0) = 0;  -- Capibara Marrón oscuro sin talle
update variantes set activa = false where id = 'b7e24836-6bd3-4248-a997-5bcd4ab63362' and coalesce((select sum(cantidad) from stock s where s.variante_id = variantes.id), 0) = 0;  -- Capibara 43 al 46 (la web no lo tiene)
update variantes set activa = false where id = '12c497a1-1156-4e4a-b632-9de7dd430de8' and coalesce((select sum(cantidad) from stock s where s.variante_id = variantes.id), 0) = 0;  -- Winnie Pooh sin talle
update productos set tiene_variantes = true where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and codigo in ('910109','910110','910113','910114','910115','910116','910117','910118','910119','910120','910121','910123');

-- la web se entera (los números ya coinciden; es para que el cruce nuevo quede al día)
select encolar_canal('82c05bbf-e63e-4d25-a762-6f1ee6d27f43', v.id) from variantes v join productos p on p.id = v.producto_id where p.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and p.codigo in ('910109','910110','910113','910114','910115','910116','910117','910118','910119','910120','910121','910123') and v.activa;
commit;
