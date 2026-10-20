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
   - *Precios* y *Capacidad*.
   - *Impresora*: escoger la térmica de la lista e **imprimir la página de prueba**.
     Revisar que las tildes y las dos reglas salgan bien y escanear su código: la
     aplicación debe avisar *"PRUEBA no está adentro"*.
   - *Tiquete*: revisar las políticas.
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
│  │  ├─ schema.sql              # Esquema: settings, vehicles, transactions, caja_dias
│  │  ├─ index.js                # Conexión, PRAGMAs, migraciones y transacciones
│  │  ├─ settingsRepo.js         # Configuración del negocio
│  │  ├─ vehiclesRepo.js         # Entradas, celdas, búsquedas, estadísticas
│  │  ├─ transactionsRepo.js     # Historial de pagos y totales por método de pago
│  │  ├─ cajaRepo.js             # Jornadas de caja: base inicial y cierre
│  │  └─ predeterminados.js      # Textos de una base nueva (políticas del tiquete)
│  ├─ services/
│  │  ├─ pricing.js              # Cálculo de tarifas (COP)
│  │  ├─ entrada.js              # Registrar la entrada (y cobrar la mensualidad)
│  │  ├─ liquidacion.js          # Cotizar y liquidar la salida
│  │  ├─ caja.js                 # Caja registradora y métricas de ventas
│  │  ├─ printer.js              # Tiquete, recibo y página de prueba (ESC/POS)
│  │  ├─ colaWindows.js          # Envío RAW a una impresora de Windows
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
      │  └─ Configuracion.jsx    # Métricas y caja + tarifas, reglas, negocio, impresora, tiquete
      ├─ components/
      │  ├─ Rail.jsx             # Navegación oscura + estado del hardware
      │  ├─ CeldasGrid.jsx       # Mapa de celdas
      │  ├─ PanelVentas.jsx      # Ventas del día, semana y mes por método de pago
      │  ├─ PanelCaja.jsx        # Base, cuadre y cierre de la caja del día
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
  gracia, base predeterminada de la caja, configuración de la impresora térmica y
  políticas del tiquete.
- **`vehicles`** — un registro por ingreso: placa, marca, color, casco, celda, hora de entrada
  y salida, tipo de tarifa, tarifa personalizada, estado (`activo` / `finalizado`).
  Un índice único parcial impide que la misma placa esté activa dos veces.
- **`transactions`** — historial de pagos: vehículo, placa, monto base, recargo, total,
  minutos, tipo de tarifa, tipo (`normal` / `ticket_perdido`) y método de pago
  (`efectivo` / `transferencia`).
- **`caja_dias`** — una fila por jornada (`'YYYY-MM-DD'`): base inicial, hora de apertura y,
  al cerrar, el dinero contado, la diferencia y las observaciones. El efectivo del día
  **no** se guarda aquí: se suma siempre desde `transactions`.

Todos los montos son enteros en COP. Las fechas se guardan como texto
`'YYYY-MM-DD HH:MM:SS'` en hora local.

## Reglas de cobro

| Tipo de tarifa  | Cálculo                                                                   |
| --------------- | ------------------------------------------------------------------------- |
| Por hora        | Hora iniciada × tarifa, con **tope de amanecida** por cada bloque de 24 h  |
| Amanecida       | Tarifa fija por cada bloque de 24 h iniciado                              |
| Mensualidad     | Tarifa de mensualidad **cobrada al registrar la entrada**; $0 a la salida |
| Personalizada   | Valor fijo pactado al ingresar                                            |

Si la moto sale dentro de los *minutos de gracia* (10 por defecto, inclusive) no se cobra
nada, salvo con tarifa personalizada, que siempre cobra lo pactado.
El **ticket perdido** suma $2.000 al total (configurable); no aplica a la mensualidad.

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
2. La vista muestra placa, hora de llegada, permanencia, tarifa y total a cobrar.
   Con *Perdió el tiquete* el total incluye el recargo de $2.000.
3. El operario escoge el **método de pago** (*Efectivo* o *Transferencia*). Es obligatorio:
   el botón de cobro no se habilita sin él, porque decide si el dinero entra a la caja.
