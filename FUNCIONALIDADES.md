# Percha · Mapa de funcionalidades

Relevado el 22/10/2026 contra: Dragonfish (Zoo Logic, el más usado en Argentina para ropa), Lightspeed Retail, Shopify POS, Odoo POS, Control Comercio, Gestión Moda y FactuSOL. La meta es cubrir todo lo que hacen los mejores y que sea **fácil de configurar**.

Estado: ✅ hecho · 🔧 en curso · F2…F6 fase prevista · ★ diferencial de Percha (lo que los demás no hacen o hacen mal)

## 1. Catálogo y variantes
- ✅ Matriz talle × color: se carga la prenda una vez y se generan las combinaciones (Dragonfish, Lightspeed).
- ✅ Tercer eje "estampa" opcional (para no mezclar estampas con colores, como pasa hoy).
- ✅ Código de barras por variante; se reutilizan los del proveedor (Dragonfish).
- ✅ Artículos únicos (sin talle ni color), servicios, señas, gift cards, envíos.
- ✅ Familias, proveedores, costo, precio de lista.
- ✅ **Curvas de talle** por familia o proveedor (ej. "curva adulto: S M L XL = 1 2 2 1"): al comprar o cargar, se reparte por talle solo.
- F2 Paleta de colores con muestra y agrupación (familia de color) para filtrar.
- F2 Fotos del producto y de cada color (sirven en caja, en etiquetas y en la tienda online).
- F2 Productos compuestos / packs (pack x3 bombachas descuenta las 3 unidades) (Lightspeed "composite").
- F2 Cambio de precios masivo por familia, proveedor, temporada o % (Dragonfish).
- F2 Temporadas y colecciones (para ver qué quedó de cada temporada).
- F4 Importación desde Excel y desde Tiendanube; alta rápida por lector.
- ★ Alta de producto guiada: desde la etiqueta del proveedor o una foto, el sistema propone nombre, familia y talles.

## 2. Stock
- ✅ Stock por variante y por depósito; todo movimiento queda registrado con quién y por qué.
- ✅ Ajuste desde la matriz; carga inicial migrada de FactuSOL.
- F2 Toma de inventario con lector o celular: conteo parcial por familia, diferencias y ajuste en un paso (Shopify "quick counts", Dragonfish "toma de inventario").
- F2 Transferencias entre depósitos o sucursales, con remito interno (Lightspeed, Dragonfish).
- F2 Stock mínimo por variante y alertas de faltantes según ritmo de venta (Shopify "low stock por tasa de venta").
- F4 Reposición sugerida: qué comprar, en qué curva y cuánto, por lo vendido (Lightspeed "forecast mode").
- F4 Mercadería parada: lo que no se vende hace X días, valorizado (ya está medido para Augusta).
- ★ Stock "vendible" vs "comprometido": lo que está en pedidos online o señado no se vende dos veces.

## 3. Caja y ventas
- ✅ Vender con lector, buscando o tocando la matriz; varias ventas abiertas a la vez (Odoo "parallel orders").
- ✅ Varios medios de pago en una venta (efectivo + tarjeta + transferencia) (todos).
- ✅ Descuento por línea o por venta, en % o $; descuentos solo con permiso (Dragonfish, Shopify "manager approvals").
- ✅ Listas de precios automáticas según medio de pago y cliente (Contado, Débito, Mayorista).
- ✅ Promociones automáticas: 2x1, 3x2, % por familia, "llevando 3 bombachas", descuento por cantidad, vigencia por fechas (Dragonfish, Lightspeed).
- ✅ Cuotas con recargo o sin interés por medio de pago; el recargo se muestra antes de cobrar.
- ✅ **Señas y reservas**: prenda apartada con saldo pendiente, vence a X días (Control Comercio, Lightspeed "layaway").
- ✅ **Cambios y devoluciones** con ticket de cambio o nota de crédito interna; devuelve el stock a la variante correcta (todos).
- ✅ Gift cards (créditos con código): venta, saldo, uso parcial (Shopify, Odoo).
- ✅ Clienta en la venta (opcional): historial, cumpleaños, lo que compró y en qué talle.
- ✅ Vendedora en cada venta; comisiones por vendedora (Control Comercio, Lightspeed).
- ✅ Ticket impreso (80 mm), por WhatsApp o por correo; sin impresora de tickets también funciona (Augusta hoy no tiene).
- ✅ Nota en la venta ("cambiar antes del 30", "regalo").
- Presupuestos / cotizaciones que se convierten en venta (Lightspeed "quotes").
- Pedidos especiales: vender algo sin stock y encargarlo (Lightspeed "special orders").
- ✅ **Funciona sin internet**: la caja sigue vendiendo y sube las ventas al volver la conexión (Odoo, Lightspeed).
- ✅ Cierre de caja por turno: arqueo por medio de pago, diferencias, retiros e ingresos (Dragonfish, Shopify).
- ✅ Anulación de venta con motivo y permiso.
- ★ Caja en el celular: vender y cobrar desde el teléfono en el local o en un evento (Dragonfish Mobile).

