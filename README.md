# Percha

Sistema de gestión para tiendas de indumentaria: catálogo con talles y colores, stock, etiquetas, caja, compras y facturación electrónica (ARCA). Multiempresa: cada tienda tiene sus datos, su color y su logo.

Primera tienda: Augusta Intimates (Río Cuarto, Córdoba).

## Cómo está hecho

- **Interfaz**: HTML, CSS y JavaScript sin framework ni compilación. Diseño "glass" neutro; el color de acento y el logo salen de la configuración de cada empresa (`empresas.config.tema`).
- **Datos**: Supabase (Postgres con RLS por empresa, Auth, Edge Functions).
- **Publicación**: archivos estáticos (GitHub Pages).

## Carpetas

- `login.html`, `index.html` — ingreso e inicio.
- `shell/` — `shell.js` (sesión, empresa activa, cabecera, tema), `shell.css` (estilos), íconos.
- `shared/supabase.js` — conexión (clave publicable).
- `catalogo/` — productos, ficha con matriz talle × color, etiquetas.
- `configuracion/` — empresa, listas de precios, formas de pago, depósitos, talles/colores/familias, usuarios.
- `sql/` — esquema de la base, en orden (`001`, `002`, …).
- `herramientas/migrar-factusol.ps1` — migración del catálogo y el stock desde una copia de FactuSOL.
- `supabase/functions/` — funciones en la nube (`usuarios-admin`: alta y contraseñas de usuarios).

## Fases

1. ✅ Catálogo, variantes, stock, etiquetas, configuración, usuarios.
2. Caja: ventas, cambios y devoluciones, señas, pagos mixtos, cierre.
3. ARCA: factura electrónica y notas de crédito.
4. Compras y proveedores, cuenta corriente de clientas.
5. Tienda Nube y Mercado Libre, informes.
