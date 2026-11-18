-- 152 · Copia de las descripciones de Tienda Nube antes de cambiarlas en lote desde Percha (18/11/2026: se sacó el renglón
-- viejo «+ Ver más …» de 697 publicaciones). Para volver atrás: PUT /products/{producto_ext} con esta descripción.
create table if not exists tn_descripciones_respaldo (
  id bigserial primary key,
  conexion_id uuid not null,
  producto_ext text not null,
  descripcion text,
  motivo text,
  creado timestamptz not null default now()
);
alter table tn_descripciones_respaldo enable row level security;   -- solo las funciones (service role)
