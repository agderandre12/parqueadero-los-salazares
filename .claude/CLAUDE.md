# Parqueadero Los Salazares — contexto del proyecto

Aplicación de escritorio **Electron + Vite + React + Tailwind + SQLite** para gestionar
un parqueadero de motos y su lavadero. Local, sin internet, un solo archivo de base de
datos.
Este documento es la primera fuente de contexto para trabajar en el código: describe
arquitectura, contrato IPC completo, modelo de datos, reglas de negocio y hardware.
Para la versión orientada al usuario final ver [`README.md`](../README.md).

## Arquitectura

Tres procesos, como cualquier app Electron:

- **`src/main/`** (proceso principal, Node) — dueño de la base de datos, la ventana y
  toda la lógica de negocio. El renderer nunca toca SQLite directamente.
- **`src/preload/index.js`** — único puente. Expone `window.api` vía
  `contextBridge`; `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`
  (ver [`src/main/index.js`](../src/main/index.js)).
- **`src/renderer/`** (React 19, sin Redux ni router — un solo estado `vista` en `App.jsx`
  decide qué se muestra).

Flujo típico: vista React → `window.api.x.y(args)` → `ipcRenderer.invoke` → handler en
[`src/main/ipc/handlers.js`](../src/main/ipc/handlers.js) → repos (`db/*Repo.js`) o
servicios (`services/*.js`) → SQLite.

### Instancia única

`src/main/index.js` pide `app.requestSingleInstanceLock()` antes de todo. Si otra
instancia ya lo tiene, esta hace `app.quit()` **sin abrir la base de datos** y la
primera recibe `second-instance`: restaura, muestra y enfoca su ventana. Dos ventanas
sobre la misma base mostrarían celdas y caja distintas y permitirían cobrar dos veces.
El candado es por carpeta `userData`: `npm test` (que usa un `userData` temporal y no
importa `index.js`) no se ve afectado.

### Por qué `node:sqlite` y no `better-sqlite3`

La base de datos usa el módulo **`node:sqlite`** incluido en Node 24 / Electron 43:
misma API síncrona (`.prepare().run()/.get()/.all()`) pero **sin módulos nativos que
compilar**. Esto evita depender de Visual Studio Build Tools en la máquina del cliente.
No reintroducir `better-sqlite3` sin una razón de peso — fue una decisión deliberada de
distribución (ver [`src/main/db/index.js`](../src/main/db/index.js)).

### Transacciones atómicas

`enTransaccion(fn)` en `db/index.js` envuelve `BEGIN/COMMIT/ROLLBACK` a mano (no hay
`db.transaction()` como en better-sqlite3). Se usa en
[`liquidacion.js`](../src/main/services/liquidacion.js) para que "cerrar el vehículo" +
"registrar la transacción" (+ asegurar la jornada de caja si es efectivo) sea una sola
operación atómica, y lo mismo en `entrada.js` (mensualidad) y `lavadero.js` (entrega). La
impresión ocurre **después** y fuera de la transacción: si la impresora falla, el cobro
ya quedó guardado y **nunca se revierte** (ver sección Hardware).

### Migraciones (`migrar()` en `db/index.js`)

El esquema se aplica con `CREATE TABLE IF NOT EXISTS`, así que **una base ya existente
nunca recibe columnas nuevas desde `schema.sql`**. Toda columna que se agregue a una
tabla existente debe ir en dos lugares:

1. En `schema.sql`, para las bases nuevas.
2. En `migrar()`, con un `ALTER TABLE ... ADD COLUMN` protegido por `falta(tabla,
   columna)` (`PRAGMA table_info`), para las bases que ya están en el equipo del cliente.

**Orden de arranque** (`getDb()`): `migrar()` → `schema.sql` → `sembrar()`. Las columnas
nuevas van **antes** del esquema porque sus índices y la vista `ventas` las nombran: con
el orden anterior (esquema primero) una base de la primera versión ni siquiera abría,
porque `CREATE INDEX ... (metodo_pago)` fallaba. En una base nueva `migrar()` no hace
nada (`PRAGMA table_info` de una tabla que no existe no trae filas) y el esquema crea
todo completo. `sembrar()` va al final porque necesita la fila de `settings`.

Las tablas nuevas completas (`caja_dias`, `tipos_lavada`, `lavados`) sí se crean solas
desde `schema.sql`. La vista `ventas` se borra y se vuelve a crear en cada arranque (no
guarda datos), así que un cambio en ella llega también a las bases existentes.
SQLite no admite `CHECK` en `ADD COLUMN`: en bases migradas, la restricción de
`transactions.metodo_pago` la garantiza `normalizarMetodoPago()` en `services/caja.js`.

Migraciones existentes: `transactions.metodo_pago` y `settings.caja_base_predeterminada`
(módulo de caja); `settings.horario`, `settings.impresora_sin_tildes` y
`settings.politicas_tiquete` (rediseño del tiquete); `transactions.ajuste` (valor
acordado al cobrar), `vehicles.locker` (locker del casco), `settings.tramos_hora`
(reglas por tiempo) y `caja_dias.queda_en_caja` (lo que pasa la noche en el cajón).
`npm test` abre una base con el esquema de la **primera versión** (commit `4d694db`) más
la `caja_dias` del módulo de caja (`9d348ca`) y comprueba que recibe todas las columnas y
conserva los datos.

Textos largos predeterminados (las políticas) **no** van como `DEFAULT` en `schema.sql`:
viven en `db/predeterminados.js` y `sembrar()` los siembra con
`UPDATE ... WHERE politicas_tiquete IS NULL`. `NULL` = nunca configurado; `''` = el
administrador las borró a propósito y no se vuelven a sembrar.

Los `DEFAULT` de `direccion`, `telefono` y `horario` traen los datos reales del negocio
(Cisneros, 3226746848, 7 a. m. – 9 p. m.), así que una base nueva imprime bien sin
configurar nada. Sólo aplican a bases nuevas: una base existente conserva lo que tenía.

## Mapa de archivos

