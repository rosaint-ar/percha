/* Percha · Instructivo: lo que la vendedora tiene que saber, tema por tema.
   Para sumar o corregir un tema se edita SOLO este archivo; la pantalla (instructivo.html) lo arma sola.
   Marcas en los textos: **negrita** · [[F2]] tecla · {{Botón}} botón o pestaña de la pantalla.
   Tipos de bloque: texto · pasos · ojo (cuidado) · tip · ejemplo (titulo + filas [a, b]) · tabla (filas [a, b]) · decir (qué decirle a la clienta). */
window.INSTRUCTIVO = {
  actualizado: '2026-10-31',
  grupos: [
    { id: 'dia', titulo: 'Empezar el día', icono: '☀️' },
    { id: 'vender', titulo: 'Vender', icono: '🛍️' },
    { id: 'cambios', titulo: 'Cambios y devoluciones', icono: '🔁' },
    { id: 'caja', titulo: 'La caja', icono: '💵' },
    { id: 'consultas', titulo: 'Consultar y corregir', icono: '🔎' },
    { id: 'atajos', titulo: 'Atajos de teclado', icono: '⌨️' }
  ],
  temas: [
    // ======================= EMPEZAR EL DÍA =======================
    { id: 'entrar', grupo: 'dia', titulo: 'Entrar a Percha', resumen: 'En la compu del local se entra con tu PIN de 4 números.', bloques: [
      { tipo: 'pasos', items: ['Abrí Percha y tocá tu nombre.', 'Escribí tu **PIN de 4 números**.', 'Listo: entrás directo.'] },
      { tipo: 'tip', texto: 'El PIN funciona solo en las compus donde ya lo activaste. En otra compu se entra con el correo y la contraseña, y ahí mismo te ofrece elegir un PIN.' },
      { tipo: 'ojo', texto: 'Si te equivocás **5 veces**, el PIN de esa compu se apaga. Avisale a Emi para que te lo vuelva a habilitar.' }
    ] },
    { id: 'abrir-caja', grupo: 'dia', titulo: 'Abrir la caja', resumen: 'Al entrar al Punto de venta te pide abrir la caja con el efectivo que hay.', bloques: [
      { tipo: 'pasos', items: ['Entrá a **Punto de venta**. Si la caja está cerrada, aparece "Abramos la caja".', 'Te muestra el cambio que quedó en el último cierre. **Contá el efectivo del cajón.**', 'Si está igual, tocá {{🔓 Abrir caja}}. Si no, escribí lo que contaste y después abrí.'] },
      { tipo: 'tip', texto: 'Con {{🧮 Contar billetes}} cargás cuántos billetes hay de cada uno y la suma se hace sola.' },
      { tipo: 'ojo', texto: 'Sin la caja abierta no se puede cobrar. Si tocaste "Después", abrila con {{🔓 Abrir caja}} arriba de todo.' }
    ] },

    // ======================= VENDER =======================
    { id: 'pantalla', grupo: 'vender', titulo: 'La pantalla de venta', resumen: 'Buscador arriba, prendas en el medio, ticket a la derecha.', bloques: [
      { tipo: 'pasos', items: [
        '**Buscá** escribiendo parte del nombre (ej. "alon" para Alondra) o **escaneá** el código: con el lector, la prenda entra sola al ticket.',
        'Tocá una prenda y elegí **talle y color** en la ventanita.',
        'Sin buscar, ves los **★ Más vendidos**.',
        'Arriba del ticket está el **número de ticket** desde que empezás. Sirve para anotarlo en el paquete, por ejemplo si después hay un cambio.'] },
      { tipo: 'tip', texto: 'Para cambiar el talle o el color de algo que ya está en el ticket, **tocá el nombre o el talle** en el renglón. No hace falta borrarlo y cargarlo de nuevo.' },
      { tipo: 'tip', texto: 'Para llevar varias iguales: tocá **+** en el renglón, o escribí **3*** en el buscador antes de elegir la prenda.' }
    ] },
    { id: 'precios', grupo: 'vender', titulo: 'Los precios cambian según cómo paga', resumen: 'El sistema pone solo el precio según el medio de pago.', bloques: [
      { tipo: 'texto', texto: 'Cada prenda tiene su precio de **Lista**. Según cómo paga la clienta, el precio baja solo:' },
      { tipo: 'tabla', filas: [['Efectivo o transferencia', 'precio **Contado** (20% menos)'], ['Débito', 'precio **Débito** (10% menos)'], ['Tarjeta de crédito, cuotas, Mercado Pago, MODO', 'precio **Lista**']] },
      { tipo: 'texto', texto: 'No tenés que calcular nada: al tocar el medio de pago en el cobro, el ticket pasa a esa lista. También podés elegir la lista arriba del ticket si la clienta pregunta antes.' }
    ] },
    { id: 'cobrar', grupo: 'vender', titulo: 'Cobrar', resumen: '{{Cobrar}}, tocás el medio de pago y confirmás.', bloques: [
      { tipo: 'pasos', items: [
        'Tocá {{Cobrar}} (o [[F9]]).',
        'Tocá el **medio de pago**: se completa solo con lo que falta.',
        '**Paga con dos medios?** Tocá el primero, corregí el importe y tocá el segundo: se completa con el resto.',
        '**Efectivo con vuelto:** escribí con cuánto paga y te muestra el vuelto.',
        'Cuando dice **Completo ✓**, tocá {{Confirmar}}.',
        'Después podés {{Imprimir ticket}} o mandarlo por {{WhatsApp}}. Enter = {{Nueva venta}}.'] },
      { tipo: 'tip', texto: 'Con el teclado: en el cobro, los números **1 a 9** eligen el medio de pago.' }
    ] },
    { id: 'mas', grupo: 'vender', titulo: 'Clienta, nota, descuento y canal', resumen: 'Todo eso está en {{Más…}} ([[F4]]).', bloques: [
      { tipo: 'tabla', filas: [['Clienta', 'empezá a escribir el nombre; si es nueva, se crea sola'], ['Nota', 'ej. "regalo", "cambio antes del 15/11"'], ['🚚 Entrega', 'si se lo mandan: queda en **Envíos** para despachar'], ['Descuento %', 'para todo el ticket'], ['Canal', 'Local, WhatsApp o Web: de dónde vino la venta']] },
      { tipo: 'tip', texto: 'Cargá la clienta siempre que puedas: después es mucho más fácil encontrar su compra para un cambio.' }
    ] },
    { id: 'precio-mano', grupo: 'vender', titulo: 'Cambiar un precio a mano', resumen: 'Solo para corregir un error: [[F2]] y escribís el precio.', bloques: [
      { tipo: 'pasos', items: ['Tocá el **precio del renglón** (a la derecha) o apretá [[F2]].', 'Escribí el precio y Enter.', 'Queda marcado "Precio cambiado a mano".'] },
      { tipo: 'tip', texto: 'Para volver al precio normal, borrá el número o escribí el de lista.' },
      { tipo: 'ojo', texto: 'Usalo solo para errores. Las ofertas y los descuentos por medio de pago se aplican solos.' }
    ] },
    { id: 'fallas', grupo: 'vender', titulo: 'Prendas con falla', resumen: 'Si la prenda tiene falla, marcala en el renglón.', bloques: [
      { tipo: 'texto', texto: 'Cuando hay unidades con falla de esa prenda, en el renglón aparece **"◆ Hay N con falla · ¿es esta?"**.' },
      { tipo: 'pasos', items: ['Si la que se lleva es la de la falla, tocá ese botón.', 'Queda **"◆ Con falla"** y, si tiene descuento, se aplica solo.'] },
      { tipo: 'ojo', texto: 'Marcala siempre: así el stock de la web queda bien (las de falla no se muestran en la web).' }
    ] },
    { id: 'sin-stock', grupo: 'vender', titulo: 'Si dice "sin stock"', resumen: 'El sistema avisa pero nunca te frena la venta.', bloques: [
      { tipo: 'texto', texto: 'Si en el renglón aparece **⚠ sin stock** o al cobrar te dice "el sistema dice que hay N", es porque el número cargado no coincide con lo que tenés en la mano.' },
      { tipo: 'pasos', items: ['Fijate que sea **la prenda, el talle y el color correctos**.', 'Si está bien, **vendé igual**: queda un aviso para corregir el stock en Inventario.'] }
    ] },
    { id: 'genericos', grupo: 'vender', titulo: 'Bombachas varias y otros códigos comunes', resumen: 'BOMBIS «VARIAS», PANTUFLÓN «ANIMADOS», CHUNAS y MEDIAS VARIAS: se venden rápido y al cobrar se elige el modelo.', bloques: [
      { tipo: 'texto', texto: 'Algunas prendas se cargan con un **código común** para vender rápido: **BOMBIS «VARIAS»**, **PANTUFLÓN «ANIMADOS»**, **CHUNAS «VARIAS»** y **MEDIAS VARIAS**.' },
      { tipo: 'pasos', items: [
        'Cargalas en el ticket como cualquier prenda.',
        'Al tocar {{Cobrar}} aparece **"¿Qué modelos se lleva?"**.',
        'Buscá cada una con pocas letras (ej. **fru cel** = Fru Fru celeste) y tocala.',
        'Si es una que **no está en la web**, tocá {{+ BOMBIS «LOCAL»}} (o {{+ MEDIAS «LOCAL»}}).',
        'Si no sabés cuál es, seguí: queda en **📌 Pendientes** para definirla después.'] },
      { tipo: 'ojo', texto: 'Definí el modelo siempre que puedas: así el stock de la web se descuenta bien.' }
    ] },
    { id: 'conjuntos', grupo: 'vender', titulo: 'Conjuntos: solo corpiño o cambio de bombacha', resumen: 'Dos botones en el renglón del conjunto.', bloques: [
      { tipo: 'tabla', filas: [
        ['{{Solo corpiño}}', 'Se lleva el corpiño sin la bombacha: el total baja **$5.000** y la bombacha queda en el local (BOMBIS «LOCAL»).'],
        ['{{Cambio bombacha}}', 'Se lleva el conjunto pero cambia la bombacha por una suelta del "arma tu pack": **no paga diferencia**. Al cobrar elegís cuál se llevó.']] },
      { tipo: 'tip', texto: 'La bombacha que se lleva en el cambio se elige en la misma ventana "¿Qué modelos se lleva?" y va sin cargo.' }
    ] },
    { id: 'sena', grupo: 'vender', titulo: 'Dejar una seña', resumen: 'Paga una parte ahora y el resto al retirar.', bloques: [
      { tipo: 'pasos', items: ['Cargá las prendas y tocá {{Dejar seña}}.', 'Propone la **mitad**: cambiala si deja otro monto.', 'Cuando vuelve a retirar: **Ventas** › pestaña {{Señas}} › {{Cobrar saldo y entregar}}.'] }
    ] },
    { id: 'prueba', grupo: 'vender', titulo: 'Si una venta fue de prueba o te equivocaste', resumen: '{{🧪 Era de prueba}} la borra como si no hubiera existido.', bloques: [
      { tipo: 'texto', texto: 'En la ventana que aparece después de cobrar está {{🧪 Era de prueba}}: borra la venta, devuelve el stock (también en la web) y la saca de la caja.' },
      { tipo: 'tip', texto: 'Si te diste cuenta más tarde, buscala en **Ventas**, tocala y usá el mismo botón, o {{Editar}} para corregir algo.' }
    ] },
    { id: 'sin-internet', grupo: 'vender', titulo: 'Si se corta internet', resumen: 'Seguí vendiendo: las ventas se guardan y se suben solas.', bloques: [
      { tipo: 'texto', texto: 'La caja sigue funcionando. Arriba vas a ver **"N ventas por subir"**: cuando vuelve internet se suben solas.' },
      { tipo: 'ojo', texto: 'Sin internet no se pueden buscar ventas viejas (para un cambio) ni usar notas de crédito. Esperá a que vuelva.' }
    ] },

    // ======================= CAMBIOS =======================
    { id: 'cambios-regla', grupo: 'cambios', titulo: 'La regla de los cambios', nuevo: '2026-10-31', resumen: 'Lo que devuelve vale lo que pagó, con el medio con que pagó. El sistema hace la cuenta solo.', bloques: [
      { tipo: 'texto', texto: 'Cuando una clienta cambia una prenda, **lo que devuelve vale lo que pagó por ella, en el medio con que la pagó**. El descuento del medio de pago se aplica **solo a la diferencia** que paga ahora. Así no pierde ella ni pierde el local.' },
      { tipo: 'texto', texto: '**No tenés que calcular nada**: buscás el ticket, cargás lo que se lleva y al cobrar el sistema te muestra cuánto paga según el medio.' },
      { tipo: 'tabla', filas: [
        ['Mismo modelo y mismo color, **otro talle**', 'se cambia **sin pagar nada**, aunque el precio haya subido'],
        ['Otro color u otra prenda', 'paga la **diferencia** (o le queda saldo a favor)'],
        ['Le sobra plata', '**nota de crédito**, o se le devuelve por el **mismo medio** con que pagó'],
        ['Plazo', '**30 días** con el ticket (lo dice el ticket impreso)']] }
    ] },
    { id: 'cambios-pasos', grupo: 'cambios', titulo: 'Cómo hacer un cambio, paso a paso', nuevo: '2026-10-31', resumen: 'Buscás la venta, marcás lo que devuelve, cargás lo que se lleva y cobrás.', bloques: [
      { tipo: 'pasos', items: [
        'En el Punto de venta tocá {{Cambio / devolución}}.',
        '**Buscá la venta** por número de ticket, nombre o teléfono de la clienta, fecha (ej. "27/10"), prenda, talle, color o total. Elegí la venta de la lista.',
        '**Marcá lo que devuelve** y tocá {{Cargar al ticket}}. Aparece en el ticket como "devuelve".',
        '**Cargá lo que se lleva**, como en cualquier venta.',
        'Tocá {{Cobrar}}. Arriba te muestra **la diferencia según el medio**: "precio Contado $8.000 · Débito $9.000 · Lista $10.000".',
        'Tocá el medio con que paga la diferencia: **el importe ya está bien**. Confirmá.',
        'Imprimí el **comprobante del cambio**: dice qué devolvió, qué se llevó y la diferencia.'] },
      { tipo: 'tip', texto: 'Si en el ticket dice "Pagó $18.000 a precio Contado = $22.500 a precio Lista", es el sistema mostrando la cuenta: está bien.' },
      { tipo: 'ojo', texto: 'Buscá **siempre el ticket original** cuando lo hay: así el sistema sabe cuánto y cómo pagó. Sin ticket, la prenda se toma al precio de hoy.' }
    ] },
    { id: 'cambios-ejemplos', grupo: 'cambios', titulo: 'Ejemplos con un caso real', nuevo: '2026-10-31', resumen: 'Conjunto Alondra comprado a $18.000 por transferencia.', bloques: [
      { tipo: 'texto', texto: 'La clienta compró un **Conjunto Alondra** y lo pagó **por transferencia: $18.000** (precio Contado; en Lista sale $22.500).' },
      { tipo: 'ejemplo', titulo: 'Se lleva un Conjunto Charo (Lista $32.500 · Contado $26.000)', filas: [['Paga la diferencia en efectivo o transferencia', '**$8.000**'], ['Paga con débito', '**$9.000**'], ['Paga con tarjeta', '**$10.000**']] },
      { tipo: 'ejemplo', titulo: 'Se lleva un Conjunto Jade de $16.000 (Contado)', filas: [['Le sobran', '**$2.000** → nota de crédito (o se los devolvés por transferencia)']] },
      { tipo: 'ejemplo', titulo: 'Cambia el Alondra 100 Nude por el 95 Nude (subió de precio)', filas: [['Mismo modelo y color', '**$0**: se cambia sin diferencia']] },
      { tipo: 'ejemplo', titulo: 'Cambia el Alondra 100 Nude por el 95 Blanco (otro color)', filas: [['Es otra prenda', 'paga la **diferencia** con el precio de hoy']] },
      { tipo: 'ejemplo', titulo: 'Al revés: si lo hubiera pagado con tarjeta ($22.500) y se lleva el Charo', filas: [['Paga la diferencia en efectivo', '**$8.000** (no $3.500)'], ['¿Por qué?', 'el descuento del efectivo va solo sobre la diferencia, no sobre lo que ya había pagado con tarjeta']] }
    ] },
    { id: 'cambios-devolver', grupo: 'cambios', titulo: 'Cuando le sobra plata', nuevo: '2026-10-31', resumen: 'Nota de crédito, o la plata por el mismo medio con que pagó.', bloques: [
      { tipo: 'texto', texto: 'Si lo que se lleva vale menos (o no se lleva nada), al cobrar te avisa **"Le sobra $X"** y cómo había pagado.' },
      { tipo: 'tabla', filas: [
        ['Prefiere saldo a favor', 'tocá {{Confirmar}} sin elegir medio: sale una **nota de crédito**'],
        ['Quiere la plata', 'tocá {{Devolver por…}}: se devuelve por el **mismo medio** con que pagó (si fueron dos, en la misma proporción)']] },
      { tipo: 'ojo', texto: 'La plata **nunca** se devuelve por otro medio: si pagó con tarjeta, no se devuelve en efectivo. Los otros medios aparecen apagados. Con tarjeta, la devolución se hace en el posnet o en la app (Mercado Pago, NAVE).' },
      { tipo: 'decir', texto: 'Te queda un saldo a favor de $2.000 en esta nota de crédito. La podés usar cuando quieras, presentando el código.' }
    ] },
    { id: 'nota-credito', grupo: 'cambios', titulo: 'La nota de crédito', nuevo: '2026-10-31', resumen: 'Se imprime o se manda por WhatsApp como foto. Recuerda cómo se pagó.', bloques: [
      { tipo: 'pasos', items: [
        'Al emitirla aparece **"✓ Nota de crédito emitida"** con la nota como se va a imprimir.',
        '{{Imprimir nota de crédito}} para dársela en papel.',
        '{{📷 WhatsApp (foto)}} para mandársela: en la compu la foto queda copiada y se abre WhatsApp (en el chat de la clienta si tiene teléfono cargado): **pegala con [[Ctrl]]+[[V]]** y mandala. En el celular se abre el menú de compartir.'] },
      { tipo: 'texto', texto: 'La nota dice el **código**, el **saldo a favor** y **cuánto vale según con qué pague**: una nota de efectivo de $2.000 vale $2.250 con débito y $2.500 con tarjeta. El sistema lo hace solo.' },
      { tipo: 'tip', texto: 'Para volver a imprimirla o mandarla: **Ventas** › pestaña {{Créditos}} › tocá la nota.' }
    ] },
    { id: 'nota-credito-usar', grupo: 'cambios', titulo: 'Cobrar con una nota de crédito', nuevo: '2026-10-31', resumen: 'En el cobro: {{Nota de crédito / gift card}} y el código.', bloques: [
      { tipo: 'pasos', items: ['Cargá lo que se lleva y tocá {{Cobrar}}.', 'Tocá {{Nota de crédito / gift card}} y escribí el **código** de 8 letras y números.', 'Si no alcanza, tocá otro medio para el resto.'] },
      { tipo: 'tip', texto: 'Si el resto lo paga con tarjeta, la nota vale más (ej. $2.500 en vez de $2.000): se ajusta solo.' }
    ] },
    { id: 'sin-ticket', grupo: 'cambios', titulo: 'Cambio sin ticket', resumen: 'Se carga lo que trae al precio de hoy.', bloques: [
      { tipo: 'pasos', items: ['{{Cambio / devolución}} › {{Devolver sin ticket}}.', 'Tocá o escaneá lo que trae: entra como "devuelve" al precio de hoy.', 'Tocá {{Listo}} y cargá lo que se lleva.', 'Cobrá como siempre.'] },
      { tipo: 'tip', texto: 'Antes de hacerlo sin ticket, probá buscar la venta por el nombre o el teléfono de la clienta: casi siempre aparece.' }
    ] },

    // ======================= CAJA =======================
    { id: 'movimientos', grupo: 'caja', titulo: 'Sacar o poner plata en la caja', resumen: 'Pagos, retiros o cambio que entra: {{💵 Ingreso / retiro}}.', bloques: [
      { tipo: 'pasos', items: ['Arriba en el Punto de venta tocá {{💰 Caja}}.', '{{💵 Ingreso / retiro}}: elegí si sale o entra plata, el monto y el concepto (ej. "pago a proveedor").'] },
      { tipo: 'ojo', texto: 'Registrá **toda** plata que sale o entra del cajón sin ser venta. Si no, al cerrar la caja no cuadra.' }
    ] },
    { id: 'cerrar-caja', grupo: 'caja', titulo: 'Cerrar la caja', resumen: 'Contás cada medio, ves si cuadra y dejás el cambio para mañana.', bloques: [
      { tipo: 'pasos', items: [
        '{{💰 Caja}} › {{🌙 Cerrar caja}}: te muestra cómo te fue en el turno.',
        '**Contá lo que hay** en cada medio (efectivo, transferencias, tarjetas). Si coincide, queda en **verde**.',
        'Decí **cuánto retirás**: lo que queda es el **cambio para mañana**.',
        'Imprimí el resumen o mandalo por {{WhatsApp}}.'] },
      { tipo: 'ojo', texto: 'Si no cuadra, revisá antes de cerrar: un retiro sin registrar, una venta cobrada con otro medio, un vuelto mal dado.' }
    ] },

    // ======================= CONSULTAS =======================
    { id: 'ventas', grupo: 'consultas', titulo: 'Ver las ventas', resumen: '**Ventas**: tickets del día, señas, créditos y cierres.', bloques: [
      { tipo: 'tabla', filas: [['Tocar un ticket', 'ver el detalle, {{Reimprimir}}, {{Editar}} o hacer un {{Cambio / devolución}} desde ahí'], ['{{Señas}}', 'las señas pendientes de retirar'], ['{{Créditos}}', 'notas de crédito: tocá una para verla, imprimirla o mandarla por WhatsApp']] }
    ] },
    { id: 'pendientes', grupo: 'consultas', titulo: '📌 Pendientes', resumen: 'Las prendas vendidas que quedaron sin definir el modelo.', bloques: [
      { tipo: 'texto', texto: 'Cuando una prenda de código común (ej. BOMBIS «VARIAS») se vendió sin decir qué modelo era, queda en **📌 Pendientes** (arriba de la pantalla, o en el ticket del Punto de venta).' },
      { tipo: 'pasos', items: ['Tocá **📌 Pendientes**.', 'Elegí qué modelo fue cada una (o {{+ BOMBIS «LOCAL»}} si no está en la web).'] }
    ] },

    // ======================= ATAJOS =======================
    { id: 'teclado', grupo: 'atajos', titulo: 'Atajos de teclado', resumen: 'Para vender rápido combinando mouse y teclado.', bloques: [
      { tipo: 'tabla', filas: [
        ['[[/]]', 'ir al buscador'], ['[[↑]] [[↓]] + [[Enter]]', 'recorrer las prendas y agregar'], ['**3*** antes de elegir', 'llevar 3 de la próxima'],
        ['[[+]] [[-]] (buscador vacío)', 'cambiar la cantidad del renglón marcado'], ['[[Supr]]', 'quitar el renglón marcado'], ['[[Alt]]+[[↑]] [[↓]]', 'marcar otro renglón'],
        ['[[F2]]', 'cambiar el precio del renglón'], ['[[F4]]', 'abrir Más… (clienta, nota, descuento, canal)'], ['[[F9]] o [[Ctrl]]+[[Enter]]', 'cobrar'],
        ['[[1]] a [[9]] (en el cobro)', 'elegir el medio de pago'], ['[[Enter]] (después de cobrar)', 'nueva venta']] }
    ] }
  ]
};
