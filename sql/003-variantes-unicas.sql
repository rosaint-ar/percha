-- La unicidad de la variante debe tratar los NULL como iguales (sin estampa = sin estampa),
-- si no, cada migración repetida duplica variantes.
alter table variantes drop constraint if exists variantes_producto_id_talle_id_color_id_estampa_id_key;
alter table variantes add constraint variantes_unicas unique nulls not distinct (producto_id, talle_id, color_id, estampa_id);
