import { getDb } from './index.js'
import { ahoraSql } from '../services/tiempo.js'

/*
 * Jornadas de caja. Este repo sólo hace SQL sobre `caja_dias`: la base con la
 * que se abre el día y el conteo con el que se cierra. Cuánto efectivo entró
 * NO vive aquí — se calcula desde `transactions` en `services/caja.js`.
 */

export function obtenerDia(fecha) {
  return getDb().prepare('SELECT * FROM caja_dias WHERE fecha = ?').get(fecha)
}

/** La jornada más reciente antes de `fecha` (no necesariamente la del día anterior). */
export function jornadaAnterior(fecha) {
  return getDb()
    .prepare('SELECT * FROM caja_dias WHERE fecha < ? ORDER BY fecha DESC LIMIT 1')
    .get(fecha)
}

/**
 * Garantiza que exista la fila de la jornada. No pisa la base de un día ya
 * abierto: se llama en cada consulta y en cada cobro en efectivo.
 */
export function asegurarDia(fecha, baseInicial = 0) {
  const db = getDb()
  db.prepare(
    'INSERT OR IGNORE INTO caja_dias (fecha, base_inicial, abierta_at) VALUES (?, ?, ?)'
  ).run(fecha, Math.max(0, Math.round(Number(baseInicial) || 0)), ahoraSql())
  return obtenerDia(fecha)
}

/** Fija (o corrige) la base de dinero con la que arranca la jornada. */
export function fijarBase(fecha, baseInicial) {
  const db = getDb()
  const base = Math.max(0, Math.round(Number(baseInicial) || 0))

  asegurarDia(fecha, base)
  db.prepare('UPDATE caja_dias SET base_inicial = ? WHERE fecha = ?').run(base, fecha)

  return obtenerDia(fecha)
}

/**
 * Guarda el conteo físico del cierre, la diferencia contra lo esperado y lo
 * que se deja en el cajón para la jornada siguiente.
 */
export function cerrarDia({ fecha, conteoFinal, diferencia, quedaEnCaja, observaciones = '' }) {
  getDb()
    .prepare(
      `UPDATE caja_dias
          SET cerrada_at = ?, conteo_final = ?, diferencia = ?, queda_en_caja = ?, observaciones = ?
        WHERE fecha = ?`
    )
    .run(
      ahoraSql(),
      Math.round(conteoFinal),
      Math.round(diferencia),
      Math.round(quedaEnCaja),
      observaciones,
      fecha
    )

  return obtenerDia(fecha)
}

/** Reabre una jornada cerrada por error: borra el conteo, conserva la base. */
export function reabrirDia(fecha) {
  getDb()
    .prepare(
      `UPDATE caja_dias
          SET cerrada_at = NULL, conteo_final = NULL, diferencia = NULL, queda_en_caja = NULL
        WHERE fecha = ?`
    )
    .run(fecha)

  return obtenerDia(fecha)
}

/** Últimos cierres, para el historial de la vista de caja. */
export function ultimosCierres(limite = 14) {
  return getDb()
    .prepare('SELECT * FROM caja_dias ORDER BY fecha DESC LIMIT ?')
    .all(limite)
}
