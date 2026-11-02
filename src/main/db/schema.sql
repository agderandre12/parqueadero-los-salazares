-- ============================================================
-- Parqueadero Los Salazares - Esquema de base de datos (SQLite)
-- Todas las fechas se guardan como TEXT 'YYYY-MM-DD HH:MM:SS'
-- en hora LOCAL, para que las consultas por día sean directas.
-- Todos los montos son INTEGER en COP (sin decimales).
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- settings: fila única (id = 1) con la configuración del negocio
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  nombre_parqueadero   TEXT    NOT NULL DEFAULT 'Parqueadero Los Salazares',
  nit                  TEXT    NOT NULL DEFAULT '',
  direccion            TEXT    NOT NULL DEFAULT 'Cisneros - Antioquia, frente de la Jesús María Duque',
  telefono             TEXT    NOT NULL DEFAULT '3226746848',
  horario              TEXT    NOT NULL DEFAULT '7:00 a. m. - 9:00 p. m.',

  -- Capacidad
  total_celdas         INTEGER NOT NULL DEFAULT 50,

  -- Tarifas (COP)
  tarifa_hora          INTEGER NOT NULL DEFAULT 1500,
  tarifa_amanecida     INTEGER NOT NULL DEFAULT 8000,
  tarifa_mensualidad   INTEGER NOT NULL DEFAULT 60000,
  cargo_ticket_perdido INTEGER NOT NULL DEFAULT 2000,

  -- Reglas de cobro
  minutos_gracia       INTEGER NOT NULL DEFAULT 10,  -- salida antes de X min => $0
  horas_tope_dia       INTEGER NOT NULL DEFAULT 24,  -- bloque para el tope de amanecida
  -- Tramos de la tarifa por hora, en JSON: [{"desde":5,"hasta":12,"valor":10000}]
  -- = más de 5 h y hasta 12 h se cobran $10.000 fijos. Ver services/pricing.js.
  tramos_hora          TEXT    NOT NULL DEFAULT '[]',

  -- Caja registradora
  caja_base_predeterminada INTEGER NOT NULL DEFAULT 0, -- base con la que se abre el día

  -- Impresora térmica
  impresora_tipo       TEXT    NOT NULL DEFAULT 'EPSON',  -- EPSON | STAR
  impresora_interface  TEXT    NOT NULL DEFAULT '',       -- ej: printer:POS-58  /  tcp://192.168.1.50
  impresora_ancho      INTEGER NOT NULL DEFAULT 32,       -- caracteres por línea (58mm=32, 80mm=48)
  imprimir_automatico  INTEGER NOT NULL DEFAULT 1,
  impresora_sin_tildes INTEGER NOT NULL DEFAULT 0,       -- 1 si la térmica no trae la página PC858
  mensaje_recibo       TEXT    NOT NULL DEFAULT 'Gracias por preferirnos',
  -- Políticas al pie del tiquete de entrada, un párrafo por línea. NULL = nunca
  -- configuradas: `db/index.js` siembra el texto predeterminado al abrir la base.
  politicas_tiquete    TEXT,

  updated_at           TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ------------------------------------------------------------
-- vehicles: cada ingreso de una moto al parqueadero
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  placa                TEXT    NOT NULL,
  marca                TEXT    NOT NULL DEFAULT '',
  color                TEXT    NOT NULL DEFAULT '',
  casco                INTEGER NOT NULL DEFAULT 0,     -- 0/1 dejó casco
  locker               TEXT    NOT NULL DEFAULT '',    -- dónde quedó el casco (opcional)
  celda                INTEGER,                        -- número de celda asignada
  hora_entrada         TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  hora_salida          TEXT,
  tipo_tarifa          TEXT    NOT NULL DEFAULT 'hora'
                         CHECK (tipo_tarifa IN ('hora','amanecida','mensualidad','personalizada')),
  tarifa_personalizada INTEGER,                        -- usado si tipo_tarifa = 'personalizada'
  estado               TEXT    NOT NULL DEFAULT 'activo'
                         CHECK (estado IN ('activo','finalizado')),
  observaciones        TEXT    NOT NULL DEFAULT '',
  created_at           TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Una placa no puede estar activa dos veces al mismo tiempo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_placa_activa
  ON vehicles (placa) WHERE estado = 'activo';

CREATE INDEX IF NOT EXISTS idx_vehicles_estado       ON vehicles (estado);
CREATE INDEX IF NOT EXISTS idx_vehicles_placa        ON vehicles (placa);
CREATE INDEX IF NOT EXISTS idx_vehicles_hora_entrada ON vehicles (hora_entrada DESC);

