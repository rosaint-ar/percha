-- 146 · 13/11 (Diego): «al enviar las fotos de Percha a la web se duplicaron muchísimas».
-- Causa: tn-publicar corre cada minuto y una vuelta de subir fotos tarda más de un minuto → dos vueltas a la vez subían
-- la misma foto (pares idénticos, mismo segundo). La segunda copia no quedaba anotada y la sincronización de vuelta
-- la traía a Percha como foto «de la web».
-- Arreglo: un candado por conexión (solo una vuelta sube fotos a la vez; se suelta solo a los 5 min si algo se corta)
-- y, antes de subir, se mira si la foto ya está en la publicación (mismo archivo) → se anota en vez de subirla otra vez.
alter table conexiones add column if not exists fotos_subiendo_hasta timestamptz;
