-- 017 · Productos genéricos ("BOMBIS VARIAS"): se venden rápido en el POS y, al cobrar, se pregunta qué modelos se lleva la clienta.
alter table productos add column if not exists es_generico boolean not null default false;
update productos set es_generico = true where codigo in ('100200', '100300', '100500', '900203') and es_generico = false;
select codigo, nombre from productos where es_generico order by codigo;
