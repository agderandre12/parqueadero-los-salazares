import { getDb } from './index.js'
import { ahoraSql } from '../services/tiempo.js'

/** Registra el pago de una liquidación. */
export function registrarTransaccion({
  vehicle_id,
  placa,
  monto_base = 0,
  recargo = 0,
  minutos = 0,
  tipo_tarifa = 'hora',
  tipo = 'normal',
  fecha = ahoraSql(),
  impreso = 0
}) {
  const db = getDb()
  const info = db
    .prepare(
      `INSERT INTO transactions
         (vehicle_id, placa, monto_base, recargo, monto, minutos, tipo_tarifa, tipo, fecha, impreso)
       VALUES
         (@vehicle_id, @placa, @monto_base, @recargo, @monto, @minutos, @tipo_tarifa, @tipo, @fecha, @impreso)`
    )
    .run({
      vehicle_id,
      placa,
      monto_base,
      recargo,
      monto: monto_base + recargo,
      minutos,
      tipo_tarifa,
      tipo,
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
