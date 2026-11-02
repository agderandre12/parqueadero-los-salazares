import { app } from 'electron'
import { join, dirname } from 'path'
import { mkdirSync } from 'fs'
import { DatabaseSync } from 'node:sqlite'
// Vite inlina el contenido del .sql en el bundle del proceso principal.
import schemaSql from './schema.sql?raw'
import { POLITICAS_PREDETERMINADAS } from './predeterminados.js'

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
  // Las columnas nuevas van antes que el esquema: sus índices y la vista de
  // ventas las nombran, y en una base vieja todavía no existen.
  migrar(db)
  db.exec(schemaSql)
  sembrar(db)

  return db
}

/*
 * El esquema se aplica con CREATE TABLE IF NOT EXISTS, así que una base que ya
 * existe en el equipo del cliente nunca recibe columnas nuevas. Aquí se agregan
 * a mano, comprobando antes si ya están. En una base nueva las tablas todavía
 * no existen y no hay nada que agregar: el esquema las crea completas.
 *
 * SQLite no permite CHECK en un ALTER TABLE ADD COLUMN: en las bases migradas
 * la restricción de `metodo_pago` la garantiza la validación de
 * `services/caja.js`, no el motor.
 */
function migrar(conexion) {
  const columnas = (tabla) =>
    new Set(conexion.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name))

  // PRAGMA table_info de una tabla que no existe no trae filas.
  const falta = (tabla, columna) => {
    const actuales = columnas(tabla)
    return actuales.size > 0 && !actuales.has(columna)
  }

  if (falta('transactions', 'metodo_pago')) {
    conexion.exec(
      `ALTER TABLE transactions ADD COLUMN metodo_pago TEXT NOT NULL DEFAULT 'efectivo'`
    )
  }

  if (falta('transactions', 'ajuste')) {
    conexion.exec('ALTER TABLE transactions ADD COLUMN ajuste INTEGER NOT NULL DEFAULT 0')
  }

  if (falta('vehicles', 'locker')) {
    conexion.exec(`ALTER TABLE vehicles ADD COLUMN locker TEXT NOT NULL DEFAULT ''`)
  }

  if (falta('settings', 'caja_base_predeterminada')) {
    conexion.exec(
      'ALTER TABLE settings ADD COLUMN caja_base_predeterminada INTEGER NOT NULL DEFAULT 0'
    )
  }

  if (falta('settings', 'horario')) {
    conexion.exec(`ALTER TABLE settings ADD COLUMN horario TEXT NOT NULL DEFAULT ''`)
  }

  if (falta('settings', 'impresora_sin_tildes')) {
    conexion.exec(
      'ALTER TABLE settings ADD COLUMN impresora_sin_tildes INTEGER NOT NULL DEFAULT 0'
    )
  }

  if (falta('settings', 'politicas_tiquete')) {
    conexion.exec('ALTER TABLE settings ADD COLUMN politicas_tiquete TEXT')
  }

  if (falta('settings', 'tramos_hora')) {
    conexion.exec(`ALTER TABLE settings ADD COLUMN tramos_hora TEXT NOT NULL DEFAULT '[]'`)
  }

  if (falta('settings', 'telegram_activo')) {
    conexion.exec('ALTER TABLE settings ADD COLUMN telegram_activo INTEGER NOT NULL DEFAULT 0')
  }

  if (falta('settings', 'telegram_token')) {
    conexion.exec(`ALTER TABLE settings ADD COLUMN telegram_token TEXT NOT NULL DEFAULT ''`)
  }

  if (falta('settings', 'telegram_chat_id')) {
    conexion.exec(`ALTER TABLE settings ADD COLUMN telegram_chat_id TEXT NOT NULL DEFAULT ''`)
  }

  if (falta('caja_dias', 'queda_en_caja')) {
    conexion.exec('ALTER TABLE caja_dias ADD COLUMN queda_en_caja INTEGER')
  }

  if (falta('caja_dias', 'aviso_estado')) {
    conexion.exec('ALTER TABLE caja_dias ADD COLUMN aviso_estado TEXT')
  }
}

/** Textos predeterminados; necesita la fila de configuración que crea el esquema. */
function sembrar(conexion) {
  // Sólo la primera vez: si el administrador borra las políticas queda '' (no
  // NULL) y el tiquete sale sin ellas, que es lo que pidió.
  conexion
    .prepare('UPDATE settings SET politicas_tiquete = ? WHERE id = 1 AND politicas_tiquete IS NULL')
    .run(POLITICAS_PREDETERMINADAS)
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
