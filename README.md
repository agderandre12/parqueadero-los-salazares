# Parqueadero Los Salazares

Aplicación de escritorio para la gestión de un parqueadero de motos y su lavadero.
Electron + Vite + React + Tailwind CSS + SQLite. Funciona sin internet; sólo el aviso del
cierre de caja por Telegram lo necesita, y si falta sale cuando vuelva.

## Requisitos

- Node.js 20 o superior (probado en Node 24)
- Windows 10/11 (también corre en Linux/macOS)

No se requiere Visual Studio Build Tools: la base de datos usa el módulo **`node:sqlite`**
incluido en Electron 43 / Node 24, así que **no hay módulos nativos que compilar**.

## Puesta en marcha

```bash
npm install
```

```bash
npm run dev
```

Otros comandos:

| Comando          | Qué hace                                              |
| ---------------- | ----------------------------------------------------- |
| `npm run dev`    | Modo desarrollo con recarga en caliente                |
| `npm run build`  | Compila a `out/`                                       |
| `npm start`      | Previsualiza la compilación                            |
| `npm test`       | Prueba de integración: entrada → liquidación → caja    |
| `npm run dist`   | Genera el instalador `.exe` (NSIS) en `release/`       |
| `npm run icono`  | Regenera `build/icon.ico` desde `iconoparqueadero.jpeg` |

Las pruebas corren sobre una base de datos temporal, así que nunca tocan los datos
reales del parqueadero.

## Dónde vive la información

La base de datos es un único archivo:

```
%APPDATA%\parqueadero-los-salazares\parqueadero.db
```

La base trabaja en modo WAL: mientras la aplicación está abierta, los últimos cambios
pueden estar todavía en `parqueadero.db-wal`. Para respaldar, **cierre la aplicación**
y copie el `.db`; si no se puede cerrar, copie juntos `parqueadero.db`,
`parqueadero.db-wal` y `parqueadero.db-shm`.

## Instalación en el equipo del cliente

1. En el equipo de desarrollo: `npm test` y luego `npm run dist`. El instalador queda en
   `release/Parqueadero Los Salazares Setup <versión>.exe` (unos 100 MB); es el único
   archivo que hay que llevar.
2. En el equipo del cliente, ejecutar el instalador. Permite escoger la carpeta y crea
   acceso directo en el escritorio y en el menú Inicio, con el emblema del negocio como
   ícono.
3. **El instalador no está firmado digitalmente**, así que Windows SmartScreen muestra
   *"Windows protegió su PC"*. Se continúa con *Más información → Ejecutar de todas
   formas*. Es esperado; desaparece sólo si se compra un certificado de firma de código.
4. Instalar el driver de la impresora Jaltech y comprobar que aparece en *Impresoras y
   escáneres* de Windows.
