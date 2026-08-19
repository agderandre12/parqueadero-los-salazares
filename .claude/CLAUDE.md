# Parqueadero Los Salazares — contexto del proyecto

Aplicación de escritorio **Electron + Vite + React + Tailwind + SQLite** para gestionar
un parqueadero de motos. Local, sin internet, un solo archivo de base de datos.
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
"registrar la transacción" sea una sola operación atómica. La impresión ocurre
**después** y fuera de la transacción: si la impresora falla, el cobro ya quedó
guardado y **nunca se revierte** (ver sección Hardware).

## Mapa de archivos

```
src/main/
  index.js                  Arranque: crea ventana, abre DB, registra handlers IPC
  db/
    schema.sql               Esquema SQLite (settings, vehicles, transactions)
    index.js                 getDb() / enTransaccion() / closeDb()
    settingsRepo.js          CRUD de la fila única de configuración (id=1)
    vehiclesRepo.js          Entradas, celdas, búsquedas, estadísticas, historial
    transactionsRepo.js      Historial de pagos/liquidaciones
  services/
    pricing.js                calcularCobro() — el corazón del cálculo de tarifas
    liquidacion.js            cotizar() y liquidar() — orquesta repos + pricing + printer
    printer.js                Impresión ESC/POS (node-thermal-printer), nunca lanza
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
    Configuracion.jsx           Tarifas, reglas, negocio, capacidad, impresora, escáner
  components/
    Rail.jsx                   Nav lateral oscura + indicadores de escáner/impresora
    CeldasGrid.jsx              Cuadrícula visual de celdas ocupadas/libres
    Icono.jsx                   Set propio de iconos SVG (sin librería externa)
    Toast.jsx                   Confirmaciones flotantes autodestructivas
  hooks/
    useDashboard.js             useDashboard (polling 5s), useReloj (1s), useImpresora (30s)
    useEscaner.js                Detección de lector HID por velocidad de tecleo
  lib/format.js                 Moneda COP, fechas, placas — SOLO para el renderer

pruebas/liquidacion.js        Prueba de integración (entrada -> cobro -> liquidación)
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
Nombre/NIT/dirección/teléfono del negocio, `total_celdas`, las 4 tarifas, `minutos_gracia`,
`horas_tope_dia`, y toda la config de impresora (`impresora_tipo`, `impresora_interface`,
`impresora_ancho`, `imprimir_automatico`, `mensaje_recibo`). `getSettings()` hace
`INSERT OR IGNORE` antes de leer, así que siempre hay fila. Sólo los campos en
`CAMPOS_EDITABLES` (`settingsRepo.js`) se aceptan en `updateSettings(patch)`.

### `vehicles` — un registro por ingreso
`placa` (normalizada: mayúsculas, sin espacios/guiones), `celda` (nullable — el
parqueadero puede llenarse), `hora_entrada`/`hora_salida`, `tipo_tarifa` (CHECK:
`hora|amanecida|mensualidad|personalizada`), `tarifa_personalizada` (sólo si aplica),
`estado` (CHECK: `activo|finalizado`). **Índice único parcial**
`idx_vehicles_placa_activa` garantiza que una placa no esté activa dos veces
simultáneamente — la re-entrada antes de liquidar lanza error
(`vehiclesRepo.crearEntrada`).

### `transactions` — historial de pagos
`vehicle_id` (FK `ON DELETE CASCADE`), `placa` desnormalizada para reportes,
`monto_base` + `recargo` = `monto`, `minutos` de permanencia, `tipo` (CHECK:
`normal|ticket_perdido`), `impreso` (bandera que marca `printer.js` tras imprimir con
éxito).

## Reglas de cobro (`src/main/services/pricing.js` → `calcularCobro`)

| Tipo de tarifa   | Cálculo                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `hora`            | `horas iniciadas × tarifa_hora`, con **tope**: nunca más que `dias × tarifa_amanecida`        |
| `amanecida`       | `dias × tarifa_amanecida` (bloque de `horas_tope_dia`, 24h por defecto, iniciado)              |
| `mensualidad`     | `$0` al salir — el mes ya está pagado                                                          |
| `personalizada`   | Valor fijo de `vehicle.tarifa_personalizada`, pactado al ingresar                              |

- Antes de `minutos_gracia` (10 por defecto) el cobro es `$0`, **excepto** `personalizada`
  (esa siempre cobra el valor pactado, sin importar la permanencia).
- `ticketPerdido: true` suma `settings.cargo_ticket_perdido` (default $2.000) al total,
  sin afectar `montoBase`. Se guarda como `transactions.tipo = 'ticket_perdido'`.
- `horas = Math.max(1, Math.ceil(ms / 3600000))` — la hora empezada se cobra completa.
- `dias = Math.max(1, Math.ceil(horas / horas_tope_dia))` — define el tope y los
  bloques de amanecida.

`cotizar({ placa, ticketPerdido })` (en `liquidacion.js`) sólo lee — no cambia estado, se
usa para mostrar el total antes de cobrar y se re-llama cada vez que se marca/desmarca
"ticket perdido" en la UI (`Salida.jsx`). `liquidar({ vehicleId | placa, ticketPerdido })`
es la operación que sí cambia estado: cierra el vehículo, registra la transacción
(atómico) y luego intenta imprimir.

## Contrato IPC completo

Todo pasa por el envoltorio `manejar(canal, fn)` en `handlers.js`: el renderer siempre
recibe `{ ok: true, data }` o `{ ok: false, error }` — nunca una excepción sin capturar.
El preload (`src/preload/index.js`) expone esto como `window.api.<grupo>.<metodo>()`.

| Canal IPC              | `window.api`                          | Descripción |
| ----------------------- | -------------------------------------- | ----------- |
| `settings:get`          | `settings.get()`                       | Configuración actual (crea la fila si falta) |
| `settings:update`       | `settings.update(patch)`               | Actualiza sólo campos en `CAMPOS_EDITABLES` |
| `dashboard:resumen`     | `dashboard.resumen()`                  | `{ stats, celdas, sinCelda, ultimos, settings }` — todo lo que pinta `Panel.jsx` |
| `vehicles:crear`        | `vehiculos.crear(datos)`               | Registra entrada + intenta imprimir tiquete. Devuelve `{ vehicle, impresion }` |
| `vehicles:activos`      | `vehiculos.activos()`                  | Todos los vehículos con `estado='activo'` |
| `vehicles:ultimos`      | `vehiculos.ultimos(limite=7)`          | Últimos ingresos (cualquier estado) |
| `vehicles:buscar`       | `vehiculos.buscar(texto)`              | Coincidencias parciales de placa entre activos (autocompletar en Salida) |
| `vehicles:celdaLibre`   | `vehiculos.celdaLibre()`               | Menor número de celda libre, o `null` si lleno |
| `vehicles:historial`    | `vehiculos.historial(filtros)`         | `{texto, estado, desde, hasta, limite, offset}` — usado por `Vehiculos.jsx` |
| `vehicles:ficha`        | `vehiculos.ficha(placa)`               | `{ vehicle, activo, resumen, visitas, ultimaTransaccion }` |
| `vehicles:cotizar`      | `vehiculos.cotizar(params)`            | Sólo lectura: `{ vehicle, settings, cobro }` |
| `vehicles:liquidar`     | `vehiculos.liquidar(params)`           | Cierra, cobra, imprime: `{ vehicle, transaccion, cobro, impresion }` |
| `transactions:hoy`      | `transacciones.hoy(fecha?)`            | Transacciones del día (o de `fecha` `'YYYY-MM-DD'`) |
| `transactions:ultimas`  | `transacciones.ultimas(limite=20)`     | Últimas transacciones globales |
| `printer:estado`        | `impresora.estado()`                   | `{ conectada, motivo }` — usado por el indicador del Rail y `useImpresora` |
| `printer:prueba`        | `impresora.prueba()`                   | Página de prueba (acentos, ancho, perfil) |
| `printer:tiquete`       | `impresora.tiquete(vehicleId)`         | Reimprime el tiquete de entrada de un vehículo |
| `printer:reimprimir`    | `impresora.reimprimir(transaccionId)`  | Reimprime el recibo marcado `** COPIA **` |

Al agregar un canal nuevo: registrarlo en `handlers.js` con `manejar(...)` y espejarlo en
`preload/index.js` bajo el grupo correspondiente — son dos archivos, no uno.

## Hardware

### Impresora térmica Jaltech POS 58 mm (JAL58M) — `services/printer.js`

- Habla ESC/POS estándar → perfil `PrinterTypes.EPSON` (`STAR` disponible pero sin
  probar). `characterSet: PC858_EURO` es obligatorio o las tildes/ñ salen corruptas.
- Se conecta por nombre de cola de Windows (`printer:JAL58M`) o TCP (`tcp://192.168.1.50`),
  configurado en `settings.impresora_interface`.