```
src/main/
  index.js                  Arranque: crea ventana, abre DB, registra handlers IPC
  db/
    schema.sql               Esquema SQLite (settings, vehicles, transactions, caja_dias,
                             tipos_lavada, lavados) y la vista `ventas`
    index.js                 getDb() / migrar() / sembrar() / enTransaccion() / closeDb()
    settingsRepo.js          CRUD de la fila única de configuración (id=1)
    vehiclesRepo.js          Entradas, celdas, búsquedas, estadísticas, historial
    transactionsRepo.js      Historial de pagos/liquidaciones; totales por método y periodo
                             (leen la vista `ventas`: parqueadero + lavadero)
    cajaRepo.js              SQL de caja_dias: asegurar/fijar base, cerrar, reabrir, historial
                             y la jornada anterior (de donde sale la base heredada)
    lavaderoRepo.js          SQL de tipos_lavada (catálogo) y lavados (ingreso/entrega)
    predeterminados.js       POLITICAS_PREDETERMINADAS (se siembran en sembrar())
  services/
    pricing.js                calcularCobro() — el corazón del cálculo de tarifas; tramos por
                              tiempo (normalizarTramos), totalCobrado() (valor acordado) y
                              simularTarifaHora() (tabla de la configuración)
    configuracion.js          actualizarConfiguracion(): valida antes de guardar (settings:update)
    entrada.js                registrarEntrada(): tiquete, o cobro + comprobante si es mensualidad
    liquidacion.js            cotizar() y liquidar() — orquesta repos + pricing + caja + printer
    lavadero.js               Catálogo (guardarTipo/retirarTipo), ingresarLavado(), entregarLavado()
    caja.js                   Caja registradora (asegurarJornada con la base heredada,
                              resumen/abrir/cerrar/reabrir) y metricasVentas()
    printer.js                componer{Tiquete,Recibo,TiqueteLavado,ReciboLavado,Prueba}() arman
                              el papel; imprimir*() lo envían y nunca lanzan; debeImprimir()
                              decide si sale el recibo; generarBytes() para pruebas/vista previa
    colaWindows.js            interfazWindows(): envío RAW a una cola de Windows vía PowerShell
                              + winspool.drv; listarImpresoras() vía Chromium
    tiempo.js                 Conversión Date <-> texto SQL 'YYYY-MM-DD HH:MM:SS' local
  ipc/handlers.js             Único lugar con ipcMain.handle(); envuelve {ok, data|error}

src/preload/index.js          contextBridge -> window.api (espejo 1:1 de los canales IPC)

src/renderer/src/
  App.jsx                    Shell: estado de vista, atajos de teclado, escáner global
  views/
    Panel.jsx                 Ocupación + cuadrícula de celdas + movimiento reciente
    NuevaEntrada.jsx           Formulario de ingreso (placa obligatoria, resto opcional)
    Salida.jsx                 Búsqueda -> cotización -> cobro -> comprobante (vista, no modal)
    Vehiculos.jsx               Historial filtrable + ficha con resumen por placa
    Lavadero.jsx                Pestañas Ingresar / Entregar y cobrar + lista de motos adentro
                                y entregadas hoy; pregunta si imprime el tiquete tras ingresar
    Configuracion.jsx           Dos puertas: 'metricas' (F5) abre Ventas/Caja del día;
                                'ajustes' (F8) abre Precios (con reglas por tiempo y la
                                simulación), tipos de lavada, reglas, negocio, capacidad,
                                impresora (selector de printer:lista), tiquete (políticas),
                                escáner
  components/
    Rail.jsx                   Nav lateral oscura + indicadores de escáner/impresora
    CeldasGrid.jsx              Cuadrícula visual de celdas ocupadas/libres
    PanelVentas.jsx             Ventas día/semana/mes + gráfica del mes completo (window.api.metricas)
    PanelCaja.jsx               Base (y de qué cierre viene), cuadre, cierre con lo que queda,
                                reapertura, jornadas sin cerrar y otras jornadas
                                (window.api.caja); se refresca solo cada 15 s
    CampoPesos.jsx              CampoPesos (punto de miles) y CampoEntero: TODO campo numérico
    MetodoPago.jsx              Efectivo / transferencia, sin valor por defecto
    TotalEditable.jsx           Total a cobrar con lápiz para el valor acordado con el cliente
    CascoCustodia.jsx           Casco en custodia + locker opcional (entrada y lavadero)
    TramosHora.jsx              Editor de reglas por tiempo (JSON de settings.tramos_hora)
    SimulacionCobro.jsx         Tabla de cobro por hora con lo que está en pantalla (precios:simular)
    TiposLavada.jsx             Catálogo de lavadas; guarda fila por fila (window.api.lavadero)
    IngresoLavado.jsx           Formulario de ingreso al lavadero
    EntregaLavado.jsx           Búsqueda -> cobro -> comprobante de una lavada
    Icono.jsx                   Set propio de iconos SVG (sin librería externa)
    Toast.jsx                   Confirmaciones flotantes autodestructivas
  hooks/
    useDashboard.js             useDashboard (polling 5s), useReloj (1s), useImpresora (30s)
    useEscaner.js                Detección de lector HID por velocidad de tecleo
  lib/format.js                 Moneda COP, fechas, placas — SOLO para el renderer

pruebas/liquidacion.js        Prueba de integración (entrada -> cobro -> liquidación)
scripts/generar-icono.cjs     Genera build/icon.ico desde el emblema (npm run icono)
build/                        Recursos del instalador (icon.ico, icon.png) — no es salida de compilación
```

> Nota de duplicación conocida: `src/main/services/tiempo.js` (main) y
> `src/renderer/src/lib/format.js` (renderer) implementan por separado
> `desdeTextoSql`/`parseSql` — mismo algoritmo, no comparten código porque main y
> renderer son bundles separados. Si se cambia el formato de fecha, actualizar ambos.

## Modelo de datos (SQLite, `src/main/db/schema.sql`)

Un único archivo persistente en `%APPDATA%\parqueadero-los-salazares\parqueadero.db`
(`WAL` + `foreign_keys = ON`). Todas las fechas son `TEXT` `'YYYY-MM-DD HH:MM:SS'` en
**hora local** (no UTC, no ISO con `T`). Todos los montos son `INTEGER` en COP.

### `settings` — fila única, `id = 1`
Nombre/NIT/dirección/teléfono/`horario` del negocio, `total_celdas`, las 4 tarifas,
`minutos_gracia`, `horas_tope_dia`, `tramos_hora` (JSON de las reglas por tiempo, ver
Reglas de cobro), `caja_base_predeterminada` (base con la que se crea cada jornada de
caja), toda la config de impresora (`impresora_tipo`, `impresora_interface`,
`impresora_ancho`, `imprimir_automatico`, `impresora_sin_tildes`, `mensaje_recibo`) y
`politicas_tiquete` (texto, un párrafo por renglón; ver Migraciones para su `NULL`
inicial). `getSettings()` hace `INSERT OR IGNORE` antes de leer, así que siempre hay
fila. Sólo los campos en `CAMPOS_EDITABLES` (`settingsRepo.js`) se aceptan en
`updateSettings(patch)`, y el canal `settings:update` pasa antes por
`actualizarConfiguracion()` (`services/configuracion.js`): pesos ≥ 0, cantidades dentro
de rango, casillas a 0/1, ancho 32 o 48 y tramos válidos, o lanza con un mensaje para el
administrador. Sin esa validación un precio vacío se guardaba como `''` y cobraba $0.

