# Versiones de Percha

## `percha-base-2026-11-17` — versión base (genérica)

Marcada el 17/11/2026 a pedido de Diego. Es la última versión de Percha pensada para **cualquier tienda**.
Desde acá en adelante se hacen personalizaciones para Augusta que pueden no servir a otras tiendas.
Cuando se quiera volver a esta versión, se menciona por su nombre: **percha-base-2026-11-17**.

### Qué incluye

- **Código**: este repositorio en la etiqueta git `percha-base-2026-11-17` (pantallas, `shared/`, `shell/`,
  funciones de Supabase en `supabase/functions/` y migraciones `sql/001` a `sql/149`).
- **Funciones desplegadas en Supabase** (proyecto `ooqcdpxehcehuofolefq`), versiones de ese día:
  tn-publicar v20, tn-sincronizar v9, tn-sync v12, tn-push v18, tn-pedidos v17, tn-codigos v4, tn-precios v5,
  tn-callback v5, tn-conectar v2, tn-cupon v2, web-novedades v1, avisos-stock v9, arca v4, pin v5, usuarios-admin v7.
  Todas son iguales a este repositorio salvo **tn-precios**, que en la etiqueta queda en su versión anterior:
  la desplegada (v5) está guardada en el respaldo.
- **Integración con Tienda Nube**: configuración por conexión (Conexiones › Tienda Nube), fotos con la web como
  dueña, conexión de publicaciones por código y por nombre (sin importar el orden de las palabras), avisos en el
  Inicio de lo mal conectado.

### Respaldo (fuera del repositorio, tiene datos de clientes y ventas)

`D:\Mi unidad\Claude\percha-local\backups\percha-base-2026-11-17\`

- `esquema.sql` — estructura completa de la base: tablas, restricciones, índices, seguridad por filas, vistas,
  funciones, disparadores y tareas programadas.
- `datos/<tabla>.json` — los datos de cada tabla (`_resumen.json` dice cuántas filas tiene cada una).
  No incluye `conexion_secretos`, `app_config` ni `oauth_estados` (claves y tokens: se recuperan reconectando
  Tienda Nube y cargando las claves de la app). Tampoco incluye los usuarios de acceso (Supabase Auth).
- `funciones-desplegadas/` — el código exacto de cada función tal como estaba desplegada.
- `web-tienda/` — los archivos que se cambiaron en la web de Augusta (orden de novedades).
- `LEEME.md` — cómo volver a esta versión.

Supabase además guarda copias diarias de la base (plan Pro), por si hace falta volver a un día exacto.
