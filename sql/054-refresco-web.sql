-- 054 · Stock compartido: una vez por hora Percha mira qué está visible en la web y con cuánto stock (27/10/2026)
--   Lo oculto en Tienda Nube (publicaciones viejas o pausadas) no recibe stock de Percha.
alter table conexiones add column if not exists ultimo_refresco_web timestamptz;
