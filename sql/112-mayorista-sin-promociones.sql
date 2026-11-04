-- 112 · Mayorista: sin promociones (03/11/2026, Diego: "que no valgan en mayorista").
-- Las promociones por cantidad, N×M, % o $ off se eligen por lista una por una; con esta marca, una lista no toma NINGUNA
-- (tampoco las que se creen después). Igual que "toma_rebajas" para las ofertas: Mayorista ya parte del precio sin oferta.
begin;
alter table listas_precios add column if not exists toma_promos boolean not null default true;
update listas_precios set toma_promos = false where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and nombre = 'Mayorista';
select nombre, toma_rebajas, toma_promos from listas_precios where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' order by orden;
commit;