## 4. Clientas y fidelización (F2 básico, F5 completo)
- F2 Ficha: contacto, documento, condición IVA, lista de precios, cumpleaños, notas, talle habitual.
- F2 Cuenta corriente con límite y saldo (Lightspeed "account sales", Odoo "credit limit").
- F5 Puntos o crédito por compra; descuentos por grupo (mayoristas, amigas) (Lightspeed, Odoo).
- F5 Avisos por WhatsApp: cumpleaños, "llegó tu talle", seña por vencer (★ con el bot que ya existe en EyG).
- F5 Segmentos: quién compró qué, quién no vuelve hace 90 días.

## 5. Compras y proveedores
- ✅ Orden de compra al proveedor por curva de talles; recepción total o parcial con lector.
- ✅ Ingreso de mercadería actualiza stock y costo; costo promedio o último.
- Devolución al proveedor.
- ✅ Cuenta corriente de proveedores, pagos y vencimientos.
- ✅ Etiquetas de lo recibido en un clic.
- ★ Comparar lo pedido vs lo recibido vs lo facturado.

## 6. Facturación ARCA (F3)
- Factura C (monotributo) o B/A (responsable inscripto) según la empresa; nota de crédito y débito.
- CAE en el momento, cola de reintentos si ARCA no responde; la venta nunca se traba por la factura.
- Punto de venta por sucursal; numeración controlada.
- Certificado por empresa, guardado cifrado; asistente para generarlo (Emi tiene Clave Fiscal nivel 3).
- Factura por WhatsApp o correo; PDF con QR de ARCA.
- Facturar varias ventas juntas o una venta parcial; facturación automática de pedidos online pagos (Control Comercio).
- Libro IVA ventas exportable; reporte mensual para la contadora.

## 7. Online: Tiendanube y Mercado Libre
- ✅ Módulo Conexiones: Tienda Nube se conecta en un clic (OAuth) y se sincroniza el catálogo; cruce automático por SKU + talle + color, y manual para lo que no coincide; vista de stock canal vs Percha.
- Stock único: cada venta en el local baja el stock online y viceversa (Dragonfish, Shopify).
- Pedidos online entran solos con sus variantes, cliente y medio de pago; se preparan y despachan desde Percha.
- Precios sincronizados desde las listas.
- Publicar un producto nuevo desde Percha a Tiendanube con fotos y variantes.
- ML: publicaciones vinculadas a variantes; stock y ventas (ya existe el conector en Rosaint).
- ★ Retirar en el local y enviar desde el local, en el mismo flujo de caja (Shopify "pickup", "ship from store").

## 8. Informes (F5)
- Ventas por día, hora, vendedora, familia, producto, canal, medio de pago; margen bruto por todo eso (ya hecho para Augusta en la muestra).
- Horarios: qué turno rinde, día por día y mes por mes (hecho en la muestra).
- Mercadería: rotación, sin salida, cobertura en semanas, valorización a costo.
- Cierres de caja, diferencias, cuentas corrientes.
- Exportar a Excel; informes guardados; envío automático por WhatsApp o correo (Lightspeed "scheduled reports").
- ★ Lectura en lenguaje claro: "este mes vendiste 12% menos que el año pasado; los pijamas sostienen el margen".

## 9. Multiempresa, usuarios y configuración
- ✅ Cada empresa con sus datos, color, listas, formas de pago, depósitos, talles y colores.
- ✅ Roles: dueña, administración, vendedora, solo ver. Alta de usuarios en un clic con contraseña generada.
- F2 PIN rápido por vendedora en la caja (Shopify, Lightspeed) y permisos finos (descuentos, anulaciones, ver costos).
- F2 Sucursales: varias cajas y depósitos por empresa, informes consolidados (Dragonfish).
- F3 Auditoría: quién cambió qué (precios, stock, anulaciones) (Dragonfish "listado de auditoría").
- ★ Configuración guiada al crear la empresa: datos fiscales, talles y colores de tu rubro, listas y medios de pago en 10 minutos.
- ★ Importar desde FactuSOL, Excel o Tiendanube al empezar.

## 10. Técnica (lo que el usuario no ve pero sostiene todo)
- Datos aislados por empresa (RLS), copias de seguridad, exportación completa cuando la empresa quiera.
- Funciona en PC, tablet y celular; se instala como app (PWA).
- Caja sin internet; etiquetas e impresión desde el navegador (Brother, térmica 80 mm).
- Lector de código de barras USB o la cámara del celular.
- Cada cambio se prueba con datos reales antes de publicar.