-- ------------------------------------------------------------
-- transactions: historial de pagos / liquidaciones
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id   INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  placa        TEXT    NOT NULL,                       -- desnormalizado para reportes
  monto_base   INTEGER NOT NULL DEFAULT 0,             -- cobro por tiempo
  recargo      INTEGER NOT NULL DEFAULT 0,             -- ej: 2.000 por ticket perdido
  -- Valor acordado con el cliente al cobrar menos el calculado: negativo es un
  -- descuento. 0 si se cobró lo calculado.
  ajuste       INTEGER NOT NULL DEFAULT 0,
  monto        INTEGER NOT NULL,                       -- total cobrado = base + recargo + ajuste
  minutos      INTEGER NOT NULL DEFAULT 0,             -- permanencia
  tipo_tarifa  TEXT    NOT NULL DEFAULT 'hora',
  tipo         TEXT    NOT NULL DEFAULT 'normal'
                 CHECK (tipo IN ('normal','ticket_perdido')),
  -- 'efectivo' entra al cajón físico; 'transferencia' va a cuentas digitales y
  -- por eso cuenta en las ventas pero NO en el saldo de la caja.
  metodo_pago  TEXT    NOT NULL DEFAULT 'efectivo'
                 CHECK (metodo_pago IN ('efectivo','transferencia')),
  fecha        TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  impreso      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_transactions_fecha   ON transactions (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_vehicle ON transactions (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_transactions_metodo  ON transactions (metodo_pago);

-- ------------------------------------------------------------
-- caja_dias: una fila por jornada. Guarda sólo lo que un humano decide
-- (la base con la que se abre y el conteo físico del cierre); el efectivo
-- del día NO se guarda aquí, se deriva siempre de la vista `ventas` para que
-- no puedan quedar dos verdades distintas del mismo dinero.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caja_dias (
  fecha          TEXT    PRIMARY KEY,             -- 'YYYY-MM-DD' (hora local)
  base_inicial   INTEGER NOT NULL DEFAULT 0,
  abierta_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  cerrada_at     TEXT,                            -- NULL mientras la jornada siga abierta
  conteo_final   INTEGER,                         -- dinero físico contado al cerrar
  diferencia     INTEGER,                         -- conteo_final - esperado (sobrante/faltante)
  -- Lo que se deja en el cajón al cerrar (el resto se retira): es la base con
  -- la que abre la jornada siguiente. NULL mientras la jornada siga abierta.
  queda_en_caja  INTEGER,
  observaciones  TEXT    NOT NULL DEFAULT ''
);

-- ------------------------------------------------------------
-- tipos_lavada: el catálogo de lavadas que arma el administrador
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tipos_lavada (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre      TEXT    NOT NULL,
  precio      INTEGER NOT NULL DEFAULT 0 CHECK (precio >= 0),
  -- 0 = retirado: ya no se ofrece, pero las lavadas que lo usaron lo conservan.
  activo      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ------------------------------------------------------------
-- lavados: cada moto que entra al lavadero. Se cobra al entregarla, y el
-- cobro vive en la misma fila: no hay celda ni permanencia que liquidar.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lavados (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  placa           TEXT    NOT NULL,
  marca           TEXT    NOT NULL DEFAULT '',
  color           TEXT    NOT NULL DEFAULT '',
  casco           INTEGER NOT NULL DEFAULT 0,
  locker          TEXT    NOT NULL DEFAULT '',
  -- El nombre y el precio se copian al ingresar: si el administrador cambia
  -- el catálogo, la moto que ya está adentro conserva lo que se le dijo.
  tipo_lavada_id  INTEGER REFERENCES tipos_lavada(id),
  tipo_lavada     TEXT    NOT NULL,
  precio_lista    INTEGER NOT NULL DEFAULT 0,  -- precio del tipo al ingresar
  precio          INTEGER NOT NULL DEFAULT 0,  -- lo que se va a cobrar: el de lista o el pactado
  pactado         INTEGER NOT NULL DEFAULT 0,  -- 1 si el valor se negoció con el cliente
  hora_entrada    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  hora_entrega    TEXT,
  estado          TEXT    NOT NULL DEFAULT 'activo'
                    CHECK (estado IN ('activo','entregado')),
  -- Cobro, al entregar: monto = precio + ajuste (ajuste negativo = descuento).
  ajuste          INTEGER NOT NULL DEFAULT 0,
  monto           INTEGER,
  metodo_pago     TEXT    CHECK (metodo_pago IN ('efectivo','transferencia')),
  impreso         INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Igual que en el parqueadero: una placa no puede estar dos veces en el lavadero.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lavados_placa_activa
  ON lavados (placa) WHERE estado = 'activo';

CREATE INDEX IF NOT EXISTS idx_lavados_estado       ON lavados (estado);
CREATE INDEX IF NOT EXISTS idx_lavados_hora_entrega ON lavados (hora_entrega DESC);

-- ------------------------------------------------------------
-- ventas: todo lo cobrado, del parqueadero y del lavadero. Es la única
-- fuente de las métricas y de la caja: cada cobro vive en su tabla y esta
-- vista sólo los junta. Se recrea en cada arranque (no guarda datos), así
-- que un cambio aquí llega también a las bases que ya existen.
-- ------------------------------------------------------------
DROP VIEW IF EXISTS ventas;
CREATE VIEW ventas AS
  SELECT 'parqueadero' AS origen, id, placa, monto, metodo_pago, fecha
    FROM transactions
  UNION ALL
  SELECT 'lavadero' AS origen, id, placa, monto, metodo_pago, hora_entrega AS fecha
    FROM lavados
   WHERE estado = 'entregado';

-- ------------------------------------------------------------
-- Semilla de configuración
-- ------------------------------------------------------------
INSERT OR IGNORE INTO settings (id) VALUES (1);
