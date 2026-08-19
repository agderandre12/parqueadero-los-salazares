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

  return db
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