### `vehicles` — un registro por ingreso
`placa` (normalizada: mayúsculas, sin espacios/guiones), `celda` (nullable — el
parqueadero puede llenarse), `casco` (0/1) y `locker` (dónde quedó el casco; opcional,
mayúsculas, máx. 10, `''` si no dejó casco), `hora_entrada`/`hora_salida`, `tipo_tarifa`
(CHECK: `hora|amanecida|mensualidad|personalizada`), `tarifa_personalizada` (sólo si
aplica), `estado` (CHECK: `activo|finalizado`). **Índice único parcial**
`idx_vehicles_placa_activa` garantiza que una placa no esté activa dos veces
simultáneamente — la re-entrada antes de liquidar lanza error
(`vehiclesRepo.crearEntrada`).

### `transactions` — historial de pagos del parqueadero
`vehicle_id` (FK `ON DELETE CASCADE`), `placa` desnormalizada para reportes,
`monto_base` + `recargo` + `ajuste` = `monto`, donde `ajuste` es lo acordado con el
cliente al cobrar menos lo calculado (negativo = descuento, 0 si se cobró lo calculado);
`minutos` de permanencia, `tipo` (CHECK: `normal|ticket_perdido`), `metodo_pago` (CHECK
en bases nuevas: `efectivo|transferencia`, default `efectivo` para filas migradas),
`impreso` (1 cuando salió el recibo original: lo marca `liquidar` si imprimió, o la
primera reimpresión de un cobro hecho sin imprimir).

### `caja_dias` — una fila por jornada
PK `fecha` `'YYYY-MM-DD'` local. Guarda **sólo lo que decide un humano**: `base_inicial`,
`abierta_at`, y al cerrar `cerrada_at`, `conteo_final`, `diferencia`
(`conteo_final - esperado`, con signo), `queda_en_caja` (lo que se deja en el cajón para
la jornada siguiente, ≤ `conteo_final`; NULL en los cierres anteriores a la columna, que
dejaban todo lo contado) y `observaciones` (máx. 300 caracteres).
El efectivo del día **no** se guarda aquí: se deriva siempre de la vista `ventas` para
que no haya dos verdades del mismo dinero.

### `tipos_lavada` — catálogo del lavadero
`nombre` (máx. 40, sin repetir entre los vigentes, sin distinguir mayúsculas), `precio`
(CHECK ≥ 0) y `activo`: **nunca se borra**, se retira (`activo = 0`) para que las
lavadas que lo usaron lo sigan nombrando.

### `lavados` — una moto en el lavadero, con su cobro
`placa`, `marca`, `color`, `casco`, `locker`; `tipo_lavada_id` y una **copia** de
`tipo_lavada` (nombre) y `precio_lista` al ingresar — cambiar el catálogo no altera a la
moto que ya está adentro —; `precio` (lo que se cobrará: el de lista o el pactado) y
`pactado` (1 si se negoció); `hora_entrada`/`hora_entrega`, `estado` (CHECK:
`activo|entregado`, índice único parcial por placa activa, como `vehicles`). El cobro vive
en la misma fila, porque no hay celda ni permanencia que liquidar: `ajuste`, `monto`
(`precio + ajuste`, NULL hasta entregar), `metodo_pago` e `impreso`.

### Vista `ventas` — todo lo cobrado
`UNION ALL` de `transactions` (origen `'parqueadero'`) y de los `lavados` entregados
(origen `'lavadero'`, `fecha = hora_entrega`), con `origen, id, placa, monto,
metodo_pago, fecha`. Es la **única** fuente de las métricas, la caja, `recaudoHoy` y el
"cobro acumulado" de la ficha: cada cobro vive en su tabla y la vista sólo los junta.

## Reglas de cobro (`src/main/services/pricing.js` → `calcularCobro`)

| Tipo de tarifa   | Cálculo                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `hora`            | `horas iniciadas × tarifa_hora` (o el valor fijo de un tramo), con **tope**: nunca más que `dias × tarifa_amanecida` |
| `amanecida`       | `dias × tarifa_amanecida` (bloque de `horas_tope_dia`, 24h por defecto, iniciado)              |
| `mensualidad`     | `$0` al salir — se cobró `tarifa_mensualidad` al entrar (ver Mensualidad). Sin gracia ni recargo |
| `personalizada`   | Valor fijo de `vehicle.tarifa_personalizada`, pactado al ingresar                              |

- Antes de `minutos_gracia` (10 por defecto) el cobro es `$0`, **excepto** `personalizada`
  (esa siempre cobra el valor pactado, sin importar la permanencia).
- `ticketPerdido: true` suma `settings.cargo_ticket_perdido` (default $2.000) al total,
  sin afectar `montoBase`. Se guarda como `transactions.tipo = 'ticket_perdido'`.
- `horas = Math.max(1, Math.ceil(ms / 3600000))` — la hora empezada se cobra completa.
- `dias = Math.max(1, Math.ceil(horas / horas_tope_dia))` — define el tope y los
  bloques de amanecida.

### Reglas por tiempo (`settings.tramos_hora`)

JSON con una lista de tramos `{ desde, hasta, valor }`: si la estadía tiene **más de
`desde` y hasta `hasta` horas iniciadas**, la tarifa por hora cobra `valor` fijo en lugar
de `horas × tarifa_hora`. Fuera de los tramos se vuelve a cobrar por hora, y el **tope
de amanecida sigue aplicando a todo** (también al valor del tramo). Ejemplo del negocio:
$2.000 la hora y `{ desde: 5, hasta: 12, valor: 10000 }` → 4 h = $8.000, 5 h = $10.000,
6 a 12 h = $10.000, 13 h = tope de la amanecida. Sólo afecta a la tarifa `hora`; la
gracia se mira antes.

- `normalizarTramos()` valida al guardar (enteros, `hasta > desde`, `hasta ≤ 720`, valor
  ≥ 0, sin cruces) y ordena por `desde`; `calcularCobro` lee los guardados con la misma
  función pero una configuración dañada no tumba un cobro (se ignoran).
- El cobro devuelve `tramo` (el tramo aplicado o null) y `tope` (bool); el `detalle` dice
  `"7 h (tramo 5-12 h)"`, que es lo que sale en el recibo.
- `simularTarifaHora(settings)` arma la tabla 1…24 h (o una hora más allá del último
  tramo, hasta 72) con la misma `calcularCobro`; la usa `precios:simular` para la vista
  previa de Configuración con los valores **aún sin guardar**.

### Valor acordado al cobrar

`totalCobrado(calculado, acordado)` → `{ total, ajuste }`. Vacío = se cobra lo
calculado; un número ≥ 0 es lo que se cobra (puede ser 0 o más que lo calculado);
cualquier otra cosa lanza. Lo usan `liquidar` (`totalAcordado`) y `entregarLavado`. La UI
es el lápiz de `TotalEditable.jsx`: mientras se edita, los botones de cobro y el Enter de
la vista quedan bloqueados para no cobrar con un valor sin aplicar.

