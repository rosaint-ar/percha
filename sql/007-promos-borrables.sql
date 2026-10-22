-- Una promoción usada en ventas se puede borrar: la venta conserva el nombre de la promo (promocion_nombre)
alter table venta_lineas drop constraint if exists venta_lineas_promocion_id_fkey;
alter table venta_lineas add constraint venta_lineas_promocion_id_fkey foreign key (promocion_id) references promociones(id) on delete set null;