- **Contrato de no-lanzar**: cada función (`imprimirRecibo`, `imprimirTiquete`,
  `imprimirPrueba`, `estadoImpresora`) atrapa sus propios errores y devuelve
  `{ ok, motivo? }`. Nunca dejar que una excepción de impresora suba hasta el handler
  IPC — el cobro/entrada ya se guardó en la base de datos y no debe revertirse.
- Imprime dos papeles distintos: **tiquete de entrada** (con barcode CODE128 de la
  placa, leído después por el escáner) y **recibo de salida** (desglose del cobro). Una
  reimpresión agrega el sello `** COPIA **`.

### Escáner Jaltech PLUS 1D/QR (JAL PLUS 01) — `hooks/useEscaner.js`

Se ve como teclado USB (HID), sin driver. Se distingue de un humano por velocidad:

- `MS_ENTRE_TECLAS = 35` — si toda la ráfaga de teclas llega en menos de 35ms entre
  cada una, es el lector.
- `LARGO_MINIMO = 3` — descarta pulsaciones sueltas.
- `MS_REINICIO = 400` — un búfer abandonado por más de 400ms se olvida.
- El listener se registra en fase de **captura** (`addEventListener(..., true)`) sobre
  `document` para verse antes que cualquier handler de campo.
- Si el foco está en un input con `data-escaner="local"` (los campos de placa en
  `NuevaEntrada.jsx` y `Salida.jsx`), la lectura cae en el campo y **no** se emite el
  evento global — evita que la app navegue debajo del formulario que se está llenando.