5. Abrir la aplicación y revisar en *Configuración* (`F8`):
   - *Negocio*: una base nueva ya trae dirección, teléfono y horario del parqueadero;
     falta el NIT.
   - *Precios* (con sus *Reglas por tiempo*) y *Capacidad*.
   - *Tipos de lavada*: crear las lavadas que ofrece el lavadero, con su precio.
   - *Impresora*: escoger la térmica de la lista e **imprimir la página de prueba**.
     Revisar que las tildes y las dos reglas salgan bien y escanear su código: la
     aplicación debe avisar *"PRUEBA no está adentro"*.
   - *Tiquete*: revisar las políticas.
   - *Telegram*: crear el bot y activar el aviso del cierre de caja (ver
     [Aviso por Telegram](#aviso-del-cierre-por-telegram)).
6. Registrar una entrada de prueba, escanear el tiquete y cobrarla.

La aplicación es de **instancia única**: si el operario la abre otra vez (doble clic en
el acceso directo con la ventana minimizada, por ejemplo), no se abre una segunda
ventana sino que se trae al frente la que ya estaba. Así no puede haber dos pantallas
con estados distintos de las celdas o de la caja.

Reinstalar o actualizar con un instalador nuevo **no borra los datos**: la base vive en
`%APPDATA%`, fuera de la carpeta de instalación.

## Estructura

```
src/
├─ main/                         # Proceso principal (Node)
│  ├─ index.js                   # Arranque de la app y la ventana
│  ├─ db/
│  │  ├─ schema.sql              # Esquema: settings, vehicles, transactions, caja_dias,
│  │  │                          # tipos_lavada, lavados y la vista ventas
│  │  ├─ index.js                # Conexión, PRAGMAs, migraciones y transacciones
│  │  ├─ settingsRepo.js         # Configuración del negocio
│  │  ├─ vehiclesRepo.js         # Entradas, celdas, búsquedas, estadísticas
│  │  ├─ transactionsRepo.js     # Historial de pagos y totales por método de pago
│  │  ├─ cajaRepo.js             # Jornadas de caja: base inicial y cierre
│  │  ├─ lavaderoRepo.js         # Tipos de lavada y motos del lavadero
│  │  └─ predeterminados.js      # Textos de una base nueva (políticas del tiquete)
│  ├─ services/
│  │  ├─ pricing.js              # Cálculo de tarifas (COP), reglas por tiempo, valor acordado
│  │  ├─ configuracion.js        # Validación de la configuración antes de guardarla
│  │  ├─ entrada.js              # Registrar la entrada (y cobrar la mensualidad)
│  │  ├─ liquidacion.js          # Cotizar y liquidar la salida
│  │  ├─ lavadero.js             # Catálogo, ingreso y entrega del lavadero
│  │  ├─ caja.js                 # Caja registradora y métricas de ventas
│  │  ├─ printer.js              # Tiquetes, recibos y página de prueba (ESC/POS)
│  │  ├─ colaWindows.js          # Envío RAW a una impresora de Windows
│  │  ├─ telegram.js             # Aviso del cierre de caja al administrador
│  │  └─ tiempo.js               # Fechas locales formato SQLite
│  └─ ipc/handlers.js            # Todos los canales IPC
├─ preload/index.js              # Puente seguro: window.api
└─ renderer/                     # Interfaz (React + Tailwind)
   └─ src/
      ├─ App.jsx                 # Shell: rail + barra + enrutado de vistas
      ├─ views/
      │  ├─ Panel.jsx            # Ocupación, cuadrícula de celdas, actividad
      │  ├─ NuevaEntrada.jsx     # Registro de ingreso
      │  ├─ Salida.jsx           # Cobro y comprobante (vista, no modal)
      │  ├─ Vehiculos.jsx        # Historial filtrable + ficha por placa
      │  ├─ Lavadero.jsx         # Ingreso y entrega del lavadero + motos adentro
      │  └─ Configuracion.jsx    # Métricas y caja + precios, lavadas, reglas, negocio, impresora, tiquete
      ├─ components/
      │  ├─ Rail.jsx             # Navegación oscura + estado del hardware
      │  ├─ CeldasGrid.jsx       # Mapa de celdas
      │  ├─ PanelVentas.jsx      # Ventas del día, semana y mes por método de pago
      │  ├─ PanelCaja.jsx        # Base, cuadre y cierre de la caja del día
      │  ├─ CampoPesos.jsx       # Campos de pesos con punto de miles (y de enteros)
      │  ├─ CampoMarca.jsx       # Marca con recomendación mientras se escribe
      │  ├─ MetodoPago.jsx       # Efectivo / transferencia
      │  ├─ TotalEditable.jsx    # Total a cobrar con lápiz para el valor acordado
      │  ├─ CascoCustodia.jsx    # Casco en custodia + locker
      │  ├─ TramosHora.jsx       # Editor de reglas por tiempo
      │  ├─ SimulacionCobro.jsx  # Tabla de cobro por hora antes de guardar
      │  ├─ TiposLavada.jsx      # Catálogo de lavadas
      │  ├─ IngresoLavado.jsx    # Formulario de ingreso al lavadero
      │  ├─ EntregaLavado.jsx    # Cobro y entrega de una lavada
      │  ├─ Icono.jsx            # Iconos propios, trazo 1.5
      │  └─ Toast.jsx            # Confirmaciones
      ├─ hooks/
      │  ├─ useDashboard.js      # Auto-refresco 5 s + estado de impresora
      │  └─ useEscaner.js        # Lector HID siempre a la escucha
      ├─ assets/logo.jpeg        # Emblema del negocio
      └─ lib/format.js           # Moneda COP, horas, placas
```

## Sistema visual

Base blanca, azul del logo como acento y oscuro sólo en el rail de navegación y
las celdas ocupadas. Los tokens viven en [`tailwind.config.js`](tailwind.config.js);
los componentes reutilizables, en [`index.css`](src/renderer/src/index.css).

| Token | Valor | Uso |
| ----- | ----- | --- |
| `lienzo` / `blanco` | `#F6F7F9` / `#FFFFFF` | Fondo y tarjetas |
| `tinta` / `tinta-800` | `#0A0A0B` / `#16171A` | Texto, rail, celda ocupada |
| `grafito` / `niebla` | `#5F6066` / `#6E6F76` | Texto secundario y terciario |
| `humo` | `#9B9CA4` | Texto terciario **sobre oscuro** |
| `azul` | `#0F80D8` | El azul medido del emblema |
| `azul-cta` | `#0C6FBC` | Relleno de botón con texto blanco |
| `alerta` | `#C62B31` | Errores; nunca como fondo de botón |

El azul del logo da 4.1:1 con texto blanco encima, insuficiente para un botón de
13 px, así que el relleno de los botones usa `azul-cta` (5.3:1) y el tono exacto
del emblema queda para barras de selección, anillos de foco, iconos y bordes.
Todo texto de la interfaz cumple AA; hay un audito de contraste en el historial
de este rediseño.

Tipografía **Geist** y **Geist Mono** (placas, horas y montos), empaquetadas con
la app: no hay internet en la caseta y el `Content-Security-Policy` sólo admite
`'self'`.

## Modelo de datos

- **`settings`** — fila única (`id = 1`): nombre, NIT, dirección, teléfono, horario, total
  de celdas, tarifas (hora / amanecida / mensualidad), cargo por ticket perdido, minutos de
  gracia, reglas por tiempo, base predeterminada de la caja, configuración de la impresora
  térmica, políticas del tiquete y el bot de Telegram.
- **`vehicles`** — un registro por ingreso: placa, marca, color, casco y locker, celda,
  hora de entrada y salida, tipo de tarifa, tarifa personalizada, estado (`activo` /
  `finalizado`). Un índice único parcial impide que la misma placa esté activa dos veces.
- **`transactions`** — historial de pagos del parqueadero: vehículo, placa, monto base,
  recargo, ajuste (valor acordado − calculado), total, minutos, tipo de tarifa, tipo
  (`normal` / `ticket_perdido`) y método de pago (`efectivo` / `transferencia`).
- **`caja_dias`** — una fila por jornada (`'YYYY-MM-DD'`): base inicial, hora de apertura y,
  al cerrar, el dinero contado, la diferencia, lo que quedó en el cajón para la jornada
  siguiente, las observaciones y si el aviso por Telegram salió. El efectivo del día **no**
  se guarda aquí: se suma siempre desde la vista `ventas`.
- **`tipos_lavada`** — el catálogo del lavadero: nombre y precio. Un tipo retirado deja de
  ofrecerse pero no se borra.
- **`lavados`** — cada moto que entra al lavadero: placa, marca, color, casco y locker, la
  lavada y su precio **copiados al ingresar**, si el valor se pactó, horas de entrada y
  entrega, estado (`activo` / `entregado`) y el cobro (ajuste, total, método de pago).
- **`ventas`** (vista) — junta lo cobrado en el parqueadero y en el lavadero. De aquí salen
  las métricas y la caja.

Todos los montos son enteros en COP. Las fechas se guardan como texto
`'YYYY-MM-DD HH:MM:SS'` en hora local.

## Reglas de cobro

| Tipo de tarifa  | Cálculo                                                                   |
| --------------- | ------------------------------------------------------------------------- |
| Por hora        | Hora iniciada × tarifa (o el valor fijo de una regla por tiempo), con **tope de amanecida** por cada bloque de 24 h |
| Amanecida       | Tarifa fija por cada bloque de 24 h iniciado                              |
| Mensualidad     | Tarifa de mensualidad **cobrada al registrar la entrada**; $0 a la salida |
| Personalizada   | Valor fijo pactado al ingresar                                            |

Si la moto sale dentro de los *minutos de gracia* (10 por defecto: a los 10:00 exactos
todavía no se cobra, a los 10:01 sí) no se cobra nada, salvo con tarifa personalizada, que
siempre cobra lo pactado. Con 0 minutos de gracia se cobra desde el primer segundo.
El **ticket perdido** suma $2.000 al total (configurable); no aplica a la mensualidad.

### Reglas por tiempo

En *Configuración → Precios → Reglas por tiempo* el administrador arma tramos con un
valor fijo: *"más de 5 h y hasta 12 h se cobran $10.000"*. Con la hora a $2.000:

| Estadía | Cobro |
| ------- | ----- |
| 1 a 5 h | $2.000 por hora iniciada (hasta $10.000) |
| más de 5 h y hasta 12 h | $10.000 fijos |
| más de 12 h | otra vez por hora, con el tope de la amanecida |

Cuentan las horas iniciadas: *"más de 5 h"* cubre desde la hora 6, así que con 5 h y 1 min
la moto ya entró a la regla, y con 12 h y 1 min ya salió. Cada regla lo explica debajo.

**El tope de la amanecida manda sobre las reglas.** Si una regla vale más que la amanecida
se cobra la amanecida, no la regla: con la amanecida a $10.000, una regla de $11.110 nunca
se cobra. La tabla pinta esas horas como tope y dice qué hacer (subir la amanecida o bajar
la regla). También avisa si quedarse más tiempo sale más barato.

Se pueden crear varias reglas, siempre que no se crucen. Debajo, la tabla *"Así queda el
cobro por hora"* muestra qué se cobraría de 1 a 24 h **con los valores en pantalla**,
calculada con la misma función que cobra. Mientras no se guarde, dice *"Sin guardar: los
cobros siguen con los precios anteriores"*. Si una regla está incompleta o se cruza con
otra, ahí mismo aparece el aviso y no se deja guardar.

Los precios se validan al guardar: un campo vacío o negativo no se guarda (antes un precio
vacío quedaba cobrando $0). Todos los montos se escriben y se leen con punto de miles.

## Mensualidad

La mensualidad se paga cuando la moto entra, y la moto se queda el mes adentro:

1. En *Nueva entrada* (`F2`) se escoge la tarifa **Mensualidad**. Aparece el **método de
   pago** (*Efectivo* o *Transferencia*), obligatorio, y el botón pasa a
   **Cobrar $60.000 e imprimir**.
2. Al cobrar se guardan en una sola operación atómica el ingreso y la venta, que entra a
   las métricas y, si es en efectivo, a la caja del día.
3. Se imprime **siempre** el comprobante de pago, aunque la impresión automática esté
   apagada. Es un recibo normal sin hora de salida, sin método de pago y sin código de
   barras, y no sale tiquete de entrada. Si la impresora falla, el cobro queda guardado,
   la aplicación lo avisa y el comprobante se reimprime desde la ficha del vehículo en
   *Vehículos*.
4. En el panel, en *Vehículos* y en las sugerencias de *Salida*, la moto muestra
   **"Mensualidad"** en lugar del tiempo que lleva adentro.
5. La salida no cobra, no pide método de pago ni tiquete perdido y no imprime nada: un
   solo botón **Registrar salida** libera la celda.

Cada entrada con Mensualidad cobra la tarifa completa: el software no lleva vigencias. Si
la moto sale y vuelve a entrar dentro del mes ya pagado, el operario debe registrarla con
otra tarifa.

## Flujo de salida

1. Se abre *Registrar salida* (`F3`) y se escanea o digita la placa, o se hace clic en la
   celda ocupada del panel.
2. La vista muestra placa, hora de llegada, permanencia, tarifa y total a cobrar. El total
   se actualiza solo cada 5 segundos: si se cruza una hora con la pantalla abierta, se ve
   antes de cobrar. Con *Perdió el tiquete* el total incluye el recargo de $2.000. Lo que
   se marca para una moto (tiquete perdido, método, valor acordado) no pasa a la siguiente.
3. Si se acuerda otro valor con el cliente al pagar (un descuento, casi siempre), el
   **lápiz** junto al total permite escribir lo que se va a cobrar. La pantalla muestra el
   descuento y lo calculado; *Quitar* vuelve a lo calculado. Lo que se cobra y suma a las
   ventas y a la caja es el valor acordado, y el recibo imprime el descuento.
4. El operario escoge el **método de pago** (*Efectivo* o *Transferencia*). Es obligatorio:
   el botón de cobro no se habilita sin él, porque decide si el dinero entra a la caja.
5. **Cobrar e imprimir** (o `Enter`) cierra el ingreso, libera la celda, guarda la
   transacción en una sola operación atómica e imprime el recibo. **Cobrar sin imprimir**
   hace lo mismo sin sacar papel, aunque la impresión automática esté encendida; el
   recibo se puede imprimir después desde el comprobante (sale como original, no como
   copia).

Si el cobro ya se registró y la impresora falla, la salida **no** se revierte: el recibo
queda guardado y se puede reimprimir desde el comprobante o desde la ficha del vehículo.

## Lavadero

Se abre con `F6` (o el icono de la gota del rail). Antes de usarlo, el administrador crea
las lavadas en *Configuración → Tipos de lavada*: cada una con su nombre y cualquier
precio. Se pueden corregir o dejar de ofrecer; una moto que ya está en el lavadero
conserva el nombre y el precio con que entró.

**Ingresar moto**

1. Placa (obligatoria) y **tipo de lavada** (obligatorio).
2. *Otro valor, pactado con el cliente*, si la lavada se negoció: reemplaza el precio de
   lista.
3. Marca (con recomendación, ver [Marca](#marca-recomendada)) y color, opcionales, y si deja
   el casco, el **locker** donde quedó (opcional).
4. *Ingresar al lavadero* guarda la moto y **pregunta si se imprime el tiquete de
   ingreso**: `Enter` imprime, `Esc` no. El tiquete se puede reimprimir después.

**Entregar y cobrar**: se escoge la moto en la lista de la derecha, se escanea su tiquete
o se digita la placa. Como en la salida del parqueadero: lápiz para el valor final,
método de pago obligatorio y *Cobrar e imprimir* / *Cobrar sin imprimir*. Lo cobrado entra
a las ventas y, si es en efectivo, a la caja del día.

A la derecha están siempre las motos que hay en el lavadero (con su lavada, valor y
locker) y las entregadas hoy, con un botón para imprimir su recibo.

## Casco en custodia

Al marcar *Deja el casco en custodia* (en *Nueva entrada* y en el lavadero) aparece el
campo **Locker asignado**, opcional. El locker se ve en la salida, en la ficha del
vehículo y en la lista del lavadero. **Ningún papel impreso dice si se dejó el casco** ni
en qué locker.

## Marca recomendada

En *Nueva entrada* y en el lavadero, al escribir la marca aparece en gris dentro del campo
la que coincide con lo escrito: con `ya` se ve *Yamaha*. `Tab` la acepta y pasa al color;
`Enter`, `→` o tocar la tecla *Tab* del campo también la aceptan. No se despliega ninguna
lista, y una marca que no está se escribe igual. Las recomendadas son Yamaha, Honda, Bajaj,
AKT, Suzuki, TVS, Victory, Hero, KTM y Kawasaki (lista en `CampoMarca.jsx`). Con una sola
letra se recomienda la más común: `h` es Honda; `he`, Hero.

## Métricas y caja

Se abre con `F5` (o el icono de gráfica del rail) y tiene dos secciones:

- **Ventas** — totales del día, de la semana en curso (desde el lunes) y del mes en curso
  (desde el día 1), cada uno separado en efectivo y transferencia. Incluyen el lavadero,
  que además se muestra aparte (*"lavadero $…"*). Debajo, la gráfica **Ventas por día del
  mes**: una barra por día, con el efectivo abajo y la transferencia arriba, y una línea
  punteada con el promedio diario. El eje siempre es el mes completo: los días sin cobros
  y los que faltan quedan vacíos, y el número de hoy va en negrilla. Al pasar el mouse por
  una barra se ve el día con su total, efectivo y transferencia.
- **Caja del día** — el cuadre del cajón físico:

  ```
  base inicial + cobros en efectivo de hoy = lo que debe haber en el cajón
  ```

  Las **transferencias cuentan como venta pero no entran al cajón**: aparecen aparte, en
  gris, para que nadie las sume.

Funcionamiento de la jornada:

- La jornada del día se crea sola la primera vez que se consulta la caja o se cobra en
  efectivo. Nunca hay que "abrir caja" para poder cobrar.
- **Abre con lo que quedó en el cajón al cerrar la jornada anterior**: la plata que pasa
  la noche en el cajón es la base de la mañana, y la vista dice de qué cierre viene. Si
  la anterior no se cerró (o es la primera), abre con la *base predeterminada*
  (Configuración → Precios).
- La base se puede corregir en cualquier momento del día con *Guardar*.
- **Cerrar caja** pide el dinero contado y guarda la diferencia con signo: positiva es
  sobrante, negativa es faltante. Un día sólo se cierra una vez. *Queda en el cajón para
  mañana* es lo que se deja para la jornada siguiente; el resto se retira. Vacío, queda
  todo lo contado.
- Si la jornada anterior **quedó sin cerrar**, la caja de hoy lo avisa con *Cerrar esa
  jornada*: se cuenta y se cierra aunque ya sea otro día. Después, *Usar ese valor* toma
  lo que quedó como base de hoy. En *Otras jornadas* se ven los últimos cierres (lo
  contado, lo que quedó y si cuadró) y las jornadas sin cerrar se abren desde ahí.
- Un cierre equivocado se puede **reabrir**: se borra el conteo y se conservan la base y
  los cobros.
- Los cobros posteriores al cierre se siguen registrando (la caja no bloquea la salida de
  motos), pero la diferencia guardada es la del momento del cierre. Si después del cierre
  se cobra en efectivo, la caja lo avisa: hay que reabrir y cerrar otra vez para que la
  próxima jornada abra con esa plata.

## Aviso del cierre por Telegram

Al cerrar la caja, el administrador recibe en Telegram las ventas del día (parqueadero,
lavadero, efectivo, transferencia y descuentos), el cuadre (base, lo que debía haber, lo
contado, sobrante o faltante, lo retirado y lo que quedó), el movimiento (entradas,
salidas, lavadas y motos adentro), lo vendido en el mes y las observaciones.

Se configura una sola vez en *Configuración → Telegram*:

1. En Telegram, buscar a **@BotFather**, escribir `/newbot` y copiar el token en la app.
2. Desde el Telegram del administrador, abrir el bot y escribirle cualquier cosa.
3. Tocar **Buscar** (llena el chat) y **Enviar mensaje de prueba**.
4. Si el mensaje llegó, activar *Avisar cada cierre de caja* y guardar.

El cierre nunca depende de Telegram: se guarda primero y luego se intenta enviar. Sin
internet el aviso queda **pendiente**, la caja lo muestra y se reintenta solo al abrir la
aplicación y cada 5 minutos (*Enviar ahora* lo fuerza). Reabrir la jornada lo cancela, y
al cerrarla otra vez se envía de nuevo.

## Hardware

### Impresora Jaltech POS 58 mm (JAL58M)

Habla ESC/POS, así que usa el perfil `EPSON`. Se configura en *Configuración →
Impresora*:

- **Impresora**: se escoge de la lista de impresoras instaladas en Windows (hace falta
  instalar antes el driver de Jaltech). Para una impresora de red se escoge *Otra* y se
  escribe `tcp://192.168.1.50`.
- **Ancho del papel**: 58 mm = 32 caracteres.
- **Imprimir sin tildes**: sólo si en la página de prueba las tildes salen como símbolos.

La aplicación manda los comandos ESC/POS tal cual (modo RAW) a la cola de Windows, a
través de PowerShell, sin módulos nativos. Cada impresión tarda 1–2 s en salir. Si la
impresora está apagada, Windows guarda el trabajo en la cola y lo imprime al encenderla.
Por eso el indicador del rail sólo puede decir si la impresora está **instalada**, no si
está encendida.

> Hasta esta versión la conexión `printer:NOMBRE` no imprimía nada: la librería
> `node-thermal-printer` exige un módulo nativo para hablar con Windows y fallaba con
> *"No driver set!"*. Se reemplazó por el envío RAW descrito arriba.

Imprime seis papeles:

- **Tiquete de entrada** (~16 cm):
  - Encabezado: nombre del negocio en letra grande, dirección, horario y teléfono
    (sección *Negocio*).
  - "TIQUETE DE ENTRADA" y la **placa en letra triple**.
  - **Código de barras Code 128 de la placa**: 17,5 mm de alto y unos 38 mm de ancho
    (módulo de 3 puntos) para placas de hasta 6 caracteres, centrado con margen en blanco
    para que el lector lo tome de una.
  - Hora de entrada (en negrilla), celda, tarifa y vehículo. No dice si se dejó el casco.
  - Las **políticas** en letra menuda (sección *Tiquete*).
- **Recibo de salida** (~13 cm): mismo encabezado más el NIT, número de recibo, placa,
  entrada, **hora de salida** (en negrilla), permanencia, tarifa, desglose (con el
  *descuento acordado*, si lo hubo), total cobrado y método de pago. Una reimpresión sale
  marcada `** COPIA **` para que no pueda usarse dos veces como comprobante; si se cobró
  sin imprimir, el primer papel que sale es el original.
- **Tiquete de lavadero**: "TIQUETE DE LAVADERO", la placa en letra triple, un código de
  barras propio (`LAV` + número de servicio, p. ej. `LAV000123`), hora de entrada, la
  lavada y su valor. Sólo se imprime si el operario dice que sí al ingresar la moto.
- **Recibo de lavadero**: con numeración propia (*RECIBO LAVADERO No.*), entrada, entrega,
  la lavada, el descuento acordado si lo hubo, total y método de pago.
- **Comprobante de mensualidad**: se imprime al registrar la entrada. Es el mismo recibo
  con la fecha del pago, la tarifa *Mensualidad* y el total, sin hora de salida,
  permanencia, método de pago ni código de barras.
- **Página de prueba**: tildes, una regla de 32 caracteres en letra normal y otra de 42 en
  letra menuda (cada una debe caber en un solo renglón) y un código de barras del mismo
  tamaño que el del tiquete. Al escanearlo, la aplicación debe avisar
  *"PRUEBA no está adentro"*: así se prueban la impresora y el lector a la vez.

Las **políticas** se editan en *Configuración → Tiquete*, un párrafo por renglón. Lo que
va antes de los dos puntos sale en negrilla, y `{ticket_perdido}` se reemplaza al imprimir
por el recargo configurado en *Precios*; así el papel nunca anuncia un valor distinto al
que se cobra. Si se dejan vacías, el tiquete sale sin políticas.

Ninguna función de impresión lanza excepciones: si la impresora falla, el cobro
ya quedó guardado y la interfaz lo informa sin revertir nada.

### Escáner Jaltech PLUS 1D/QR (JAL PLUS 01)

No necesita configuración ni driver: Windows lo ve como teclado. La aplicación lo
escucha en todas las pantallas y lo distingue de una persona por la velocidad —
si todas las teclas llegan con menos de 35 ms de separación y el código cierra
con Enter, es una lectura.

- Tiquete de lavadero (`LAV…`) → abre la entrega de esa moto en el lavadero.
- Placa que está en el parqueadero → abre su salida con el cobro ya calculado.
- Placa que sólo está en el lavadero → abre su entrega.
- Placa que no está adentro → abre su ficha en Vehículos.
- Con el foco en un campo de placa, el código cae en el campo y no cambia de vista.

## Atajos

- `F1`–`F4` — Panel, Nueva entrada, Registrar salida, Vehículos
- `F5` — Métricas y caja
- `F6` — Lavadero
- `F8` — Configuración
- `Enter` — cobra e imprime en la salida y en la entrega del lavadero; en el comprobante,
  pasa al siguiente. Editando el total, aplica el valor. En la pregunta del tiquete de
  lavadero, imprime.
- `Esc` — despeja la vista de salida o de entrega; editando el total, lo cancela; en la
  pregunta del tiquete, sigue sin imprimir

## Estado

- **Listo:** estructura, base de datos, IPC, las seis vistas, cálculo de tarifas con
  reglas por tiempo, liquidación normal, ticket perdido, valor acordado al cobrar, cobrar
  con o sin imprimir, método de pago (efectivo / transferencia), comprobante, historial
  por placa, métricas de ventas, caja registradora con cierre diario y la base que pasa de
  un día al siguiente, aviso del cierre por Telegram, configuración editable y validada,
  lavadero, marca recomendada, locker del casco, impresión térmica y lector de código de
  barras.
- **Por verificar en el equipo del cliente** (no hay térmica en el equipo de desarrollo):
  que la JAL58M acepte trabajos RAW por su cola de Windows, que imprima tildes con la
  página PC858 y la letra menuda (fuente B) a 42 caracteres, y que el lector lea el
  código del tiquete. La página de prueba cubre las cuatro cosas. El contenido y las
  medidas de los papeles están verificados con una simulación de los bytes ESC/POS.
  Falta también comprobar que el lector tome el código del tiquete de lavadero.
- **Por verificar con el bot real**: que el mensaje llegue al Telegram del administrador.
  El equipo de desarrollo llegó a la API de Telegram y un token falso se rechazó con su
  mensaje en español, pero ningún mensaje se ha entregado todavía a un chat real.
