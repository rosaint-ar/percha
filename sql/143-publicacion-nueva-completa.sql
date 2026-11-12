-- 143 · 12/11 (Diego): lo que Percha sube a la web como prenda NUEVA va completo, como las demás de la tienda:
-- categorías (las de la prenda más parecida ya publicada: primero la misma prenda en otra publicación, después su familia
-- en Percha, después todo el catálogo; sin Rebajas/Favoritos; Regulables, Elástico ancho, Algodón, Puntilla, Colaless,
-- Vedetinas… solo si el nombre lo dice; «Talles grandes» de su rama si llega a 2XL/3XL), marca, título y descripción
-- para Google, «adulto / mujer» en las opciones (tn-publicar · completarPublicacion; a mano: {completar: true}).
-- NUEVOS INGRESOS: categoría «Nuevos Ingresos» + etiqueta «nuevos-ingresos» por 30 días (canal_items.nuevo_hasta);
-- tn-publicar las saca solo todos los días a las 9 UTC ({vencer_nuevos: true} a mano).
alter table canal_items add column if not exists nuevo_hasta timestamptz;