### `cotizar` y `liquidar`

`cotizar({ placa, ticketPerdido })` (en `liquidacion.js`) sólo lee — no cambia estado, se
usa para mostrar el total antes de cobrar y se re-llama cada vez que se marca/desmarca
"ticket perdido" en la UI (`Salida.jsx`).
`liquidar({ vehicleId | placa, ticketPerdido, metodoPago, totalAcordado?, imprimir? })` es
la operación que sí cambia estado: cierra el vehículo, registra la transacción (atómico)
y luego imprime según `debeImprimir(imprimir, settings)`. **`metodoPago` es
obligatorio** (`'efectivo' | 'transferencia'`): sin él lanza error y el vehículo sigue
adentro. La UI no preselecciona ninguno a propósito.

**`imprimir` es el botón que usó el operario y manda**: `true` ("Cobrar e imprimir")
imprime el recibo original aunque `imprimir_automatico` esté apagada; `false` ("Cobrar
sin imprimir") no imprime aunque esté encendida (`impresion.motivo = 'Cobrado sin
imprimir'`). Sin el parámetro decide `imprimir_automatico`. Hasta el 2026-10-28 el
backend sólo miraba la configuración: "Cobrar sin imprimir" imprimía igual, y "Cobrar e
imprimir" con la automática apagada sacaba el original marcado `** COPIA **`.

Ojo: `liquidar` recalcula el cobro con la hora del clic, no reutiliza la cotización en
pantalla. Si el operario deja la vista abierta y se cruza una hora, el total cobrado puede
ser mayor que el que se veía.

## Mensualidad (`src/main/services/entrada.js`)

Decisión del negocio (2026-10-20): la mensualidad **se cobra al entrar** y la moto se
queda el mes adentro.

- `registrarEntrada(datos)` es la única puerta de `vehicles:crear`. Con
  `tipo_tarifa: 'mensualidad'` exige `datos.metodoPago` (`normalizarMetodoPago`) y, dentro de
  un mismo `enTransaccion`, crea el ingreso y la venta. La venta lleva `monto =
  tarifa_mensualidad`, `tipo_tarifa = 'mensualidad'`, `tipo = 'normal'`, `minutos = 0` y
  `fecha = hora_entrada`. Si es en efectivo, también asegura la jornada de caja.
  Placa duplicada o falta de método → no queda ni ingreso ni venta.
- Imprime **siempre** el comprobante (`imprimirRecibo` con `cobroMensualidad()`),
  ignorando `imprimir_automatico`, y no imprime tiquete de entrada. Si sale bien, marca
  `impreso`.
- `liquidar` de una mensualidad: sin `metodoPago`, sin `ticketPerdido`, **sin venta ni
  recibo**. Sólo `finalizar()` y devuelve `transaccion: null, impresion: null`.
  `calcularCobro` devuelve `total 0` y `detalle 'Mensualidad'` antes de mirar la gracia.
- **No hay vigencias**: cada entrada con mensualidad cobra la tarifa completa (decisión
  explícita del negocio). Si algún día se piden, se necesita una tabla o un campo de
  "pagado hasta" por placa.
- `transactions.tipo_tarifa = 'mensualidad'` distingue estas ventas. `componerRecibo`
  usa ese campo para imprimir el comprobante: fecha, tarifa y total, sin salida,
  permanencia, método de pago ni barras. Las reimpresiones (`printer:reimprimir`)
  respetan el mismo formato. Ventas de mensualidad de $0 hechas antes de este cambio (al
  salir) se reimprimen también con ese formato.
- Renderer: `permanencia(tipoTarifa, horaEntrada, ahora)` en `lib/format.js` devuelve
  `'Mensualidad'` en lugar del tiempo; la usan `CeldasGrid`, `Panel`, `Vehiculos` y las
  sugerencias de `Salida`. `mapaCeldas()` incluye `tipoTarifa` en cada celda. En la celda
  la palabra va a 10 px apretada; cabe justo en el mínimo de 68 px de la cuadrícula.

## Caja registradora (`src/main/services/caja.js`)

Regla que gobierna el módulo: **sólo el efectivo entra al cajón**. Una transferencia es
una venta igual para las métricas, pero el saldo físico no se mueve.

- `esperado = base_inicial + efectivo del día` — nunca incluye transferencias. El
  efectivo del día sale de la vista `ventas`: incluye lo cobrado en el lavadero.
- `asegurarJornada(fecha = hoy)` crea la jornada si no existe — cobrar nunca queda
  bloqueado por un paso administrativo. **Su base es lo que quedó en el cajón al cerrar la
  jornada anterior** (`cajaRepo.jornadaAnterior`: la fecha menor más cercana, aunque haya
  días sin jornada en medio; `queda_en_caja ?? conteo_final`). Si la anterior no se cerró,
  o no hay, usa `settings.caja_base_predeterminada`. La llaman `resumenCaja`, `liquidar`, la
  mensualidad y `entregarLavado` (dentro de su transacción, con la fecha del cobro). Si la
  jornada de hoy ya existía cuando se cierra tarde la de ayer, su base no cambia sola: la
  vista ofrece "Usar ese valor".
- `resumenCaja(fecha = hoy)` trae base, efectivo, transferencia, total, `operaciones`,
  `cobrosEfectivo` (cuántos de esos cobros fueron en efectivo), esperado, el cierre
  (`conteoFinal`, `diferencia`, `quedaEnCaja`, `observaciones`), `anterior` (`{ fecha,
  cerrada, quedaEnCaja }` de la jornada previa, o null) y `movimientos` (las filas de
  `ventas` del día).
- `abrirCaja({ baseInicial })` fija o corrige la base (≥ 0) de la jornada.
- `cerrarCaja({ conteoFinal, quedaEnCaja?, observaciones })` guarda conteo, diferencia y lo
  que queda (vacío = todo lo contado; tiene que estar entre 0 y el conteo); lanza si el día
  ya está cerrado. Con `fecha` cierra una jornada pasada: así se cierra al día siguiente la
  que se olvidó (la vista la abre desde el aviso o desde "Otras jornadas").
- `reabrirCaja()` borra conteo/diferencia/`queda_en_caja`/`cerrada_at`, conserva base y
  cobros. Si la jornada siguiente ya abrió con lo que quedó, su base no se toca.
- **Cerrar no bloquea cobros**: un cobro en efectivo posterior al cierre aumenta
  `esperado`, pero `diferencia` queda congelada con el valor del momento del cierre. Por
  eso la tarjeta del cierre muestra "Debía haber" como `conteoFinal − diferencia` (lo
  esperado al cerrar) y, si hubo efectivo después del cierre (`movimientos` con `fecha >
  cerradaAt`), avisa que hay que reabrir y cerrar otra vez: esa plata está en el cajón
  pero no en `queda_en_caja`, y la jornada siguiente abriría corta.
- `metricasVentas()` devuelve `dia`, `semana` (desde el lunes), `mes` (desde el día 1),
  cada uno con `{ operaciones, cobrosEfectivo, efectivo, transferencia, lavadero, total }`
  (`lavadero` es la parte del total que vino del lavadero; ya está sumada en los demás), y
  `serieMes` (una fila por día **con ventas**). Los límites de periodo los calcula SQLite
  (`transactionsRepo.limitesPeriodos`) para coincidir con `date(fecha)`.
- La gráfica (`Tendencia` en `PanelVentas.jsx`) rellena los días sin ventas y extiende el
  eje hasta el fin del mes, para que las barras no cambien de ancho con los días: barras
  apiladas efectivo/transferencia, escala con máximo y cero, y el promedio diario
  punteado, que divide por los días transcurridos (también los que no tuvieron cobros) y
  termina en la barra de hoy.

## Lavadero (`src/main/services/lavadero.js`)

Construido el 2026-10-28. El administrador arma el catálogo en Configuración → Tipos de
lavada (`guardarTipo` crea o, con `id`, corrige; `retirarTipo` lo saca del catálogo). La
vista `Lavadero.jsx` (`F6`) tiene dos pestañas con los mismos gestos del parqueadero:

- **Ingresar moto** → `ingresarLavado(datos)`: placa y `tipoLavadaId` obligatorios (el
  tipo tiene que estar vigente), `marca`/`color` opcionales, `casco` + `locker`
  opcional y `valorPactado` opcional, que reemplaza el precio de lista. Rechaza la misma
  placa dos veces en el lavadero. **Sólo guarda**: al volver, la vista pregunta
  "¿Imprimir el tiquete de ingreso?" (Enter imprime, Esc no) y si dice que sí llama
  `printer:tiqueteLavado`. Se puede reimprimir desde la entrega.
- **Entregar y cobrar** → `entregarLavado({ id, metodoPago, totalAcordado?, imprimir? })`:
  igual que `liquidar` — método de pago obligatorio, valor acordado con el lápiz,
  `imprimir` según el botón, cobro + jornada de caja en una transacción y la impresión
  después. No se cobra dos veces.

A la derecha, siempre a la vista, las motos adentro (refresco cada 10 s; tocar una abre su
entrega) y las entregadas hoy, con botón para imprimir el recibo (original si nunca
salió, si no `** COPIA **`). Los cobros entran a `ventas` y, de ahí, a métricas y caja.

No hay estados intermedios (en lavado / lista): una lavada está `activo` o `entregado`.
Si se piden, van en `lavados.estado` (ampliar el CHECK exige reconstruir la tabla en
bases migradas, o agregar otra columna).

## Contrato IPC completo

Todo pasa por el envoltorio `manejar(canal, fn)` en `handlers.js`: el renderer siempre
recibe `{ ok: true, data }` o `{ ok: false, error }` — nunca una excepción sin capturar.
El preload (`src/preload/index.js`) expone esto como `window.api.<grupo>.<metodo>()`.

| Canal IPC              | `window.api`                          | Descripción |
| ----------------------- | -------------------------------------- | ----------- |
| `settings:get`          | `settings.get()`                       | Configuración actual (crea la fila si falta) |
| `settings:update`       | `settings.update(patch)`               | `actualizarConfiguracion()`: valida y actualiza sólo campos en `CAMPOS_EDITABLES`; lanza con el mensaje para el administrador |
| `precios:simular`       | `precios.simular(borrador)`            | `[{ horas, total, tramo, tope }]` con la configuración guardada + el borrador (`tarifa_hora`, `tarifa_amanecida`, `minutos_gracia`, `horas_tope_dia`, `tramos_hora`); lanza si los tramos no son válidos |
| `dashboard:resumen`     | `dashboard.resumen()`                  | `{ stats, celdas, sinCelda, ultimos, settings }` — todo lo que pinta `Panel.jsx` |
| `vehicles:crear`        | `vehiculos.crear(datos)`               | `registrarEntrada()`: entrada + tiquete; con mensualidad exige `datos.metodoPago`, cobra y siempre imprime el comprobante. Devuelve `{ vehicle, transaccion (null si no es mensualidad), impresion }` |
| `vehicles:activos`      | `vehiculos.activos()`                  | Todos los vehículos con `estado='activo'` |
| `vehicles:ultimos`      | `vehiculos.ultimos(limite=7)`          | Últimos ingresos (cualquier estado) |
| `vehicles:buscar`       | `vehiculos.buscar(texto)`              | Coincidencias parciales de placa entre activos (autocompletar en Salida) |
| `vehicles:celdaLibre`   | `vehiculos.celdaLibre()`               | Menor número de celda libre, o `null` si lleno |
| `vehicles:historial`    | `vehiculos.historial(filtros)`         | `{texto, estado, desde, hasta, limite, offset}` — usado por `Vehiculos.jsx` |
| `vehicles:ficha`        | `vehiculos.ficha(placa)`               | `{ vehicle, activo, resumen, visitas, ultimaTransaccion }` |
| `vehicles:cotizar`      | `vehiculos.cotizar(params)`            | Sólo lectura: `{ vehicle, settings, cobro }` |
| `vehicles:liquidar`     | `vehiculos.liquidar(params)`           | `{ vehicleId \| placa, ticketPerdido, metodoPago, totalAcordado?, imprimir? }` → cierra, cobra, imprime según el botón: `{ vehicle, transaccion, cobro, impresion }` (`transaccion.monto` es lo cobrado; `cobro`, lo calculado). Mensualidad: sólo `vehicleId \| placa`, `transaccion` e `impresion` en null |
| `lavadero:tipos`        | `lavadero.tipos(incluirRetirados?)`    | Catálogo de lavadas vigentes (o todas) |
| `lavadero:guardarTipo`  | `lavadero.guardarTipo({ id?, nombre, precio })` | Crea, o corrige si trae `id` |
| `lavadero:retirarTipo`  | `lavadero.retirarTipo(id)`             | Deja de ofrecerlo (no lo borra) |
| `lavadero:activos`      | `lavadero.activos()`                   | Motos en el lavadero, de la más antigua |
| `lavadero:buscar`       | `lavadero.buscar(texto)`               | Coincidencias parciales de placa entre las del lavadero |
| `lavadero:obtener`      | `lavadero.obtener(id)`                 | Una lavada por número (el escáner con `LAV000123`), o null |
| `lavadero:entregadosHoy`| `lavadero.entregadosHoy()`             | Lavadas entregadas hoy |
| `lavadero:ingresar`     | `lavadero.ingresar(datos)`             | `ingresarLavado()`: `{ placa, tipoLavadaId, valorPactado?, marca?, color?, casco?, locker? }` → la lavada. No imprime |
| `lavadero:entregar`     | `lavadero.entregar(params)`            | `entregarLavado()`: `{ id, metodoPago, totalAcordado?, imprimir? }` → `{ lavado, impresion }` |
| `transactions:hoy`      | `transacciones.hoy(fecha?)`            | Transacciones del día (o de `fecha` `'YYYY-MM-DD'`) |
| `transactions:ultimas`  | `transacciones.ultimas(limite=20)`     | Últimas transacciones globales |
| `metricas:ventas`       | `metricas.ventas()`                    | `{ hoy, dia, semana, mes, serieMes }`, con el lavadero incluido — ver sección Caja |
| `caja:resumen`          | `caja.resumen(fecha?)`                 | Estado de la jornada (la crea si falta, con la base heredada): base, efectivo, transferencia, `operaciones`/`cobrosEfectivo`, esperado, cierre con `quedaEnCaja`, `anterior` y movimientos (filas de `ventas`) |
| `caja:abrir`            | `caja.abrir({ baseInicial, fecha? })`  | Fija/corrige la base; devuelve el resumen |
| `caja:cerrar`           | `caja.cerrar({ conteoFinal, quedaEnCaja?, observaciones?, fecha? })` | Cierra la jornada (también una pasada); lanza si ya estaba cerrada o si lo que queda no está entre 0 y lo contado |
| `caja:reabrir`          | `caja.reabrir(fecha?)`                 | Deshace un cierre |
| `caja:cierres`          | `caja.cierres(limite=14)`              | Últimas filas de `caja_dias` (historial de cierres) |
| `printer:estado`        | `impresora.estado()`                   | `{ conectada, motivo }` — usado por el indicador del Rail y `useImpresora`. En Windows `conectada` = instalada |
| `printer:prueba`        | `impresora.prueba()`                   | Página de prueba (tildes, reglas de ancho, letra menuda, código de barras "PRUEBA") |
| `printer:lista`         | `impresora.lista()`                    | `[{ nombre, etiqueta }]` impresoras instaladas en Windows, para el selector de Configuración |
| `printer:tiquete`       | `impresora.tiquete(vehicleId)`         | Reimprime el tiquete de entrada de un vehículo |
| `printer:reimprimir`    | `impresora.reimprimir(transaccionId)`  | Recibo de una transacción: marcado `** COPIA **` si el original ya salió; si se cobró sin imprimir, sale el original y queda `impreso` |
| `printer:tiqueteLavado` | `impresora.tiqueteLavado(lavadoId)`    | Tiquete de ingreso al lavadero (al responder "sí" a la pregunta, o reimpresión) |
| `printer:reciboLavado`  | `impresora.reciboLavado(lavadoId)`     | Recibo de una lavada entregada, con el mismo criterio de copia que `printer:reimprimir` |

Al agregar un canal nuevo: registrarlo en `handlers.js` con `manejar(...)` y espejarlo en
`preload/index.js` bajo el grupo correspondiente — son dos archivos, no uno.

## Hardware

### Impresora térmica Jaltech POS 58 mm (JAL58M) — `services/printer.js`

- Habla ESC/POS estándar → perfil `PrinterTypes.EPSON` (`STAR` disponible pero sin
  probar). `characterSet: PC858_EURO` es obligatorio o las tildes/ñ salen corruptas;
  `settings.impresora_sin_tildes` activa `removeSpecialCharacters` como último recurso.
- **Contrato de no-lanzar**: cada función (`imprimirRecibo`, `imprimirTiquete`,
  `imprimirTiqueteLavado`, `imprimirReciboLavado`, `imprimirPrueba`, `estadoImpresora`)
  atrapa sus propios errores y devuelve `{ ok, motivo? }`. Nunca dejar que una excepción
  de impresora suba hasta el handler IPC — el cobro/entrada ya se guardó en la base de
  datos y no debe revertirse.
- Armar y enviar están separados: `componer*(printer, …)` sólo escriben comandos en una
  instancia de `ThermalPrinter`; `enviar()` la abre con la interfaz real y ejecuta.
  `generarBytes(settings, componer)` usa una interfaz en memoria y devuelve el `Buffer`
  ESC/POS — lo usan `npm test` y cualquier vista previa.
- `debeImprimir(imprimir, settings)` / `sinImprimir(imprimir)`: la política de si sale el
  recibo de un cobro (el botón manda; sin él, `imprimir_automatico`) y el motivo que se
  informa cuando no se intentó. La usan `liquidar` y `entregarLavado`.

#### Conexión (`settings.impresora_interface`)

- `tcp://IP[:puerto]` → interfaz de red de la propia librería.
- Cualquier otra cosa es el **nombre de una impresora de Windows**, con o sin el prefijo
  `printer:` (`nombreCola()` lo quita). La UI la escoge de `printer:lista`.
- **No usar la interfaz `printer:` de node-thermal-printer**: exige un módulo nativo
  (`printer`/`electron-printer`) y sin él lanza `No driver set!` en el constructor. Así
  estuvo hasta el 2026-10-17: la impresión por nombre nunca funcionó y el error quedaba
  tragado por el contrato de no-lanzar.
- `colaWindows.js` la reemplaza con un objeto que cumple el contrato de interfaz de la
  librería (`execute(buffer)`, `isPrinterConnected()`; la librería acepta objetos):
  escribe el buffer en un temporal y corre `powershell.exe -EncodedCommand` con un
  `Add-Type` que llama `OpenPrinter / StartDocPrinter("RAW") / WritePrinter` de
  `winspool.drv`. Nombre de impresora y archivo van por variables de entorno (sin
  problemas de comillas). Errores: el script devuelve `PASO|códigoWin32` en ASCII y
  `traducirError()` arma el mensaje en español (1801 = la impresora no existe).
  Tarda ~1,5–2 s (0,8 s arrancar PowerShell + 0,5 s compilar); no se cachea la
  compilación porque la térmica tarda algo parecido en sacar el papel.
- `WritePrinter` correcto = trabajo en la cola, no papel impreso: con la impresora
  apagada Windows lo retiene. `estadoImpresora` en Windows sólo verifica que esté
  **instalada** (`webContents.getPrintersAsync()`, que en Electron 43 ya no trae estado).

#### Diseño de los papeles

- `encabezado()` es común a todos: nombre en doble tamaño (partido a mano a
  `ancho/2`), dirección, horario, teléfono en negrilla; los recibos agregan NIT.
- **Tiquete**: "TIQUETE DE ENTRADA", placa en tamaño 3×3, código de barras, entrada en
  negrilla, celda, tarifa, vehículo, políticas y "Presente este tiquete…".
- **El casco no se imprime** (pedido del negocio, 2026-10-28): ni el tiquete ni los
  recibos dicen si dejó el casco ni el locker; eso queda en pantalla para el operario.
- **Recibo**: con un valor acordado agrega "Descuento acordado -$X" (o "Ajuste acordado
  +$X") y el TOTAL es `transaccion.monto`, lo que de verdad se cobró.
- **Tiquete de lavadero**: "TIQUETE DE LAVADERO", placa 3×3, código de barras
  `codigoLavado(id)` = `LAV` + número de 6 cifras (9 caracteres → módulo 2, ~38 mm; ninguna
  placa tiene 9 caracteres, así que el escáner no los confunde), entrada, servicio N.°,
  lavada, vehículo y "VALOR" a doble tamaño.
- **Recibo de lavadero**: "RECIBO LAVADERO No." (numeración propia, la de `lavados.id`),
  entrada, entrega, la lavada con su precio, ajuste, TOTAL y pago.
- **Código de barras** (`codigoDeBarras()`): Code 128; la librería antepone `{B`.
  Mide `35 + 11 × caracteres` módulos + 10 de margen a cada lado; se usa el módulo más
  ancho (4, 3 o 2 puntos) que quepa en `ancho × 12` puntos. 58 mm: placa de ≤ 6
  caracteres → módulo 3 (~38 mm); 7 → módulo 2. Alto 140 puntos (17,5 mm). Sin HRI:
  la placa ya va grande encima. Si el código no cabe, la térmica **no imprime nada**.
- **Políticas**: fuente B (9×17, 42 caracteres en 58 mm) con interlineado 22; con la
  fuente A ocupaban el doble de papel. `{ticket_perdido}` → `pesos(cargo_ticket_perdido)`
  en `textoPoliticas()`.
- **Corte**: `cortar()` = `cut({ verticalTabAmount: 1 })`, ~17 mm de avance para pasar
  la barra de corte. El valor por defecto de la librería (8 renglones) dejaba ~3,4 cm en
  blanco por papel.
- Largos medidos: tiquete ~16 cm, recibo ~13 cm, prueba ~11 cm.

#### Trampas de node-thermal-printer 4.6

- `setTextSize(alto, ancho)` tiene los parámetros **invertidos** (arma `GS !` con el
  primero en el nibble del ancho). Usar sólo tamaños iguales (`(1,1)`, `(2,2)`) o
  mandar `GS !` a mano.
- `print`/`println` parten el texto al ancho de la **fuente A normal**, sin importar el
  tamaño o la fuente activa: el texto a doble ancho hay que partirlo a mano con
  `plegar()`, y los renglones en fuente B se envían con `add()` + `newLine()`.
- `leftRight` tampoco sabe del tamaño: a doble ancho parte el renglón (por eso el TOTAL
  del recibo se arma a mano).
- `cut()` termina con `ESC @`, que reinicia la página de códigos; cada papel es una
  instancia nueva que la vuelve a fijar.

### Escáner Jaltech PLUS 1D/QR (JAL PLUS 01) — `hooks/useEscaner.js`

Se ve como teclado USB (HID), sin driver. Se distingue de un humano por velocidad:

- `MS_ENTRE_TECLAS = 35` — si toda la ráfaga de teclas llega en menos de 35ms entre
  cada una, es el lector.
- `LARGO_MINIMO = 3` — descarta pulsaciones sueltas.
- `MS_REINICIO = 400` — un búfer abandonado por más de 400ms se olvida.
- El listener se registra en fase de **captura** (`addEventListener(..., true)`) sobre
  `document` para verse antes que cualquier handler de campo.
- Si el foco está en un input con `data-escaner="local"` (los campos de placa en
  `NuevaEntrada.jsx`, `Salida.jsx`, `IngresoLavado.jsx` y `EntregaLavado.jsx`), la
  lectura cae en el campo y **no** se emite el evento global — evita que la app navegue
  debajo del formulario que se está llenando. El campo de `EntregaLavado` acepta el código
  `LAV…` (9 caracteres) además de la placa.
- El manejo global vive en `App.jsx` → `alEscanear`, en este orden: un código `LAV000123`
  (`idDeCodigoLavado()` en `lib/format.js`, espejo de `codigoLavado`) abre la entrega de
  esa lavada; una placa activa en el parqueadero navega a Salida con el cobro listo; una
  que sólo está en el lavadero, a su entrega; si no, abre su ficha en Vehículos. El código
  de lavadero se revisa **antes** de `normalizarPlaca`, que lo cortaría a 7 caracteres.

## Convenciones del código

- **Todo el dominio está en español** (nombres de tablas, campos, funciones, variables)
  — mantener esa convención en código nuevo del proyecto; no mezclar inglés a mitad de
  camino.
- Comentarios sólo cuando explican un *por qué* no obvio (ver los que ya existen en
  `useEscaner.js`, `db/index.js`, `printer.js`) — el estilo del repo evita comentarios
  que sólo repiten el código.
- `normalizarPlaca` existe **duplicada** en `vehiclesRepo.js` (backend) y
  `lib/format.js` (frontend) — mismo criterio (mayúsculas, sin espacios/guiones,
  máx. 7 caracteres en el frontend). Si cambia la regla de negocio de placas, tocar
  ambas.
- Los repos (`*Repo.js`) sólo hacen SQL — la lógica de negocio (cálculo de tarifas,
  orquestación de la salida) vive en `services/`. No mezclar.
- **Ningún campo numérico es `type="number"`**: los pesos van en `CampoPesos` (punto de
  miles mientras se escribe; entrega un entero o `''`) y las cantidades en `CampoEntero`.
  El campo numérico del navegador no admite separadores y la rueda del mouse le cambiaba
  el valor a un precio con sólo pasar por encima.
- Una vista que edita datos que también llegan por un refresco periódico (la
  configuración cada 5 s, la caja cada 15 s) no puede pisar lo que se está escribiendo:
  ver `conservarEdiciones()` en `Configuracion.jsx` y `baseGuardada` en `PanelCaja.jsx`.
  `App.jsx` además sólo reemplaza `ajustes` si algún campo cambió (`mismosAjustes`). Así
  se corrigió el 2026-10-28 el formulario de Precios, que volvía al precio guardado a los
  pocos segundos de escribir uno nuevo.
- El `enTransaccion` de `db/index.js` es manual (`BEGIN`/`COMMIT`/`ROLLBACK` vía
  `.exec()`) porque `node:sqlite` no trae helper de transacciones como
  `better-sqlite3`.

## Sistema visual

Ver detalle completo (paleta, tokens, contraste) en el
[`README.md`](../README.md#sistema-visual). Resumen: base blanca, azul del logo
(`#0F80D8`) como acento, oscuro sólo en el rail y en las celdas ocupadas. Tipografía
Geist/Geist Mono empaquetada (sin internet, CSP sólo `'self'`). Tokens en
[`tailwind.config.js`](../tailwind.config.js); clases reutilizables
(`.panel`, `.campo`, `.btn-azul`, etc.) en
[`src/renderer/src/index.css`](../src/renderer/src/index.css).

## Atajos de teclado (`App.jsx`)

`F1`–`F6` → Panel / Nueva entrada / Registrar salida / Vehículos / Métricas y caja /
Lavadero (salen del arreglo `VISTAS` de `Rail.jsx`) · `F8` → Configuración (`ir('ajustes',
seccion)` abre una sección concreta, p. ej. `'lavadas'`) · `Enter` en Salida y en la entrega
del lavadero cobra e imprime (o avanza al siguiente si ya se cobró) · `Esc` limpia la vista.
Mientras se edita el total, Enter aplica el valor y Esc lo cancela. En la pregunta del
tiquete de lavadero, Enter imprime y Esc no.

## Pruebas y build

| Comando          | Qué hace |
| ---------------- | -------- |
| `npm run dev`     | Electron-vite en modo desarrollo, hot reload |
| `npm run build`   | Compila a `out/` |
| `npm start`       | Previsualiza la compilación (`out/`) |
| `npm test`        | Compila `pruebas/` y corre `pruebas/liquidacion.js` dentro de Electron real, sobre un `userData` temporal (`mkdtempSync`) — nunca toca la base de datos real |
| `npm run dist`    | `electron-builder --win --x64`, genera el instalador NSIS en `release/` |
| `npm run icono`   | `scripts/generar-icono.cjs`: recorta `iconoparqueadero.jpeg` en círculo y escribe `build/icon.ico` (16–256 px) y `build/icon.png` |

Ícono: `build/` es el `buildResources` de electron-builder y `win.icon` apunta a
`build/icon.ico`; lo usan el `.exe`, el instalador, el desinstalador y los accesos
directos. `iconoparqueadero.jpeg` es el mismo archivo que
`src/renderer/src/assets/logo.jpeg`; si cambia el emblema, reemplazar ambos y correr
`npm run icono`. El ícono generado se versiona en git para que `npm run dist` no dependa
de regenerarlo.

El instalador sale **sin firma digital** (no hay certificado configurado): SmartScreen
advierte al ejecutarlo en el equipo del cliente. No es un error del build.

`pruebas/liquidacion.js` es la única prueba de integración (213 comprobaciones): cubre
entradas y asignación de celdas, cotización, ticket perdido, método de pago obligatorio,
liquidación normal, doble-cobro bloqueado, reingreso de placa, **mensualidad** (método
obligatorio, venta al entrar con su valor/método/fecha, comprobante aunque la impresión
automática esté apagada, entrada rechazada sin venta, salida sin cobro ni venta),
personalizada, tope de amanecida, métricas por método de pago, caja (base, esperado sin
transferencias, cierre cuadrado, doble cierre bloqueado, reapertura, faltante con signo),
**caja de un día al siguiente** (abre con lo que quedó, retiro, cobros en efectivo contra
el total, anterior sin cerrar → base predeterminada, cierre tardío, reabrir borra lo que
quedaba), historial, **tiquete y recibo** (sobre los bytes ESC/POS de `generarBytes()`: datos del
negocio, placa, hora, recargo en las políticas, comando Code 128 con su módulo y alto,
comprobante de mensualidad sin salida/método/barras, siembra y borrado de las políticas),
**envío** (impresora inexistente → `ok:false` con mensaje, sin lanzar; corre PowerShell
de verdad, sólo en Windows), **cobrar con o sin imprimir** (el botón manda sobre la
configuración), **valor acordado** (descuento, cero, negativo/no numérico rechazado,
ajuste en el recibo y en las ventas), **reglas por tiempo** (validación, orden, cobro
dentro y fuera del tramo, tope, simulación), **validación de la configuración**, **casco
y locker** (fuera del tiquete y del recibo), **lavadero** (catálogo, ingreso, valor
pactado, catálogo copiado al ingresar, tipo retirado, tiquete con `LAV…`, entrega con
método obligatorio y valor acordado, doble cobro, ventas y caja con el lavadero, recibo
propio) y la **migración desde la primera versión** de la base (con un cierre de caja viejo,
que deja en el cajón todo lo contado). Es el lugar a extender si
se toca `pricing.js`, `liquidacion.js`, `entrada.js`, `caja.js`, `lavadero.js` o
`printer.js`.

No prueba el envío exitoso (no hay térmica en el equipo de desarrollo: se verifica en
sitio con la página de prueba) ni el renderer; no hay pruebas de UI. Las vistas nuevas
del 2026-10-28 se revisaron en la app compilada con una base temporal (Precios sin
reinicio, reglas y su aviso, tipos de lavada, total editable, cobrar sin imprimir,
lavadero completo, escáner con `LAV000002`, locker en la ficha). La caja y las métricas
se revisaron también con 29 días simulados, con y sin un día sin cobros: día, semana, mes,
la serie y la caja coincidieron con una cuenta hecha aparte, cada jornada abrió con lo que
quedó en la anterior, y la gráfica se miró el día 2, a mitad y al final del mes. No se
puede mover la fecha del sistema desde la prueba: para eso el script reemplazó el canal
`metricas:ventas` por datos armados.

Con npm ≥ 11 puede aparecer el aviso `install-scripts ... not yet covered by
allowScripts` para `esbuild` y `electron-winstaller`: en este equipo no impidió compilar
ni correr las pruebas.

## Estado del proyecto

- **Completo y funcionando**: estructura, base de datos, contrato IPC, las seis
  vistas (Panel, Nueva entrada, Salida, Vehículos, Lavadero y Configuración, que también
  aloja Métricas y caja), cálculo de tarifas con reglas por tiempo, liquidación normal y
  con ticket perdido, valor acordado al cobrar, cobrar con o sin imprimir, método de
  pago, comprobante, historial por placa, métricas de ventas, caja registradora con
  cierre diario y la base que pasa de un día al siguiente, configuración editable y
  validada, lavadero (catálogo, ingreso con
  tiquete opcional, entrega con cobro y recibo), locker del casco, impresión térmica y
  lector de código de barras.
- **Por verificar en sitio**: que la térmica lea bien el código `LAV…` de 9 caracteres
  con módulo de 2 puntos (el mismo ancho que una placa de 7, que ya se usaba).
- **Ideas que el negocio no ha pedido**: estados intermedios del lavado (en lavado /
  lista para entregar), el lavadero en el historial de Vehículos, y vigencias de la
  mensualidad (ver Mensualidad).
