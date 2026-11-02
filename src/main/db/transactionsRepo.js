import { getDb } from './index.js'
import { ahoraSql } from '../services/tiempo.js'

/**
 * Registra el pago de una liquidación. `ajuste` es la diferencia entre lo que
 * se acordó con el cliente y lo calculado (negativo = descuento).
 */
export function registrarTransaccion({
  vehicle_id,
  placa,
  monto_base = 0,
  recargo = 0,
  ajuste = 0,
  minutos = 0,
  tipo_tarifa = 'hora',
  tipo = 'normal',
  metodo_pago = 'efectivo',
  fecha = ahoraSql(),
  impreso = 0
}) {
  const db = getDb()
  const info = db
    .prepare(
      `INSERT INTO transactions
         (vehicle_id, placa, monto_base, recargo, ajuste, monto, minutos, tipo_tarifa, tipo,
          metodo_pago, fecha, impreso)
       VALUES
         (@vehicle_id, @placa, @monto_base, @recargo, @ajuste, @monto, @minutos, @tipo_tarifa, @tipo,
          @metodo_pago, @fecha, @impreso)`
    )
    .run({
      vehicle_id,
      placa,
      monto_base,
      recargo,
      ajuste,
      monto: monto_base + recargo + ajuste,
      minutos,
      tipo_tarifa,
      tipo,
      metodo_pago,
      fecha,
      impreso: impreso ? 1 : 0
    })

  return obtenerPorId(info.lastInsertRowid)
}

export function obtenerPorId(id) {
  return getDb().prepare('SELECT * FROM transactions WHERE id = ?').get(id)
}

export function marcarImpreso(id, impreso = true) {
  getDb().prepare('UPDATE transactions SET impreso = ? WHERE id = ?').run(impreso ? 1 : 0, id)
}

/** Historial del día (o de una fecha 'YYYY-MM-DD'). */
export function transaccionesDelDia(fecha = null) {
  const db = getDb()
  if (fecha) {
    return db
      .prepare('SELECT * FROM transactions WHERE date(fecha) = ? ORDER BY fecha DESC')
      .all(fecha)
  }
  return db
    .prepare(`SELECT * FROM transactions WHERE date(fecha) = date('now','localtime') ORDER BY fecha DESC`)
    .all()
}

export function ultimasTransacciones(limite = 20) {
  return getDb()
    .prepare('SELECT * FROM transactions ORDER BY fecha DESC, id DESC LIMIT ?')
    .all(limite)
}

/** Última transacción de un vehículo: la que se reimprime desde su ficha. */
export function ultimaDeVehiculo(vehicleId) {
  return getDb()
    .prepare('SELECT * FROM transactions WHERE vehicle_id = ? ORDER BY fecha DESC, id DESC LIMIT 1')
    .get(vehicleId)
}

/**
 * Ventas de un rango de fechas ('YYYY-MM-DD', ambos extremos incluidos),
 * separadas por método de pago. `efectivo` es lo único que toca el cajón.
 * Lee la vista `ventas`: incluye lo cobrado en el lavadero, que además se
 * informa aparte en `lavadero`.
 * @returns {{operaciones:number, cobrosEfectivo:number, efectivo:number,
 *            transferencia:number, lavadero:number, total:number}}
 */
export function totalesEntre(desde, hasta) {
  return getDb()
    .prepare(
      `SELECT
         COUNT(*) AS operaciones,
         COALESCE(SUM(CASE WHEN metodo_pago = 'efectivo'      THEN 1     ELSE 0 END), 0) AS cobrosEfectivo,
         COALESCE(SUM(CASE WHEN metodo_pago = 'efectivo'      THEN monto ELSE 0 END), 0) AS efectivo,
         COALESCE(SUM(CASE WHEN metodo_pago = 'transferencia' THEN monto ELSE 0 END), 0) AS transferencia,
         COALESCE(SUM(CASE WHEN origen = 'lavadero'           THEN monto ELSE 0 END), 0) AS lavadero,
         COALESCE(SUM(monto), 0) AS total
       FROM ventas
       WHERE date(fecha) BETWEEN ? AND ?`
    )
    .get(desde, hasta)
}

/** Serie diaria de un rango, para la barra de tendencia de la vista de métricas. */
export function ventasPorDia(desde, hasta) {
  return getDb()
    .prepare(
      `SELECT
         date(fecha) AS dia,
         COALESCE(SUM(CASE WHEN metodo_pago = 'efectivo'      THEN monto ELSE 0 END), 0) AS efectivo,
         COALESCE(SUM(CASE WHEN metodo_pago = 'transferencia' THEN monto ELSE 0 END), 0) AS transferencia,
         COALESCE(SUM(monto), 0) AS total
       FROM ventas
       WHERE date(fecha) BETWEEN ? AND ?
       GROUP BY date(fecha)
       ORDER BY dia ASC`
    )
    .all(desde, hasta)
}

/** Cobros de un día ('YYYY-MM-DD') del parqueadero y del lavadero, del más reciente. */
export function ventasDelDia(fecha) {
  return getDb()
    .prepare('SELECT * FROM ventas WHERE date(fecha) = ? ORDER BY fecha DESC')
    .all(fecha)
}

/**
 * Límites de los tres periodos que muestra la vista de métricas, resueltos por
 * SQLite para que coincidan con el `date(...,'localtime')` de las consultas.
 *
 * `'-6 days','weekday 1'` da el lunes de la semana en curso: se retrocede casi
 * una semana y se avanza al siguiente lunes, que es el de esta misma semana.
 */
export function limitesPeriodos() {
  return getDb()
    .prepare(
      `SELECT
         date('now','localtime')                          AS hoy,
         date('now','localtime','-6 days','weekday 1')     AS inicioSemana,
         date('now','localtime','start of month')          AS inicioMes`
    )
    .get()
}
