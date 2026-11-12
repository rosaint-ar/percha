/* Percha · Instructivo: lo que hay que saber para usar Percha, tema por tema.
   Para sumar o corregir un tema se edita SOLO este archivo; la pantalla (instructivo.html) lo arma sola.
   Cada persona ve solo los temas de lo que tiene habilitado: p = permiso que pide el tema (o lista: alcanza con uno).
   Marcas en los textos: **negrita** · [[F2]] tecla · {{Botón}} botón o pestaña de la pantalla.
   Tipos de bloque: texto · pasos · ojo (cuidado) · tip · ejemplo (titulo + filas [a, b]) · tabla (filas [a, b]) · decir (qué decirle a la clienta).
   nuevo: 'AAAA-MM-DD' → sale en "Novedades" durante 3 semanas. */
window.INSTRUCTIVO = {
  actualizado: '2026-10-31',
  grupos: [
    { id: 'dia', titulo: 'Empezar el día', icono: '☀️' },
    { id: 'vender', titulo: 'Vender', icono: '🛍️' },
    { id: 'whatsapp', titulo: 'Ventas por WhatsApp y envíos', icono: '📲' },
    { id: 'cambios', titulo: 'Cambios y devoluciones', icono: '🔁' },
    { id: 'gift', titulo: 'Gift cards', icono: '🎁' },
    { id: 'caja', titulo: 'La caja', icono: '💵' },
    { id: 'consultas', titulo: 'Consultar y corregir', icono: '🔎' },
    { id: 'compras', titulo: 'Mercadería que llega', icono: '📦' },
    { id: 'atajos', titulo: 'Atajos de teclado', icono: '⌨️' },
    { id: 'palabras', titulo: 'Palabras que vas a ver', icono: '📚' }
  ],
  temas: [
    // ======================= EMPEZAR EL DÍA =======================
    { id: 'entrar', grupo: 'dia', titulo: 'Entrar a Percha', resumen: 'En la compu del local se entra con tu PIN de 4 números.', bloques: [
      { tipo: 'pasos', items: ['Abrí Percha y tocá tu nombre.', 'Escribí tu **PIN de 4 números**.', 'Listo: entrás directo.'] },
      { tipo: 'tip', texto: 'El PIN funciona solo en las compus donde ya lo activaste. En otra compu se entra con el correo y la contraseña, y ahí mismo te ofrece elegir un PIN.' },
      { tipo: 'ojo', texto: 'Si te equivocás **5 veces**, el PIN de esa compu se apaga. Pedile a administración que te lo vuelva a habilitar.' }
    ] },
    { id: 'abrir-caja', grupo: 'dia', p: 'vender', titulo: 'Abrir la caja', resumen: 'Al entrar al Punto de venta te pide abrir la caja con el efectivo que hay.', bloques: [
      { tipo: 'pasos', items: ['Entrá a **Punto de venta**. Si la caja está cerrada, aparece "Abramos la caja".', 'Te muestra el cambio que quedó en el último cierre. **Contá el efectivo del cajón.**', 'Si está igual, tocá {{🔓 Abrir caja}}. Si no, escribí lo que contaste y después abrí.'] },
      { tipo: 'tip', texto: 'Con {{🧮 Contar billetes}} cargás cuántos billetes hay de cada uno y la suma se hace sola.' },
      { tipo: 'ojo', texto: 'Sin la caja abierta no se puede cobrar. Si tocaste "Después", abrila con {{🔓 Abrir caja}} arriba de todo.' }
    ] },

    { id: 'tareas', grupo: 'dia', p: 'vender', titulo: 'Las tareas del local', nuevo: '2026-10-31', resumen: 'La rutina del local (luces, vidriera, piso, aire, alarma…) como un recordatorio amable.', bloques: [
      { tipo: 'texto', texto: 'Percha te recuerda la rutina del local, sin apuro y a tu ritmo:' },
      { tipo: 'tabla', filas: [
        ['☀️ Al abrir la caja', 'aparece **"Para arrancar el día"** con las tareas de la mañana'],
        ['🕐 Durante el día', 'una **tarjetita ✨ Recordatorio** abajo a la izquierda, **en cualquier pantalla de Percha** mientras la caja esté abierta (ej. mirar los WhatsApp, acomodar perchas): {{✓ Listo}} o {{Más tarde}} (vuelve en media hora)'],
        ['🌙 Al cerrar la caja', 'antes de contar la plata aparece **"Antes de irte"** (aire, luces, alarma…). Nunca frena el cierre']] },
      { tipo: 'pasos', items: ['Tocá {{✓ Listo}} en cada tarea que hiciste: sale un ✨ y un festejo cuando está todo hecho.', 'Arriba en la caja, {{Tareas 3/8}} te muestra cómo van las de hoy y te deja marcarlas cuando quieras.', 'Si marcaste una sin querer, tocá {{deshacer}}.'] },
      { tipo: 'tip', texto: 'Las hace quien pueda: si una compañera ya la marcó, aparece con su nombre.' }
    ] },
    { id: 'tareas-config', grupo: 'dia', p: 'configuracion', titulo: 'Configurar las tareas del local', nuevo: '2026-10-31', resumen: '**Configuración** › {{Tareas del local}}.', bloques: [
      { tipo: 'pasos', items: ['{{+ Agregar tarea}}: qué hay que hacer, un emoji y cuándo.', 'En cada tarea elegís **cuándo**: al abrir la caja, a una hora, cada tanto durante el día (cada 1, 2, 3 o 4 h) o al cerrar.', 'Los **días**: tocá los que corresponden (ninguno marcado = todos los días).', 'Un **detalle amable** (opcional) explica para qué sirve. Se guarda solo al escribir.'] },
      { tipo: 'texto', texto: 'Debajo de cada tarea, **📅 Hoy** dice qué pasa hoy con ella: si sale al abrir, a qué hora, si ya se hizo o si **hoy no le toca** (por ejemplo, porque el sábado no está marcado).' },
      { tipo: 'tip', texto: '{{Probar el aviso}} muestra la tarjetita tal cual la ve la vendedora. Los avisos de durante el día aparecen **en cualquier pantalla de Percha** mientras haya una caja abierta.' },
      { tipo: 'tip', texto: 'Apagá una tarea con el interruptor si no hace falta por un tiempo.' }
    ] },

    // ======================= VENDER =======================
    { id: 'pantalla', grupo: 'vender', p: 'vender', titulo: 'La pantalla de venta', resumen: 'Buscador arriba, prendas en el medio, ticket a la derecha.', bloques: [
      { tipo: 'pasos', items: [
        '**Buscá** escribiendo parte del nombre (ej. "alon" para Alondra) o **escaneá** el código: con el lector, la prenda entra sola al ticket.',
        'Tocá una prenda y elegí **talle y color** en la ventanita.',
        'Sin buscar, ves los **★ Más vendidos**.',
        'Arriba del ticket está el **número de ticket** desde que empezás. Sirve para anotarlo en el paquete, por ejemplo si después hay un cambio.'] },
      { tipo: 'tip', texto: 'Para cambiar el talle o el color de algo que ya está en el ticket, **tocá el nombre o el talle** en el renglón. No hace falta borrarlo y cargarlo de nuevo.' },
      { tipo: 'tip', texto: 'Para llevar varias iguales: tocá **+** en el renglón, o escribí **3*** en el buscador antes de elegir la prenda.' },
      { tipo: 'tip', texto: 'Los sonidos de la caja se prenden o apagan con {{🔊}} arriba.' }
    ] },
    { id: 'stock', grupo: 'vender', p: 'catalogo_ver', titulo: '¿Cuántas quedan de una prenda?', nuevo: '2026-10-31', resumen: 'Buscala en el Punto de venta: cada tarjeta muestra cuántas hay.', bloques: [
      { tipo: 'pasos', items: ['Escribí el nombre en el buscador del Punto de venta.', 'Cada tarjeta muestra **cuántas hay**. Al tocarla, ves cuántas hay **de cada talle y color**.'] },
      { tipo: 'tip', texto: 'Si una tarjeta dice "desde $…", es porque los colores tienen precios distintos: al elegir el color ves el precio de ese.' },
      { tipo: 'texto', texto: 'El stock es **uno solo para el local y la web**: lo que se vende en un lado se descuenta del otro.' }
    ] },
    { id: 'precios', grupo: 'vender', p: 'vender', titulo: 'Los precios cambian según cómo paga', resumen: 'El sistema pone solo el precio según el medio de pago.', bloques: [
      { tipo: 'texto', texto: 'Cada prenda tiene su precio de **Lista**. Según cómo paga la clienta, el precio baja solo:' },
      { tipo: 'tabla', filas: [['Efectivo o transferencia', 'precio **Contado** (20% menos)'], ['Débito', 'precio **Débito** (10% menos)'], ['Tarjeta de crédito, cuotas, Mercado Pago, MODO', 'precio **Lista**']] },
      { tipo: 'texto', texto: 'No tenés que calcular nada: al tocar el medio de pago en el cobro, el ticket pasa a esa lista. También podés elegir la lista arriba del ticket si la clienta pregunta antes.' }
    ] },
    { id: 'cobrar', grupo: 'vender', p: 'vender', titulo: 'Cobrar', resumen: '{{Cobrar}}, tocás el medio de pago y confirmás.', bloques: [
      { tipo: 'pasos', items: [
        'Tocá {{Cobrar}} (o [[F9]]).',
        'Tocá el **medio de pago**: se completa solo con lo que falta.',
        '**¿Paga con dos medios?** Tocá el primero, corregí el importe y tocá el segundo: se completa con el resto.',
        '**Efectivo con vuelto:** escribí con cuánto paga y te muestra el vuelto.',
        'Cuando dice **Completo ✓**, tocá {{Confirmar}}.',
        'Después podés {{Imprimir ticket}} o mandarlo por {{WhatsApp}}. Enter = {{Nueva venta}}.'] },
      { tipo: 'tip', texto: 'Con el teclado: en el cobro, los números **1 a 9** eligen el medio de pago.' }
    ] },
    { id: 'mas', grupo: 'vender', p: 'vender', titulo: 'Clienta, nota, entrega, descuento y canal', resumen: 'Todo eso está en {{Más…}} ([[F4]]).', bloques: [
      { tipo: 'tabla', filas: [['Clienta', 'empezá a escribir el nombre; si es nueva, se crea sola'], ['Nota', 'ej. "regalo", "cambio antes del 15/11"'], ['🚚 Entrega', 'si se lo mandan o lo retira después: queda en **Envíos**'], ['Descuento %', 'para todo el ticket'], ['Canal', '**Local**, **WhatsApp** o **Web**: de dónde vino la venta']] },
      { tipo: 'tip', texto: 'Cargá la clienta siempre que puedas: después es mucho más fácil encontrar su compra para un cambio.' }
    ] },
    { id: 'precio-mano', grupo: 'vender', p: 'descuentos', titulo: 'Cambiar un precio a mano', resumen: 'Solo para corregir un error: [[F2]] y escribís el precio.', bloques: [
      { tipo: 'pasos', items: ['Tocá el **precio del renglón** (a la derecha) o apretá [[F2]].', 'Escribí el precio y Enter.', 'Queda marcado "Precio cambiado a mano".'] },
      { tipo: 'tip', texto: 'Para volver al precio normal, borrá el número o escribí el de lista.' },
      { tipo: 'ojo', texto: 'Usalo solo para errores. Las ofertas y los descuentos por medio de pago se aplican solos.' }
    ] },
    { id: 'fallas', grupo: 'vender', p: 'vender', titulo: 'Prendas con falla', resumen: 'Si la prenda tiene falla, marcala en el renglón.', bloques: [
      { tipo: 'texto', texto: 'Cuando hay unidades con falla de esa prenda, en el renglón aparece **"◆ Hay N con falla · ¿es esta?"**.' },
      { tipo: 'pasos', items: ['Si la que se lleva es la de la falla, tocá ese botón.', 'Queda **"◆ Con falla"** y, si tiene descuento, se aplica solo.'] },
      { tipo: 'ojo', texto: 'Marcala siempre: así el stock de la web queda bien (las de falla no se muestran en la web).' },
      { tipo: 'tip', texto: '**Administración** define el descuento de cada prenda con falla en su ficha (◆ Con falla): un **% off** o un **$ precio** (a precio de lista; pagando en efectivo o débito baja como siempre). La ficha muestra a cuánto sale en cada lista.' }
    ] },
    { id: 'sin-stock', grupo: 'vender', p: 'vender', titulo: 'Si dice "sin stock"', resumen: 'El sistema avisa pero nunca te frena la venta.', bloques: [
      { tipo: 'texto', texto: 'Si en el renglón aparece **⚠ sin stock** o al cobrar te dice "el sistema dice que hay N", es porque el número cargado no coincide con lo que tenés en la mano.' },
      { tipo: 'pasos', items: ['Fijate que sea **la prenda, el talle y el color correctos**.', 'Si está bien, **vendé igual**: queda un aviso para corregir el stock.'] }
    ] },
    { id: 'genericos', grupo: 'vender', p: 'vender', titulo: 'Bombachas y medias varias (códigos comunes)', resumen: 'BOMBIS «VARIAS» y MEDIAS VARIAS: se venden rápido y al cobrar se elige el modelo.', bloques: [
      { tipo: 'texto', texto: 'Las bombachas y las medias se pueden cargar con un **código común** para vender rápido: **BOMBIS «VARIAS»** y **MEDIAS VARIAS**. Todo lo demás (pantuflones, chunas, conjuntos…) se carga con su modelo, talle y color, como siempre.' },
      { tipo: 'pasos', items: [
        'Cargalas en el ticket como cualquier prenda.',
        'Al tocar {{Cobrar}} aparece **"¿Qué modelos se lleva?"**.',
        'Buscá cada una con pocas letras (ej. **fru cel** = Fru Fru celeste) y tocala.',
        'Si es una que **no está en la web**, tocá {{+ BOMBIS «LOCAL»}} (o {{+ MEDIAS «LOCAL»}}).',
        'Si no sabés cuál es, seguí: queda en **📌 Pendientes** para definirla después.'] },
      { tipo: 'ojo', texto: 'Definí el modelo siempre que puedas: así el stock de la web se descuenta bien.' }
    ] },
    { id: 'conjuntos', grupo: 'vender', p: 'vender', titulo: 'Conjuntos: solo corpiño o cambio de bombacha', resumen: 'Dos botones en el renglón del conjunto.', bloques: [
      { tipo: 'tabla', filas: [
        ['{{Solo corpiño}}', 'Se lleva el corpiño sin la bombacha: el total baja **$5.000** y la bombacha queda en el local (BOMBIS «LOCAL»).'],
        ['{{Cambio bombacha}}', 'Se lleva el conjunto pero cambia la bombacha por una suelta del "arma tu pack": **no paga diferencia**. Al cobrar elegís cuál se llevó.']] },
      { tipo: 'tip', texto: 'La bombacha que se lleva en el cambio se elige en la misma ventana "¿Qué modelos se lleva?" y va sin cargo.' }
    ] },
    { id: 'sena', grupo: 'vender', p: 'vender', titulo: 'Dejar una seña', nuevo: '2026-10-31', resumen: 'Paga una parte, las prendas quedan reservadas y se lleva un comprobante con el número para retirar.', bloques: [
      { tipo: 'pasos', items: [
        'Cargá las prendas y tocá {{Dejar seña}}.',
        'Tocá con qué paga la seña: propone la **mitad** (cambiala si deja otro monto). Confirmá.',
        'Sale el **comprobante de seña**: el **número para retirar**, las prendas, lo que pagó y **lo que falta según con qué pague**.',
        '{{Imprimir comprobante de seña}} o {{📷 WhatsApp (foto)}} para mandárselo (en la compu se pega con [[Ctrl]]+[[V]]).'] },
      { tipo: 'texto', texto: 'Los precios quedan **congelados 15 días**: el comprobante dice hasta qué fecha.' },
      { tipo: 'tip', texto: 'Para volver a mandar el comprobante: **Ventas** › pestaña {{Señas}} › {{🎟️ Comprobante}}.' }
    ] },
    { id: 'sena-retirar', grupo: 'vender', p: 'vender', titulo: 'Retirar una seña', nuevo: '2026-10-31', resumen: 'Con el ticket vacío, {{🎟️ Retirar seña}}: buscás la seña y cobrás lo que falta.', bloques: [
      { tipo: 'pasos', items: [
        'Con el ticket **vacío**, tocá {{🎟️ Retirar seña}} (es el mismo botón de "Dejar seña").',
        'Buscá por el **número del comprobante**, el nombre o el teléfono de la clienta, y tocá la seña.',
        'Tocá con qué paga **lo que falta**: el importe ya está bien según el medio.',
        '{{Cobrar y entregar}}: entregale las prendas.'] },
      { tipo: 'ejemplo', titulo: 'Dejó $13.000 en efectivo de un conjunto de $26.000 (precio Contado)', filas: [['Paga lo que falta en efectivo o transferencia', '**$13.000**'], ['Con débito', '**$14.625**'], ['Con tarjeta', '**$16.250**'], ['¿Por qué?', 'como en los cambios: el descuento del efectivo vale solo para la plata que entra en efectivo']] },
      { tipo: 'ojo', texto: 'Si pasaron **más de 15 días**, lo que falta se cobra **al precio de hoy**. La caja lo calcula sola y te avisa con ⏰ cuánto era y cuánto es ahora.' },
      { tipo: 'tip', texto: 'También desde **Ventas** › {{Señas}} › {{Retirar en la caja}}: te lleva al Punto de venta con la seña lista.' }
    ] },
    { id: 'ticket-regalo', grupo: 'vender', p: 'vender', titulo: 'Ticket de cambio para regalo', nuevo: '2026-11-05', resumen: 'Un toque y sale el ticket sin precios para que quien recibe el regalo lo pueda cambiar.', bloques: [
      { tipo: 'pasos', items: [
        'Después de cobrar, tocá {{🎁 Ticket de regalo}}.',
        'Se imprime **de una**: el **número de ticket**, las prendas y **hasta cuándo se puede cambiar**, sin precios.'] },
      { tipo: 'tip', texto: 'Si son regalos para **personas distintas** o solo algunas prendas son regalo, tocá {{Elegir prendas…}}: marcás cuáles y si sale **un ticket por cada prenda**.' },
      { tipo: 'tip', texto: 'Si en {{Más…}} escribís **"regalo"** en la nota, el botón {{🎁 Ticket de regalo}} aparece resaltado.' },
      { tipo: 'tip', texto: '¿Se olvidaron de pedirlo? En **Ventas** abrí la venta y tocá {{🎁 Ticket de regalo}}.' }
    ] },
    { id: 'prueba', grupo: 'vender', p: 'vender', titulo: 'Si te equivocaste en una venta', resumen: 'Se corrige, se anula o, si fue de prueba, se borra.', bloques: [
      { tipo: 'tabla', filas: [
        ['Estaba mal algo (prenda, precio, clienta)', '**Ventas** › tocá la venta › {{Editar}}'],
        ['Fue de prueba, no existió', '{{🧪 Era de prueba}}: la borra, devuelve el stock (también en la web) y la saca de la caja'],
        ['Se vendió pero se canceló', '{{Anular}}: queda registrada como anulada y el stock vuelve']] },
      { tipo: 'tip', texto: '{{🧪 Era de prueba}} está en la ventana que aparece después de cobrar y también al abrir la venta en **Ventas**.' }
    ] },
    { id: 'lo-pidieron', grupo: 'vender', p: 'vender', titulo: 'Anotar lo que piden y no hay', nuevo: '2026-10-31', resumen: 'Una clienta pide algo que no tenemos (o no en su talle): {{📝 Lo pidieron}} y se anota.', bloques: [
      { tipo: 'pasos', items: [
        'Arriba en el Punto de venta tocá {{📝 Lo pidieron}}. (Si la buscaste y no apareció, abajo te ofrece {{📝 ¿Lo pidió una clienta? Anotalo}}.)',
        'En **¿Qué pidió?** escribí y elegí la prenda del catálogo. Si no la tenemos, dejala escrita como la pidió (ej. "kimono de raso").',
        'Si es del catálogo, tocá el **talle y color** que quiere (te muestra cuántas hay de cada uno).',
        'Poné la **clienta** y su **teléfono**: así se le avisa por WhatsApp cuando llegue.',
        '{{Anotar}}. Listo: lo ve administración en **Lo que piden**.'] },
      { tipo: 'tip', texto: 'Anotá todo lo que te pidan, aunque sea una sola vez: así se sabe qué conviene reponer o traer.' }
    ] },
    { id: 'sin-internet', grupo: 'vender', p: 'vender', titulo: 'Si se corta internet', resumen: 'Seguí vendiendo: las ventas se guardan y se suben solas.', bloques: [
      { tipo: 'texto', texto: 'La caja sigue funcionando. Arriba vas a ver **"N ventas por subir"**: cuando vuelve internet se suben solas.' },
      { tipo: 'ojo', texto: 'Sin internet no se pueden buscar ventas viejas (para un cambio) ni usar notas de crédito. Esperá a que vuelva.' },
      { tipo: 'tip', texto: 'Si al volver internet una venta **no se pudo subir** (por ejemplo, la caja ya estaba cerrada), no se pierde: arriba aparece {{⚠️ N ventas con problema}}. Tocalo: ves el motivo y podés {{Reintentar}} (o {{Descartar}}, si de verdad no va).' }
    ] },

    // ======================= WHATSAPP Y ENVÍOS =======================
    { id: 'venta-whatsapp', grupo: 'whatsapp', p: 'vender', titulo: 'Cargar una venta por WhatsApp', nuevo: '2026-10-31', resumen: 'Igual que una venta del local, pero con canal WhatsApp y, si hace falta, el envío.', bloques: [
      { tipo: 'pasos', items: [
        'En el **Punto de venta**, cargá las prendas que pidió.',
        'Abrí {{Más…}} ([[F4]]): en **Clienta** poné su nombre y en **Canal** elegí **WhatsApp**.',
        'Si se lo mandan o lo retira otro día, tocá {{🚚 Entrega}} (mirá "Cargar el envío").',
        'Tocá {{Cobrar}} y elegí **cómo pagó** (casi siempre **transferencia**). Confirmá.',
        'Tocá {{WhatsApp}} en la ventana final para mandarle el ticket.'] },
      { tipo: 'ojo', texto: 'Cargala **cuando ya pagó**. Si pagó solo una parte, usá {{Dejar seña}}.' },
      { tipo: 'tip', texto: 'Elegir el canal **WhatsApp** es importante: así se sabe cuánto se vende por cada lado.' }
    ] },
    { id: 'envio-cargar', grupo: 'whatsapp', p: 'vender', titulo: 'Cargar el envío', nuevo: '2026-10-31', resumen: 'En {{Más…}} › {{🚚 Entrega}}: cómo le llega, cuánto cuesta y adónde.', bloques: [
      { tipo: 'pasos', items: [
        'En {{Más…}} tocá {{🚚 Entrega}}.',
        'Elegí el **medio**: Retiro en el local, Cadete / moto o Correo.',
        'Escribí el **costo del envío** (lo paga la clienta). Con cadete, poné lo que cobra el cadete.',
        'Completá la **dirección** y el **contacto** (teléfono o quién recibe). Si la clienta ya los tiene cargados, aparecen solos.',
        'Tocá {{Listo}}: el envío aparece en el ticket como un renglón "Envío" y se cobra junto con las prendas.'] },
      { tipo: 'tabla', filas: [['Retiro en el local', 'no pide dirección; queda anotado para cuando venga'], ['Cadete / moto', 'pide dirección; el costo es lo que cobra el cadete'], ['Correo', 'pide dirección; después anotás el número de seguimiento']] },
      { tipo: 'tip', texto: 'Si te equivocaste, volvé a tocar {{🚚 Entrega}} y corregilo, o {{Sin entrega}} para sacarlo.' }
    ] },
    { id: 'envios-seguir', grupo: 'whatsapp', p: 'vender', titulo: 'Preparar y despachar: la pantalla Envíos', nuevo: '2026-10-31', resumen: 'Todo lo que hay que preparar, mandar y entregar, en un solo lugar.', bloques: [
      { tipo: 'texto', texto: 'En el menú, **Envíos** muestra cada venta con entrega: clienta, dirección, teléfono, prendas y nota. Los **pedidos de la web** aparecen solos, con su envío.' },
      { tipo: 'pasos', items: [
        'Arrancá por {{Por despachar}}: es lo que falta mandar.',
        'Cuando armás el paquete, cambiá el estado a **Preparado**.',
        'Cuando sale, a **Enviado**. Si va por correo, escribí el **N° de seguimiento**.',
        'Cuando la clienta lo recibió (o lo retiró), a **Entregado**.'] },
      { tipo: 'tabla', filas: [['Pendiente', 'todavía no se armó'], ['Preparado', 'el paquete está listo'], ['Enviado', 'ya salió (cadete o correo)'], ['Entregado', 'lo tiene la clienta']] },
      { tipo: 'tip', texto: 'Todo se guarda solo al cambiarlo: no hay botón Guardar.' }
    ] },
    { id: 'ejemplo-whatsapp', grupo: 'whatsapp', p: 'vender', titulo: 'Ejemplo completo', nuevo: '2026-10-31', resumen: 'María pide un conjunto por WhatsApp, lo paga por transferencia y se lo manda el cadete.', bloques: [
      { tipo: 'ejemplo', titulo: 'María pide un Conjunto Jade 100 Habano, con envío por cadete', filas: [
        ['1. Cargar', 'Conjunto Jade 100 Habano'],
        ['2. {{Más…}}', 'Clienta: María · Canal: WhatsApp'],
        ['3. {{🚚 Entrega}}', 'Cadete / moto · $3.000 · su dirección y teléfono'],
        ['4. {{Cobrar}}', 'Transferencia: la caja suma el conjunto a precio Contado + el envío'],
        ['5. {{WhatsApp}}', 'le mandás el ticket'],
        ['6. **Envíos**', 'Preparado → Enviado cuando sale con el cadete → Entregado']] }
    ] },
    { id: 'pedidos-web', grupo: 'whatsapp', p: 'vender', titulo: 'Los pedidos de la web', nuevo: '2026-11-02', resumen: 'Entran solos: no se cargan a mano. Si se cancelan en Tienda Nube, se anulan solos.', bloques: [
      { tipo: 'texto', texto: 'Cuando alguien compra en la tienda online, el pedido **entra solo** a Percha **en el momento** (apenas se paga): aparece en **Ventas** (canal Web), si tiene envío en **Envíos**, y en el **cierre de caja** como "fuera de la caja". El stock se descuenta solo.' },
      { tipo: 'ojo', texto: '**No lo cargues de nuevo en la caja**: quedaría vendido dos veces.' },
      { tipo: 'texto', texto: '**Si se cancela en Tienda Nube**, también se anula **sola** en Percha: el stock vuelve y en la venta dice el **motivo** que trajo Tienda Nube (por ejemplo "Cancelado en Tienda Nube: la clienta lo canceló"). Lo mismo si se devuelve el pago. No hay que hacer nada en Percha.' },
      { tipo: 'tip', texto: 'Un pedido de la web **sin pagar** (por ejemplo, efectivo a coordinar) no es venta todavía: solo **aparta** esas prendas en la web. Si se cancela, se liberan solas.' },
      { tipo: 'ojo', texto: 'Para **cancelar** un pedido de la web, hacelo **en Tienda Nube** y Percha se entera sola (si lo anulás solo en Percha, en Tienda Nube sigue activo). Si querés que figure el motivo, elegilo al cancelar y anotalo en la nota del pedido.' }
    ] },

    // ======================= CAMBIOS =======================
    { id: 'cambios-regla', grupo: 'cambios', p: 'vender', titulo: 'La regla de los cambios', nuevo: '2026-10-31', resumen: 'Lo que devuelve vale lo que pagó, con el medio con que pagó. El sistema hace la cuenta solo.', bloques: [
      { tipo: 'texto', texto: 'Cuando una clienta cambia una prenda, **lo que devuelve vale lo que pagó por ella, en el medio con que la pagó**. El descuento del medio de pago se aplica **solo a la diferencia** que paga ahora. Así no pierde ella ni pierde el local.' },
      { tipo: 'texto', texto: '**No tenés que calcular nada**: buscás el ticket, cargás lo que se lleva y al cobrar el sistema te muestra cuánto paga según el medio.' },
      { tipo: 'tabla', filas: [
        ['Mismo modelo y mismo color, **otro talle**', 'se cambia **sin pagar nada**, aunque el precio haya subido'],
        ['Otro color u otra prenda', 'paga la **diferencia** (o le queda saldo a favor)'],
        ['Le sobra plata', '**nota de crédito**, o se le devuelve por el **mismo medio** con que pagó'],
        ['Plazo', '**30 días** con el ticket (lo dice el ticket impreso)']] }
    ] },
    { id: 'cambios-pasos', grupo: 'cambios', p: 'vender', titulo: 'Cómo hacer un cambio, paso a paso', nuevo: '2026-10-31', resumen: 'Buscás la venta, marcás lo que devuelve, cargás lo que se lleva y cobrás.', bloques: [
      { tipo: 'pasos', items: [
        'En el Punto de venta tocá {{Cambio / devolución}}.',
        '**Buscá la venta** por número de ticket, nombre o teléfono de la clienta, fecha (ej. "27/10"), prenda, talle, color o total. Elegí la venta de la lista.',
        '**Marcá lo que devuelve** y tocá {{Cargar al ticket}}. Aparece en el ticket como "devuelve".',
        '**Cargá lo que se lleva**, como en cualquier venta.',
        'Tocá {{Cobrar}}. Arriba te muestra **la diferencia según el medio**: "precio Contado $8.000 · Débito $9.000 · Lista $10.000".',
        'Tocá el medio con que paga la diferencia: **el importe ya está bien**. Confirmá.',
        'Imprimí el **comprobante del cambio**: dice qué devolvió, qué se llevó y la diferencia.'] },
      { tipo: 'tip', texto: 'Si en el ticket dice "Pagó $18.000 a precio Contado = $22.500 a precio Lista", es el sistema mostrando la cuenta: está bien.' },
      { tipo: 'tip', texto: '**¿Viene con un ticket de cambio de regalo?** Buscá la venta por el **número** que dice el ticket. La prenda vale lo que pagó quien la regaló; si le sobra, hacele una nota de crédito.' },
      { tipo: 'ojo', texto: 'Buscá **siempre el ticket original** cuando lo hay: así el sistema sabe cuánto y cómo pagó. Sin ticket, la prenda se toma al precio de hoy.' }
    ] },
    { id: 'cambios-ejemplos', grupo: 'cambios', p: 'vender', titulo: 'Ejemplos con un caso real', nuevo: '2026-10-31', resumen: 'Conjunto Alondra comprado a $18.000 por transferencia.', bloques: [
      { tipo: 'texto', texto: 'La clienta compró un **Conjunto Alondra** y lo pagó **por transferencia: $18.000** (precio Contado; en Lista sale $22.500).' },
      { tipo: 'ejemplo', titulo: 'Se lleva un Conjunto Charo (Lista $32.500 · Contado $26.000)', filas: [['Paga la diferencia en efectivo o transferencia', '**$8.000**'], ['Paga con débito', '**$9.000**'], ['Paga con tarjeta', '**$10.000**']] },
      { tipo: 'ejemplo', titulo: 'Se lleva un Conjunto Jade de $16.000 (Contado)', filas: [['Le sobran', '**$2.000** → nota de crédito (o se los devolvés por transferencia)']] },
      { tipo: 'ejemplo', titulo: 'Cambia el Alondra 100 Nude por el 95 Nude (subió de precio)', filas: [['Mismo modelo y color', '**$0**: se cambia sin diferencia']] },
      { tipo: 'ejemplo', titulo: 'Cambia el Alondra 100 Nude por el 95 Blanco (otro color)', filas: [['Es otra prenda', 'paga la **diferencia** con el precio de hoy']] },
      { tipo: 'ejemplo', titulo: 'Al revés: si lo hubiera pagado con tarjeta ($22.500) y se lleva el Charo', filas: [['Paga la diferencia en efectivo', '**$8.000** (no $3.500)'], ['¿Por qué?', 'el descuento del efectivo va solo sobre la diferencia, no sobre lo que ya había pagado con tarjeta']] }
    ] },
    { id: 'cambios-devolver', grupo: 'cambios', p: 'vender', titulo: 'Cuando le sobra plata', nuevo: '2026-10-31', resumen: 'Nota de crédito, o la plata por el mismo medio con que pagó.', bloques: [
      { tipo: 'texto', texto: 'Si lo que se lleva vale menos (o no se lleva nada), al cobrar te avisa **"Le sobra $X"** y cómo había pagado.' },
      { tipo: 'tabla', filas: [
        ['Prefiere saldo a favor', 'tocá {{Confirmar}} sin elegir medio: sale una **nota de crédito**'],
        ['Quiere la plata', 'tocá {{Devolver por…}}: se devuelve por el **mismo medio** con que pagó (si fueron dos, en la misma proporción)']] },
      { tipo: 'ojo', texto: 'La plata **nunca** se devuelve por otro medio: si pagó con tarjeta, no se devuelve en efectivo. Los otros medios aparecen apagados. Con tarjeta, la devolución se hace en el posnet o en la app (Mercado Pago, NAVE).' },
      { tipo: 'decir', texto: 'Te queda un saldo a favor de $2.000 en esta nota de crédito. La podés usar cuando quieras, presentando el código.' }
    ] },
    { id: 'nota-credito', grupo: 'cambios', p: 'vender', titulo: 'La nota de crédito', nuevo: '2026-10-31', resumen: 'Se imprime o se manda por WhatsApp como foto. Recuerda cómo se pagó.', bloques: [
      { tipo: 'pasos', items: [
        'Al emitirla aparece **"✓ Nota de crédito emitida"** con la nota como se va a imprimir.',
        '{{Imprimir nota de crédito}} para dársela en papel.',
        '{{📷 WhatsApp (foto)}} para mandársela: en la compu la foto queda copiada y se abre WhatsApp (en el chat de la clienta si tiene teléfono cargado): **pegala con [[Ctrl]]+[[V]]** y mandala. En el celular se abre el menú de compartir.'] },
      { tipo: 'texto', texto: 'La nota dice el **código**, el **saldo a favor** y **cuánto vale según con qué pague**: una nota de efectivo de $2.000 vale $2.250 con débito y $2.500 con tarjeta. El sistema lo hace solo.' },
      { tipo: 'tip', texto: 'Para volver a imprimirla o mandarla: **Ventas** › pestaña {{Créditos}} › tocá la nota.' }
    ] },
    { id: 'nota-credito-usar', grupo: 'cambios', p: 'vender', titulo: 'Cobrar con una nota de crédito', nuevo: '2026-10-31', resumen: 'En el cobro: {{Nota de crédito / gift card}} y el código.', bloques: [
      { tipo: 'pasos', items: ['Cargá lo que se lleva y tocá {{Cobrar}}.', 'Tocá {{Nota de crédito / gift card}} y escribí el **código** de 8 letras y números.', 'Si no alcanza, tocá otro medio para el resto.'] },
      { tipo: 'tip', texto: 'Si el resto lo paga con tarjeta, la nota vale más (ej. $2.500 en vez de $2.000): se ajusta solo.' }
    ] },
    { id: 'sin-ticket', grupo: 'cambios', p: 'vender', titulo: 'Cambio sin ticket', resumen: 'Se carga lo que trae al precio de hoy.', bloques: [
      { tipo: 'pasos', items: ['{{Cambio / devolución}} › {{Devolver sin ticket}}.', 'Tocá o escaneá lo que trae: entra como "devuelve" al precio de hoy.', 'Tocá {{Listo}} y cargá lo que se lleva.', 'Cobrá como siempre.'] },
      { tipo: 'tip', texto: 'Antes de hacerlo sin ticket, probá buscar la venta por el nombre o el teléfono de la clienta: casi siempre aparece.' }
    ] },

    // ======================= GIFT CARDS =======================
    { id: 'gift-vender', grupo: 'gift', p: 'vender', titulo: 'Vender una gift card', nuevo: '2026-10-31', resumen: 'Tocás GIFT CARD, elegís el valor y el código, y se cobra como cualquier venta.', bloques: [
      { tipo: 'pasos', items: [
        'En el Punto de venta buscá **GIFT CARD** y tocala.',
        'Elegí el **valor** (ej. $25.000). Abajo te muestra **cuánto paga según el medio**.',
        'Escribí el **código**: lo elige la clienta (ej. **#FELIZCUMPLE**) o tocá {{Inventar uno}}. Te avisa si ya existe. **Ideal: de 6 a 12 letras o números** (así se ve grande en la gift card; más largo entra, pero más chico).',
        'Si querés, completá **Para**, **De** y un **mensaje**: salen impresos en la gift card.',
        '{{Agregar al ticket}} y cobrá como siempre.',
        'Después de cobrar: {{Imprimir gift card}} o {{📷 WhatsApp (foto)}}.'] },
      { tipo: 'ejemplo', titulo: 'Gift card de $25.000', filas: [['Paga en efectivo o transferencia', '**$20.000**'], ['Paga con débito', '**$22.500**'], ['Paga con tarjeta', '**$25.000**'], ['Vale', '**$25.000** siempre (a precio de lista, como en la web)']] },
      { tipo: 'texto', texto: 'Con la tienda online conectada, al cobrar se crea solo un **cupón de descuento en la web** con el mismo código y el mismo valor, sin vencimiento. Así la puede usar en el local o en la web.' },
      { tipo: 'ojo', texto: 'Si dice **"⚠"** al lado de la gift card, el cupón de la web no se creó: tocá {{Reintentar}}, o después desde **Ventas** › {{Créditos}}. La gift card igual quedó hecha.' }
    ] },
    { id: 'gift-usar', grupo: 'gift', p: 'vender', titulo: 'Cobrar con una gift card', nuevo: '2026-10-31', resumen: 'En el cobro: {{Nota de crédito / gift card}} y el código.', bloques: [
      { tipo: 'pasos', items: ['Cargá lo que se lleva y tocá {{Cobrar}}.', 'Tocá {{Nota de crédito / gift card}} y escribí el **código** (ej. #FELIZCUMPLE).', 'Si no alcanza, tocá otro medio para el resto.'] },
      { tipo: 'texto', texto: 'La gift card vale su monto **a precio de lista**. Si el resto lo paga en efectivo, el sistema hace la cuenta solo (una de $25.000 cubre lo que en efectivo son $20.000).' },
      { tipo: 'tip', texto: 'Si se usa una parte, el saldo que queda sigue en la gift card, y el cupón de la web se actualiza solo. Si se usa en la web, se descuenta sola en el local.' }
    ] },
    { id: 'gift-cargar', grupo: 'gift', p: 'configuracion', titulo: 'Cargar una gift card a mano', nuevo: '2026-10-31', resumen: 'Para las vendidas por la web, por WhatsApp sin pasar por la caja, o las viejas.', bloques: [
      { tipo: 'pasos', items: ['**Ventas** › pestaña {{Créditos}} › {{🎁 Cargar gift card}}.', 'Poné el **valor** (precio de lista), el **código** que eligió la clienta, y si querés para, de y mensaje.', 'Anotá en la **nota interna** de dónde salió (ej. "vendida por la web, pedido #2420").', '{{Cargar}}: queda lista y, con la web conectada, se crea el cupón con ese código.'] },
      { tipo: 'tip', texto: 'Tocá la gift card en {{Créditos}} para imprimirla, mandarla por WhatsApp o ver cómo está su cupón en la web.' }
    ] },

    // ======================= CAJA =======================
    { id: 'movimientos', grupo: 'caja', p: 'vender', titulo: 'Sacar o poner plata en la caja', resumen: 'Pagos, retiros o cambio que entra: {{💵 Ingreso / retiro}}.', bloques: [
      { tipo: 'pasos', items: ['Arriba en el Punto de venta tocá {{💰 Caja}}.', '{{💵 Ingreso / retiro}}: elegí si sale o entra plata, el monto y el concepto (ej. "pago a proveedor").'] },
      { tipo: 'ojo', texto: 'Registrá **toda** plata que sale o entra del cajón sin ser venta. Si no, al cerrar la caja no cuadra.' },
      { tipo: 'tip', texto: '¿Lo cargaste mal o dos veces? En {{💰 Caja}}, al lado del movimiento, tocá {{✕}} y confirmá. Se puede mientras la caja está abierta (administración o quien lo cargó).' }
    ] },
    { id: 'cerrar-caja', grupo: 'caja', p: 'vender', titulo: 'Cerrar la caja', resumen: 'Contás cada medio, ves si cuadra y dejás el cambio para mañana.', bloques: [
      { tipo: 'pasos', items: [
        '{{💰 Caja}} › {{🌙 Cerrar caja}}: te muestra cómo te fue en el turno.',
        '**Contá lo que hay** en cada medio. El **efectivo** viene vacío: contalo de verdad y escribí cuánto hay (o usá {{🧮 Contar billetes}}). Los demás medios vienen con lo que debería haber: corregilos si no coincide. Si cuadra, queda en **verde**.',
        'Decí **cuánto retirás**: lo que queda es el **cambio para mañana**.',
        'Imprimí el resumen o mandalo por {{WhatsApp}}.'] },
      { tipo: 'ojo', texto: 'Si no cuadra, revisá antes de cerrar: un retiro sin registrar, una venta cobrada con otro medio, un vuelto mal dado.' },
      { tipo: 'texto', texto: '**🌐 Fuera de la caja:** al cerrar también aparecen, aparte, los **pedidos de la web** y las ventas cargadas **con la caja cerrada** desde el cierre anterior (por ejemplo, un pedido de la noche). No van al cajón ni al arqueo, pero suman al **total del día**.' }
    ] },

    // ======================= CONSULTAS =======================
    { id: 'cambiar-precio', grupo: 'consultas', p: 'catalogo_editar', titulo: 'Cambiar el precio de una prenda', nuevo: '2026-10-31', resumen: 'En la ficha del producto: {{Cambiar precio}} en la fila de Lista; las demás listas bajan solas.', bloques: [
      { tipo: 'pasos', items: [
        '**Catálogo** › abrí la prenda.',
        'En **Precios por lista**, fila **Lista**: {{Cambiar precio}}.',
        'Escribí el precio nuevo (podés poner **18.750** o **18750**): abajo ves al instante cómo quedan las demás listas (Contado, Débito…).',
        '{{Guardar}}. Las demás listas se calculan solas, en escalera.'] },
      { tipo: 'tip', texto: '**Precio especial** (en otra lista) es solo para casos raros: fija el precio de ESA lista y deja de seguir al de Lista. Con {{Volver a la regla}} vuelve a calcularse solo.' },
      { tipo: 'tip', texto: 'El **redondeo** de cada lista (por ejemplo, para arriba a $10) se configura en **Configuración** › {{Listas de precios}}.' }
    ] },
    { id: 'ventas', grupo: 'consultas', p: ['ventas_propias', 'ventas_todas'], titulo: 'Ver las ventas', resumen: '**Ventas**: tickets, señas, notas de crédito y cierres.', bloques: [
      { tipo: 'tabla', filas: [['Tocar un ticket', 'ver el detalle, {{Reimprimir}}, {{Editar}} o hacer un {{Cambio / devolución}} desde ahí'], ['{{Señas}}', 'las señas pendientes: {{Retirar en la caja}} o {{🎟️ Comprobante}} para reenviarlo'], ['{{Créditos}}', 'notas de crédito: tocá una para verla, imprimirla o mandarla por WhatsApp']] },
      { tipo: 'tip', texto: 'La etiqueta del canal (Local, WhatsApp, Web) se puede tocar para corregirla si quedó mal.' }
    ] },
    { id: 'lo-que-piden', grupo: 'consultas', p: ['vender', 'compras'], titulo: 'Lo que piden: para reponer y avisar', nuevo: '2026-10-31', resumen: 'En el menú, **Lo que piden**: todo lo anotado, agrupado por prenda.', bloques: [
      { tipo: 'texto', texto: 'Muestra cada prenda pedida con **cuántas veces la pidieron**, qué talles y colores, quiénes, y **si hoy ya hay stock**. Lo más pedido va arriba, y lo que ya llegó aparece primero con **✓ ya hay stock: avisales**.' },
      { tipo: 'pasos', items: [
        'Cuando llega o se consigue: {{✓ Conseguido}} (o {{✓ Conseguido (todos)}} para toda la prenda).',
        'Para avisarle a la clienta: {{📲 Avisarle}} abre WhatsApp con el mensaje listo ("Ya tenemos … que nos pediste. ¿Querés que te lo guardemos?") y queda como **Avisada**.',
        'Si no tiene teléfono y le avisaste de otra forma: {{Ya le avisé}}.',
        'Si no se va a conseguir o ya no lo quiere: {{✕}} (descartar).'] },
      { tipo: 'tip', texto: 'Arriba podés ver las {{Avisadas}} y los {{Descartados}}, o anotar un pedido nuevo con {{📝 Anotar un pedido}}.' }
    ] },
    { id: 'pendientes', grupo: 'consultas', p: 'vender', titulo: '📌 Pendientes', resumen: 'Las prendas vendidas que quedaron sin definir el modelo.', bloques: [
      { tipo: 'texto', texto: 'Cuando una prenda de código común (ej. BOMBIS «VARIAS») se vendió sin decir qué modelo era, queda en **📌 Pendientes** (arriba de la pantalla, o en el ticket del Punto de venta).' },
      { tipo: 'pasos', items: ['Tocá **📌 Pendientes**.', 'Elegí qué modelo fue cada una (o {{+ BOMBIS «LOCAL»}} si no está en la web).'] }
    ] },

    // ======================= COMPRAS =======================
    { id: 'compras-ingresar', grupo: 'compras', p: 'compras', titulo: 'Ingresar mercadería (llegó un remito)', nuevo: '2026-11-03', resumen: 'Se carga como viene el remito y entra sola al stock del local y de la web.', bloques: [
      { tipo: 'pasos', items: ['Menú **Compras e ingresos** › {{📦 Ingresar mercadería}} (también está en el **Catálogo**).', 'Elegí el **proveedor** y poné el **número de remito**, la **fecha** y el **descuento %** si tiene.', 'Copiá el remito **renglón por renglón**: cómo lo llama el proveedor (ej. **MIA ROSA**), qué prenda es en Augusta y el color.', 'Poné cuántas llegaron de **cada talle** y el **costo** de cada una (el del remito, sin el descuento).', 'Mirá abajo: las **prendas** y el **total** tienen que dar igual que el remito.', 'Tocá {{📦 Ingresar al stock}} › {{Sí, ingresar al stock}}. Al final te ofrece {{🏷️ Imprimir etiquetas}}.'] },
      { tipo: 'ejemplo', titulo: 'Un renglón del remito de Concepto', filas: [['En el remito', 'MIA · ROSA · S 3 · M 2 · XL 3 · $22.000'], ['Cómo dice el remito', '**MIA ROSA**'], ['Prenda de Augusta', '**PIJAMA «CIELO»**, color **Rosa**'], ['Cantidad por talle', 'S **3** · M **2** · XL **3**'], ['Costo c/u', '**22.000**']] },
      { tipo: 'texto', texto: 'Al ingresar: el **stock** sube, la **web** se actualiza sola en un minuto, el **costo** de la prenda queda con el descuento del remito y se suma a la **cuenta del proveedor**.' },
      { tipo: 'tip', texto: 'Los renglones quedan **en el orden en que los cargaste**, como en el papel: al guardar, al abrirlo de nuevo y al corregirlo. Y {{+ Prenda nueva}} entra en el renglón donde estabas.' },
      { tipo: 'ojo', texto: '**No cargues el stock a mano en Tienda Nube.** Percha manda el stock a la web: lo que se carga solo allá se borra con la próxima venta. Todo lo que entra, entra por acá.' },
      { tipo: 'tip', texto: 'Si llega un **color o estampa que la prenda no tiene**, elegí {{+ Color nuevo…}} en el color (también en la ventana **¿Qué modelos son?**: {{+ Color o estampa nuevo…}}): se crea ahí mismo con todos sus talles. Si es una **prenda nueva**, tocá {{+ Prenda nueva en el catálogo}}, creala y al volver ya aparece.' }
    ] },
    { id: 'prenda-nueva', grupo: 'compras', p: 'catalogo_editar', titulo: 'Cargar una prenda nueva (por ejemplo, bombachas que entraron)', nuevo: '2026-11-11', resumen: 'Elegís la familia y el código, el precio y los talles se completan solos. Queda para vender, en la web (oculta) y dentro de «BOMBIS VARIAS».', bloques: [
      { tipo: 'pasos', items: [
        'Desde el remito tocá {{+ Prenda nueva}} (o en **Catálogo** › {{+ Nuevo producto}}). Se abre en otra pestaña.',
        'Elegí la **Familia** (por ejemplo BOMBACHAS): el **código** sale solo (el que sigue en la familia) y el **precio** también (el que más se usa en esa familia).',
        'Si es parecida a otra (misma tela o estilo), escribí parte del nombre o el código en **Parecida a** y elegila de la lista (con las flechas y Enter, o tocándola): copia familia, precio, costo, proveedor y talles, y pone el **código que sigue** en esa familia.',
        'Poné el **nombre** como el resto (ej. LESS «NOMBRE» ALGODÓN) y tocá {{Crear producto}}.',
        'Se abre sola la ventana de **talles y colores**: los talles ya vienen marcados; elegí los colores y tocá {{Guardar}}. Si un color o estampa **no está en la lista**, escribilo en el buscador y tocá {{+ Crear como color o estampa nuevo}}: queda creado y elegido.',
        'Si venías del remito, la prenda ya aparece en el renglón: cargá las cantidades por talle y listo.'] },
      { tipo: 'tip', texto: 'Al crearla ya se puede vender suelta o con **BOMBIS «VARIAS»** (el código general: al cobrar se elige el modelo), y se sube sola a la web **oculta** para ponerle fotos.' },
      { tipo: 'tip', texto: 'No hace falta inventar el código: Percha saltea los que ya existen o que usa alguna publicación vieja de la web.' },
      { tipo: 'tip', texto: '**Para sumar o sacar talles y colores** de una prenda que ya existe: en su ficha tocá {{Talles y colores}}. **Marcado = la prenda lo tiene**: tildá lo que falta y destildá lo que no va, y tocá {{Guardar}}. Lo destildado deja de ofrecerse en la caja y en la web (no se borra el historial). Si un talle o color tiene stock, no se saca: primero corregí el stock.' },
      { tipo: 'tip', texto: '**Talles de bombachas en rango** (S al L, XL al 2XL…): en la ventana de talles tocá la escala **Bombachas**. Los talles grandes se escriben **2XL, 3XL, 4XL** (no XXL). Si en la web dicen XXL, Percha igual los reconoce como el mismo talle. Para sumar un talle a una escala: Configuración › Talles, colores y familias, tocás el talle y elegís la escala.' }
    ] },
    { id: 'compras-corregir', grupo: 'compras', p: 'compras', titulo: 'Me equivoqué al cargar un remito', nuevo: '2026-11-11', resumen: 'Se corrige el remito y Percha ajusta solo el stock, el costo y la cuenta del proveedor.', bloques: [
      { tipo: 'pasos', items: [
        'En **Compras e ingresos** abrí el remito y tocá {{✏️ Corregir remito}}.',
        'Cambiá lo que esté mal: cantidades por talle, la prenda o el color, el costo, el proveedor o el número de remito. Podés agregar o quitar renglones.',
        'Tocá {{💾 Guardar corrección}}: antes de guardar te muestra **qué entra y qué sale del stock**, qué costo cambia y cómo queda la cuenta del proveedor. Escribí qué pasó y confirmá.'] },
      { tipo: 'tip', texto: 'Solo se mueve **la diferencia**: si cargaste 3 y eran 2, sale 1 del stock (y de la web). En el historial de la prenda queda como «Corrección de la compra».' },
      { tipo: 'tip', texto: 'Si el remito entero no correspondía, en la corrección tocá {{Anular el remito}}: sale del stock todo lo que había entrado y se descuenta de la cuenta del proveedor.' }
    ] },
    { id: 'codigos-generales', grupo: 'compras', p: 'catalogo_ver', titulo: 'Códigos generales (BOMBIS «VARIAS», MEDIAS VARIAS)', nuevo: '2026-11-11', resumen: 'Sirven para lo que tiene muchos modelos: se usa el código general y Percha pregunta qué modelos son, en la caja y en los remitos.', bloques: [
      { tipo: 'pasos', items: [
        'Están todos en **Catálogo › Códigos generales**. Cada uno muestra **la lista de modelos que incluye** (con buscador) y cuántas unidades quedaron sin identificar.',
        'Si un modelo **no va**, tocá {{Sacar}} al lado: deja de ofrecerse en la caja y en los remitos (queda en «Sacados a mano», con {{Volver a sumar}}). Si **falta** uno de otra familia, buscalo en {{+ Sumar un modelo}}.',
        '**En un remito**: elegí el código general (ej. BOMBIS «VARIAS») y se abre **¿Qué modelos son?**. Poné cuántas vinieron, buscá cada modelo, elegí el color y cargá los talles. Si un modelo no existe, tocá {{+ Modelo nuevo}}: se crea y vuelve solo a la ventana.',
        'Cuando estén todas, tocá {{Listo}}: quedan los renglones de cada modelo. Si no sabés alguna, {{Dejar sin identificar}}.',
        '**En la caja**: se cobra con el código general y, antes de cerrar la venta, Percha pregunta qué modelo se llevó.'] },
      { tipo: 'tip', texto: 'Las prendas **nuevas** de la familia entran solas en la lista: no hay que tocar nada. **Para cargar una bombacha nueva NO se crea un código general**: se crea la prenda (Catálogo › {{+ Nuevo producto}} o desde el remito) y aparece sola en BOMBIS «VARIAS».' },
      { tipo: 'tip', texto: 'Si se creó uno **por error**: si en realidad es una prenda, tocá {{No es código general}} (pasa a ser un modelo más); si no sirve, {{Eliminar}}. Para otro grupo grande (ej. pantuflas): {{+ Otro código general}}. Para cambiar la familia o las palabras: {{Cambiar la regla}}.' },
      { tipo: 'tip', texto: '**En la web cada prenda lleva su propio código, el de Percha** (no el general): Percha manda. Cada 10 minutos revisa los códigos de Tienda Nube y corrige solo los que no coinciden. Si cambiás un código en Percha, en la web se cambia solo; si lo cambian a mano en Tienda Nube, Percha lo vuelve a poner. Las ventas de la web siempre descuentan del modelo.' }
    ] },
    { id: 'compras-nombres', grupo: 'compras', p: 'compras', titulo: 'El proveedor le dice de otra forma', nuevo: '2026-11-03', resumen: 'La primera vez elegís qué prenda es; después Percha la reconoce sola.', bloques: [
      { tipo: 'texto', texto: 'Cada proveedor tiene sus nombres (para Concepto, **MIA** es el pijama **CIELO** y **MORA** es el **MAGNOLIA**). La primera vez escribís cómo dice el remito y elegís la prenda de Augusta. **Percha lo aprende para ese proveedor.**' },
      { tipo: 'texto', texto: 'La próxima vez, cuando escribas **MIA ROSA**, te propone **PIJAMA «CIELO» Rosa** y queda marcado **✓ Percha ya lo conocía**. Solo ponés las cantidades.' },
      { tipo: 'tip', texto: 'Si el remito dice el color (ej. **MORA MINI CHERRY**) y la prenda tiene ese color, Percha lo elige solo.' }
    ] },
    { id: 'compras-pedido', grupo: 'compras', p: 'compras', titulo: 'Lo pedido que todavía no llegó', nuevo: '2026-11-03', resumen: 'Se anota como pedido; cuando llega, un toque y entra.', bloques: [
      { tipo: 'pasos', items: ['**Compras e ingresos** › {{📝 Anotar un pedido}}: cargalo igual que un remito y tocá {{💾 Guardar pedido}}.', 'Queda arriba de todo en **Compras e ingresos**, esperando.', 'Cuando llega, tocá {{📦 Llegó: ingresarlo}}, revisá y {{📦 Ya llegó: ingresar al stock}}.'] },
      { tipo: 'tip', texto: '¿Llegó **solo una parte**? Cuando pregunta si llegó todo, tocá {{Llegó solo una parte}} y poné cuántas llegaron de cada una. Lo que falta queda esperando en la misma compra.' },
      { tipo: 'tip', texto: 'Si lo que falta **ya no va a llegar**, abrí la compra y tocá {{El resto no va a llegar}}: queda cerrada con lo que llegó y el total pasa a ser el de lo recibido.' },
    ] },

    { id: 'precio-oferta', grupo: 'compras', p: 'catalogo_editar', titulo: 'Precio de lista y oferta', nuevo: '2026-11-03', resumen: 'Una prenda en oferta: el de lista tachado, en el local, en la web o en los dos.', bloques: [
      { tipo: 'pasos', items: ['Abrí la prenda en el **Catálogo**.', 'En **Precios por lista**, el de **Lista** es el precio regular (ej. **$75.000**).', 'Tocá {{▼ Poner oferta}} y escribí a cuánto se vende (ej. **59.990**).', 'Elegí **dónde vale**: {{En los dos}}, {{Solo en el local}} o {{Solo en la web}}, y tocá {{Guardar}}.'] },
      { tipo: 'tabla', filas: [['En los dos', 'en la caja y en la web se ve el de Lista tachado'], ['Solo en el local', 'en la caja (local, WhatsApp y otras ventas de Percha); la web sigue al de Lista'], ['Solo en la web', 'en Tienda Nube; la caja sigue al de Lista']] },
      { tipo: 'texto', texto: '**Contado** y **Débito** parten del precio de oferta. La web se actualiza sola en unos minutos.' },
      { tipo: 'texto', texto: '**Mayorista** va siempre sobre el precio de **Lista regular** (el tachado): no toma ofertas ni promociones (packs, N×M, % off).' },
      { tipo: 'tip', texto: 'Para cambiarla o sacarla: {{Cambiar oferta}} › nuevo precio o dónde vale, o {{Quitar oferta}} (vuelve al de Lista).' },
      { tipo: 'ojo', texto: 'No uses **Precio especial** para una oferta: ese cambia el precio de **una sola lista** y no se ve tachado. Y no cambies precios en Tienda Nube: todo se hace en Percha.' }
    ] },

    { id: 'etiquetas-imprimir', grupo: 'compras', p: 'catalogo_ver', titulo: 'Imprimir etiquetas con código de barras', nuevo: '2026-11-09', resumen: 'Desde la ficha o el remito se juntan las etiquetas; en Etiquetas tildás cuáles, elegís qué precio mostrar e imprimís en la Brother.', bloques: [
      { tipo: 'pasos', items: [
        'En la ficha de la prenda tocá {{Etiquetas de todo el stock}} (o, al ingresar un remito, {{🏷️ Imprimir etiquetas}}). Te lleva a **Catálogo › Etiquetas**.',
        '**Tildá** las que querés imprimir (la casilla de arriba tilda o destilda todas) y ajustá la **cantidad** de cada una.',
        'En **Precio** elegí: **de lista**, **con la oferta** (el de lista tachado y el de oferta), **solo el precio final** o **sin precio**.',
        'Tocá {{Imprimir}}. La **primera vez** en esa compu, en la ventana de impresión: **Impresora** Brother TD-4000 · en **Más opciones**: **Tamaño del papel** = el de la etiqueta, **Márgenes** = Ninguno, **Escala** = 100, y destildá **Encabezados y pies de página**.'] },
      { tipo: 'tip', texto: '¿Sale corrida o cortada? Primero poné en **Ancho** y **Alto** la **medida real** de la etiqueta. Después tocá {{🎯 Imprimir prueba}}: sale una etiqueta con un marco y una **regla en mm**. Si a la izquierda el primer número que se ve es, por ejemplo, **10**, poné **Correr → 10** (si se corta arriba, lo mismo con **Correr ↓**). Lo mejor es que en la ventana de impresión el **Tamaño del papel** sea exactamente el de la etiqueta (si no aparece, se crea en las preferencias de la impresora Brother). Cuando quede bien, administración toca {{Guardar como predeterminado}} y queda así en todas las compus.' },
      { tipo: 'tip', texto: 'En la caja, escaneás la etiqueta y la prenda entra sola al ticket.' }
    ] },
    { id: 'web-conectar', grupo: 'compras', p: 'configuracion', titulo: 'Publicaciones de la web sin conectar y stock a decidir', nuevo: '2026-11-06', resumen: 'Si algo de la web no está conectado a su prenda, o se conectó con otro stock, el Inicio avisa y vos decidís.', bloques: [
      { tipo: 'pasos', items: [
        'En el **Inicio**, en «Para mirar», aparece **🔌 Publicaciones de la web sin conectar** cuando hay algo publicado en Tienda Nube que Percha no controla (por ejemplo, una publicación creada a mano en Tienda Nube).',
        'Tocalo: abre **Cruce de productos › Sin cruzar**. En cada una tocá {{Cruzar}} y elegí la prenda del local.',
        'Si al conectar el stock **no coincide**, Percha pregunta **¿Cuál stock vale?**: {{Vale Tienda Nube}} pone en el local lo que dice la web; {{Vale el local}} manda a la web lo del local.'] },
      { tipo: 'tip', texto: 'Mientras no elijas, Percha **no le manda nada a la web** de esa prenda. Lo pendiente queda en **⚖️ Stock a decidir con la web** (Inicio) y en la pestaña **A decidir** del Cruce.' },
      { tipo: 'tip', texto: 'Lo que se crea en Percha va a la web ya conectado y con el mismo stock: no hay que hacer nada.' }
    ] },
    { id: 'prenda-a-la-web', grupo: 'compras', p: 'catalogo_editar', titulo: 'Prenda nueva o color nuevo: va sola a la web', nuevo: '2026-11-04', resumen: 'Se crea en Percha y aparece en Tienda Nube OCULTA, para cargarle las fotos.', bloques: [
      { tipo: 'pasos', items: ['Creá la prenda en Percha (o agregale el color nuevo, también desde una compra).', 'En unos minutos aparece en **Tienda Nube, oculta**, con sus talles y colores, el precio y el stock.', 'En Tienda Nube cargale las **fotos**, la descripción y la categoría, y **mostrala** desde allá.', 'Las fotos vuelven solas a Percha, cada una con su color.'] },
      { tipo: 'tabla', filas: [['Prenda nueva', 'una publicación nueva, oculta'], ['Color nuevo', 'oculto: en la publicación de la prenda, o en una publicación nueva si la prenda tiene una por color'], ['Talle nuevo de un color que ya está', 'se suma a esa publicación (ya tiene fotos)']] },
      { tipo: 'texto', texto: 'En la ficha de la prenda, **En la web** dice en qué anda: "se sube en unos minutos", "oculta: cargale fotos" o "visible".' },
      { tipo: 'tip', texto: 'Si una prenda es **solo del local**, en la ficha poné **En la web: No**. Las prendas que ya estaban solo en el local no se suben solas.' },
      { tipo: 'ojo', texto: 'En Tienda Nube solo se cargan **fotos, textos y categorías** y se muestra u oculta. **Stock y precios se manejan en Percha.**' }
    ] },

    { id: 'canje', grupo: 'consultas', p: 'ventas_todas', titulo: 'Canje con una influencer', nuevo: '2026-11-05', resumen: 'Prendas sin cargo que salen del stock pero no cuentan como venta.', bloques: [
      { tipo: 'pasos', items: ['**Ventas** › pestaña {{Canjes}} › {{🤝 Nuevo canje}}.', 'Poné la **fecha**, la **clienta** (si es nueva, con teléfono) y buscá las **prendas** que se lleva.', 'Si se le mandó: elegí la **entrega** (cadete, correo), lo que **pagó el local** por el envío y la dirección.', 'Tocá {{Registrar canje}} y, si querés, imprimí el **remito de canje**.'] },
      { tipo: 'texto', texto: 'Las prendas **salen del stock** (y de la web), pero el canje **no cuenta como venta**: no aparece en el Inicio, ni en las métricas, ni en el cierre de caja, y no se factura.' },
      { tipo: 'tip', texto: 'En {{Canjes}} se ve cuántos canjes hubo, cuántas prendas, cuánto valen a precio de lista y **cuánto le costaron al local** (prendas + envíos).' }
    ] },

    // ======================= ATAJOS =======================
    { id: 'teclado', grupo: 'atajos', p: 'vender', titulo: 'Atajos de teclado', resumen: 'Para vender rápido combinando mouse y teclado.', bloques: [
      { tipo: 'tabla', filas: [
        ['[[/]]', 'ir al buscador'], ['[[↑]] [[↓]] + [[Enter]]', 'recorrer las prendas y agregar'], ['**3*** antes de elegir', 'llevar 3 de la próxima'],
        ['[[+]] [[-]] (buscador vacío)', 'cambiar la cantidad del renglón marcado'], ['[[Supr]]', 'quitar el renglón marcado'], ['[[Alt]]+[[↑]] [[↓]]', 'marcar otro renglón'],
        ['[[F2]]', 'cambiar el precio del renglón'], ['[[F4]]', 'abrir Más… (clienta, nota, entrega, descuento, canal)'], ['[[F9]] o [[Ctrl]]+[[Enter]]', 'cobrar'],
        ['[[1]] a [[9]] (en el cobro)', 'elegir el medio de pago'], ['[[Enter]] (después de cobrar)', 'nueva venta']] }
    ] },

    // ======================= PALABRAS =======================
    { id: 'glosario', grupo: 'palabras', titulo: 'Qué quiere decir cada cosa', nuevo: '2026-10-31', resumen: 'Las palabras de Percha, explicadas en una línea.', bloques: [
      { tipo: 'tabla', filas: [
        ['Lista', 'el precio normal de la prenda (tarjeta, cuotas, QR)'],
        ['Contado', 'el precio pagando en efectivo o transferencia'],
        ['Canal', 'por dónde vino la venta: Local, WhatsApp o Web'],
        ['Código común', 'un código para vender rápido muchas prendas parecidas (ej. BOMBIS «VARIAS»); al cobrar se elige el modelo'],
        ['📌 Pendientes', 'prendas vendidas que quedaron sin decir qué modelo eran'],
        ['Falla', 'una unidad con algún defecto; no se muestra en la web'],
        ['Seña', 'pago a cuenta: las prendas quedan reservadas y el resto se cobra al retirar, con el número del comprobante'],
        ['Nota de crédito', 'saldo a favor de la clienta, con un código para usarlo después'],
        ['Gift card', 'un regalo con código: vale su monto a precio de lista, en el local y en la web'],
        ['Turno o caja', 'desde que abrís la caja hasta que la cerrás'],
        ['Arqueo', 'contar la plata al cerrar y ver si coincide con lo vendido'],
        ['Lo que piden', 'lo que las clientas pidieron y no había, anotado para reponerlo y avisarles']] }
    ] }
  ]
};
