# Parqueadero Los Salazares

Aplicación de escritorio (local, sin internet) para la gestión de un parqueadero de motos.
Electron + Vite + React + Tailwind CSS + SQLite.

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
| `npm test`       | Prueba de integración del flujo entrada → liquidación  |
| `npm run dist`   | Genera el instalador `.exe` (NSIS) en `release/`       |

Las pruebas corren sobre una base de datos temporal, así que nunca tocan los datos
reales del parqueadero.

## Dónde vive la información

La base de datos es un único archivo, fácil de respaldar:

```
%APPDATA%\parqueadero-los-salazares\parqueadero.db
```

## Estructura

```
src/
├─ main/                         # Proceso principal (Node)
│  ├─ index.js                   # Arranque de la app y la ventana
│  ├─ db/
│  │  ├─ schema.sql              # Esquema: settings, vehicles, transactions
│  │  ├─ index.js                # Conexión, PRAGMAs y transacciones
│  │  ├─ settingsRepo.js         # Configuración del negocio
│  │  ├─ vehiclesRepo.js         # Entradas, celdas, búsquedas, estadísticas
│  │  └─ transactionsRepo.js     # Historial de pagos
│  ├─ services/
│  │  ├─ pricing.js              # Cálculo de tarifas (COP)
│  │  ├─ liquidacion.js          # Cotizar y liquidar la salida
│  │  ├─ printer.js              # Impresión térmica  ← pendiente
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
      │  └─ Configuracion.jsx    # Tarifas, reglas, negocio, hardware
      ├─ components/
      │  ├─ Rail.jsx             # Navegación oscura + estado del hardware
      │  ├─ CeldasGrid.jsx       # Mapa de celdas
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

- **`settings`** — fila única (`id = 1`): nombre, NIT, dirección, teléfono, total de celdas,
  tarifas (hora / amanecida / mensualidad), cargo por ticket perdido, minutos de gracia y
  configuración de la impresora térmica.
- **`vehicles`** — un registro por ingreso: placa, marca, color, casco, celda, hora de entrada
  y salida, tipo de tarifa, tarifa personalizada, estado (`activo` / `finalizado`).
  Un índice único parcial impide que la misma placa esté activa dos veces.
- **`transactions`** — historial de pagos: vehículo, placa, monto base, recargo, total,
  minutos, tipo de tarifa y tipo (`normal` / `ticket_perdido`).

Todos los montos son enteros en COP. Las fechas se guardan como texto
`'YYYY-MM-DD HH:MM:SS'` en hora local.

## Reglas de cobro

| Tipo de tarifa  | Cálculo                                                                   |
| --------------- | ------------------------------------------------------------------------- |
| Por hora        | Hora iniciada × tarifa, con **tope de amanecida** por cada bloque de 24 h  |
| Amanecida       | Tarifa fija por cada bloque de 24 h iniciado                              |
| Mensualidad     | $0 a la salida (el mes ya está pagado)                                    |
| Personalizada   | Valor fijo pactado al ingresar                                            |

Antes de los *minutos de gracia* (10 por defecto) no se cobra nada.
El **ticket perdido** suma $2.000 al total (configurable).

## Flujo de salida

1. Se busca la placa (`F2`) o se hace clic en la celda ocupada.
2. El modal muestra placa, hora de llegada, permanencia, tarifa y total a cobrar.
   Con *Ticket perdido* el total incluye el recargo de $2.000.
3. **Liquidar** cierra el ingreso, libera la celda y guarda la transacción en una sola
   operación atómica; luego muestra el comprobante con el número de recibo.

Si el cobro ya se registró y la impresora falla, la salida **no** se revierte: el recibo
queda guardado y se puede reimprimir desde `printer:reimprimir`.

## Hardware

### Impresora Jaltech POS 58 mm (JAL58M)

Habla ESC/POS, así que usa el perfil `EPSON`. Se configura en *Configuración →
Impresora*: la conexión es el nombre de la cola de Windows (`printer:JAL58M`) o
una dirección de red (`tcp://192.168.1.50`), y el ancho es 32 caracteres.

Imprime dos papeles distintos: el **tiquete de entrada**, con el código de barras
CODE128 de la placa que después lee el escáner, y el **recibo de salida** con el
desglose del cobro. Una reimpresión sale marcada `** COPIA **` para que no pueda
usarse dos veces como comprobante.

Ninguna función de impresión lanza excepciones: si la impresora falla, el cobro
ya quedó guardado y la interfaz lo informa sin revertir nada.

### Escáner Jaltech PLUS 1D/QR (JAL PLUS 01)

No necesita configuración ni driver: Windows lo ve como teclado. La aplicación lo
escucha en todas las pantallas y lo distingue de una persona por la velocidad —
si todas las teclas llegan con menos de 35 ms de separación y el código cierra
con Enter, es una lectura.

- Placa que está adentro → abre su salida con el cobro ya calculado.
- Placa que no está adentro → abre su ficha en Vehículos.
- Con el foco en un campo de placa, el código cae en el campo y no cambia de vista.

## Atajos

- `F1`–`F4` — Panel, Nueva entrada, Registrar salida, Vehículos
- `F8` — Configuración
- `Enter` — cobra en la vista de salida; en el comprobante, pasa al siguiente cliente
- `Esc` — despeja la vista de salida

## Estado

- **Listo:** estructura, base de datos, IPC, las cinco vistas, cálculo de tarifas,
  liquidación normal, ticket perdido, comprobante, historial por placa,
  configuración editable, impresión térmica y lector de código de barras.
- **Preparado, sin construir:** el módulo de Lavadero. La navegación le reserva el
  puesto en [`Rail.jsx`](src/renderer/src/components/Rail.jsx); falta el modelo de
  datos (servicios, tarifas por tipo de lavado y estado del lavado).
