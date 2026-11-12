-- 124 · PERCHA MANDA EN LOS CÓDIGOS (12/11, Diego: "percha manda, y modifica en tienda nube automáticamente").
-- La función tn-codigos (deploy --no-verify-jwt, entra con x-cron-key) lee los códigos EN VIVO de Tienda Nube y a cada
-- variante cruzada con una prenda de Percha le pone SKU = MPN = código de la prenda (como tn-publicar). No toca lo cruzado
-- con un código general ni lo que no está cruzado. Hasta 150 cambios por vuelta (~2 por segundo, lo que deja la web).
-- Arranque 12/11: 1.944 variantes con código distinto (bombachas con 100200, medias con 900203, códigos de otras prendas).
-- Antes, el mismo día: se eliminó LESS «PIA» BORGOÑA ALGODÓN 100514 (código general creado por error, sin stock ni ventas).
select cron.unschedule('percha_tn_codigos') where exists (select 1 from cron.job where jobname = 'percha_tn_codigos');
select cron.schedule('percha_tn_codigos', '*/10 * * * *', $$select cron_llamar('tn-codigos')$$);
