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
  direccion            TEXT    NOT NULL DEFAULT '',
  telefono             TEXT    NOT NULL DEFAULT '',

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

  -- Impresora térmica
  impresora_tipo       TEXT    NOT NULL DEFAULT 'EPSON',  -- EPSON | STAR
  impresora_interface  TEXT    NOT NULL DEFAULT '',       -- ej: printer:POS-58  /  tcp://192.168.1.50
  impresora_ancho      INTEGER NOT NULL DEFAULT 32,       -- caracteres por línea (58mm=32, 80mm=48)
  imprimir_automatico  INTEGER NOT NULL DEFAULT 1,
  mensaje_recibo       TEXT    NOT NULL DEFAULT 'Gracias por preferirnos',

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
  monto        INTEGER NOT NULL,                       -- total cobrado = base + recargo
  minutos      INTEGER NOT NULL DEFAULT 0,             -- permanencia
  tipo_tarifa  TEXT    NOT NULL DEFAULT 'hora',
  tipo         TEXT    NOT NULL DEFAULT 'normal'
                 CHECK (tipo IN ('normal','ticket_perdido')),
  fecha        TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  impreso      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_transactions_fecha   ON transactions (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_vehicle ON transactions (vehicle_id);

-- ------------------------------------------------------------
-- Semilla de configuración
-- ------------------------------------------------------------
INSERT OR IGNORE INTO settings (id) VALUES (1);
