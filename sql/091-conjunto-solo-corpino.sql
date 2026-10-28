-- 091 · "Solo corpiño" (28/10/2026, pedido de Diego): un conjunto se puede vender sin la bombacha.
-- En el ticket, un toque agrega el renglón "Bombacha del conjunto → local" en −1 con −$5.000 (editable en el renglón):
-- el conjunto sale entero del stock y su bombacha entra a BOMBIS «LOCAL» (no está en la web). La venta sigue siendo una venta.
-- Genérico para el rubro: empresas.config.sin_parte = { categoria_id, boton, texto, variante_id (la que recibe la pieza), monto }.
update empresas set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('sin_parte', jsonb_build_object(
  'categoria_id', 'dbf22e3b-9175-4d5c-a8ec-970f9c00359d',          -- CONJUNTOS
  'boton', 'Solo corpiño',
  'texto', 'Bombacha del conjunto → local',
  'variante_id', '53993113-dab5-4a43-b673-919623f3c5a0',          -- BOMBIS «LOCAL» (100461)
  'monto', 5000))
where id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43';

select config->'sin_parte' from empresas where id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43';