- El manejo global vive en `App.jsx` → `alEscanear`: si la placa leída está activa,
  navega a Salida con el cobro ya listo; si no, abre su ficha en Vehículos.

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

`F1`–`F4` → Panel / Nueva entrada / Registrar salida / Vehículos · `F8` → Configuración ·
`Enter` en Salida cobra (o avanza al siguiente cliente si ya se cobró) · `Esc` limpia la
vista de Salida.

## Pruebas y build

| Comando          | Qué hace |
| ---------------- | -------- |
| `npm run dev`     | Electron-vite en modo desarrollo, hot reload |
| `npm run build`   | Compila a `out/` |
| `npm start`       | Previsualiza la compilación (`out/`) |
| `npm test`        | Compila `pruebas/` y corre `pruebas/liquidacion.js` dentro de Electron real, sobre un `userData` temporal (`mkdtempSync`) — nunca toca la base de datos real |
| `npm run dist`    | `electron-builder --win --x64`, genera el instalador NSIS en `release/` |

`pruebas/liquidacion.js` es la única prueba de integración: cubre entradas y asignación
de celdas, cotización, ticket perdido, liquidación normal, doble-cobro bloqueado,
reingreso de placa, mensualidad/personalizada, tope de amanecida e historial. Es el
lugar a extender si se toca `pricing.js` o `liquidacion.js`.

## Estado del proyecto

- **Completo y funcionando**: estructura, base de datos, contrato IPC, las cinco
  vistas, cálculo de tarifas, liquidación normal y con ticket perdido, comprobante,
  historial por placa, configuración editable, impresión térmica, lector de código de
  barras.
- **Pendiente, con el puesto reservado en la navegación**: módulo de **Lavadero**
  (ver el ítem deshabilitado en [`Rail.jsx`](../src/renderer/src/components/Rail.jsx)).
  Falta todo: tablas de servicios/tarifas de lavado, estado del lavado, vista propia,
  handlers IPC. Ningún archivo actual implementa nada de esto — es trabajo desde cero.