4. **Cobrar** cierra el ingreso, libera la celda y guarda la transacción en una sola
   operación atómica; luego muestra el comprobante con el número de recibo.

Si el cobro ya se registró y la impresora falla, la salida **no** se revierte: el recibo
queda guardado y se puede reimprimir desde el comprobante o desde la ficha del vehículo.

## Métricas y caja

Se abre con `F5` (o el icono de gráfica del rail) y tiene dos secciones:

- **Ventas** — totales del día, de la semana en curso (desde el lunes) y del mes en curso
  (desde el día 1), cada uno separado en efectivo y transferencia, más la serie diaria del
  mes.
- **Caja del día** — el cuadre del cajón físico:

  ```
  base inicial + cobros en efectivo de hoy = lo que debe haber en el cajón
  ```

  Las **transferencias cuentan como venta pero no entran al cajón**: aparecen aparte, en
  gris, para que nadie las sume.

Funcionamiento de la jornada:

- La jornada del día se crea sola con la *base predeterminada* (Configuración → Precios)
  la primera vez que se consulta la caja o se cobra en efectivo. Nunca hay que "abrir caja"
  para poder cobrar.
- La base se puede corregir en cualquier momento del día con *Guardar*.
- **Cerrar caja** pide el dinero contado y guarda la diferencia con signo: positiva es
  sobrante, negativa es faltante. Un día sólo se cierra una vez.
- Un cierre equivocado se puede **reabrir**: se borra el conteo y se conservan la base y
  los cobros.
- Los cobros posteriores al cierre se siguen registrando (la caja no bloquea la salida de
  motos), pero la diferencia guardada es la del momento del cierre.

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

Imprime cuatro papeles:

- **Tiquete de entrada** (~16 cm):
  - Encabezado: nombre del negocio en letra grande, dirección, horario y teléfono
    (sección *Negocio*).
  - "TIQUETE DE ENTRADA" y la **placa en letra triple**.
  - **Código de barras Code 128 de la placa**: 17,5 mm de alto y unos 38 mm de ancho
    (módulo de 3 puntos) para placas de hasta 6 caracteres, centrado con margen en blanco
    para que el lector lo tome de una.
  - Hora de entrada (en negrilla), celda, tarifa, vehículo y casco.
  - Las **políticas** en letra menuda (sección *Tiquete*).
- **Recibo de salida** (~13 cm): mismo encabezado más el NIT, número de recibo, placa,
  entrada, **hora de salida** (en negrilla), permanencia, tarifa, desglose, total y método
  de pago. Una reimpresión sale marcada `** COPIA **` para que no pueda usarse dos veces
  como comprobante.
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

- Placa que está adentro → abre su salida con el cobro ya calculado.
- Placa que no está adentro → abre su ficha en Vehículos.
- Con el foco en un campo de placa, el código cae en el campo y no cambia de vista.

## Atajos

- `F1`–`F4` — Panel, Nueva entrada, Registrar salida, Vehículos
- `F5` — Métricas y caja
- `F8` — Configuración
- `Enter` — cobra en la vista de salida; en el comprobante, pasa al siguiente cliente
- `Esc` — despeja la vista de salida

## Estado

- **Listo:** estructura, base de datos, IPC, las cinco vistas, cálculo de tarifas,
  liquidación normal, ticket perdido, método de pago (efectivo / transferencia),
  comprobante, historial por placa, métricas de ventas, caja registradora con cierre
  diario, configuración editable, impresión térmica y lector de código de barras.
- **Por verificar en el equipo del cliente** (no hay térmica en el equipo de desarrollo):
  que la JAL58M acepte trabajos RAW por su cola de Windows, que imprima tildes con la
  página PC858 y la letra menuda (fuente B) a 42 caracteres, y que el lector lea el
  código del tiquete. La página de prueba cubre las cuatro cosas. El contenido y las
  medidas de los papeles están verificados con una simulación de los bytes ESC/POS.
- **Preparado, sin construir:** el módulo de Lavadero. La navegación le reserva el
  puesto en [`Rail.jsx`](src/renderer/src/components/Rail.jsx); falta el modelo de
  datos (servicios, tarifas por tipo de lavado y estado del lavado).
