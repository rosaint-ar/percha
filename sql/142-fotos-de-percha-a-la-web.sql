-- 142 · 12/11 (Diego: «¿las fotos que subo en Percha no se llevan a la web?»). Ahora sí: tn-publicar (cada minuto, de a 25)
-- sube las fotos cargadas en Percha (origen manual) a las publicaciones de su prenda. Las que creó Percha reciben todas;
-- las publicaciones viejas, solo las fotos nuevas (desde el 12/11 23:15 UTC: las anteriores ya estaban cargadas a mano).
-- Foto por color → a la publicación con ese color y, si esas opciones no tenían foto, pasa a ser la suya.
-- producto_fotos.web = {publicación: id de la imagen en la web} ({} = revisada, no va a ninguna); la sincronización de
-- vuelta (web → Percha) no la duplica. Borrar una foto en Percha NO la borra de la web (eso, a mano en Tienda Nube).
alter table producto_fotos add column if not exists web jsonb;
