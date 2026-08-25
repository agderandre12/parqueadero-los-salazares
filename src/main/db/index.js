import { app } from 'electron'
import { join, dirname } from 'path'
import { mkdirSync } from 'fs'
import { DatabaseSync } from 'node:sqlite'
// Vite inlina el contenido del .sql en el bundle del proceso principal.
import schemaSql from './schema.sql?raw'

/*
 * Se usa `node:sqlite` (SQLite incluido en Node 24 / Electron 43) en lugar de
 * better-sqlite3: misma API síncrona, cero módulos nativos que compilar y por
 * lo tanto instalación sin Visual Studio Build Tools en el equipo del cliente.
 */

let db = null

/** Ruta del archivo .db (persistente, fuera del bundle). */
export function dbPath() {
  return join(app.getPath('userData'), 'parqueadero.db')
}

/** Abre (y crea/migra si hace falta) la base de datos. */
export function getDb() {
  if (db) return db

  const file = dbPath()
  mkdirSync(dirname(file), { recursive: true })

  db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(schemaSql)
  migrar(db)

  return db
}

/*
 * El esquema se aplica con CREATE TABLE IF NOT EXISTS, así que una base que ya
 * existe en el equipo del cliente nunca recibe columnas nuevas. Aquí se agregan
 * a mano, comprobando antes si ya están.
 *
 * SQLite no permite CHECK en un ALTER TABLE ADD COLUMN: en las bases migradas
 * la restricción de `metodo_pago` la garantiza la validación de
 * `services/caja.js`, no el motor.
 */
function migrar(conexion) {
  const columnas = (tabla) =>
    new Set(conexion.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name))

  if (!columnas('transactions').has('metodo_pago')) {
    conexion.exec(
      `ALTER TABLE transactions ADD COLUMN metodo_pago TEXT NOT NULL DEFAULT 'efectivo'`
    )
  }

  if (!columnas('settings').has('caja_base_predeterminada')) {
    conexion.exec(
      'ALTER TABLE settings ADD COLUMN caja_base_predeterminada INTEGER NOT NULL DEFAULT 0'
    )
  }
}

/**
 * Ejecuta `fn` dentro de una transacción SQL. Si `fn` lanza, hace ROLLBACK.
 * @template T @param {() => T} fn @returns {T}
 */
export function enTransaccion(fn) {
  const conexion = getDb()
  conexion.exec('BEGIN')
  try {
    const resultado = fn()
    conexion.exec('COMMIT')
    return resultado
  } catch (error) {
    try {
      conexion.exec('ROLLBACK')
    } catch {
      /* la transacción ya no estaba abierta */
    }
    throw error
  }
}

export function closeDb() {
  if (db) {
    db.close()
    db = null
  }
}
