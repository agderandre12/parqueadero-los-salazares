import { getDb } from './index.js'
import { ahoraSql } from '../services/tiempo.js'

const normalizarPlaca = (p) => String(p || '').toUpperCase().replace(/[\s-]/g, '').trim()

/** Registra una entrada. Devuelve el vehículo creado. */
export function crearEntrada(datos) {
  const db = getDb()
  const placa = normalizarPlaca(datos.placa)
  if (!placa) throw new Error('La placa es obligatoria')

  const yaActivo = buscarActivoPorPlaca(placa)
  if (yaActivo) {
    throw new Error(`La placa ${placa} ya se encuentra dentro del parqueadero`)
  }

  const celda = datos.celda ?? primeraCeldaLibre()

  const info = db
    .prepare(
      `INSERT INTO vehicles
         (placa, marca, color, casco, celda, hora_entrada, tipo_tarifa, tarifa_personalizada, estado, observaciones)
       VALUES
         (@placa, @marca, @color, @casco, @celda, @hora_entrada, @tipo_tarifa, @tarifa_personalizada, 'activo', @observaciones)`
    )
    .run({
      placa,
      marca: datos.marca || '',
      color: datos.color || '',
      casco: datos.casco ? 1 : 0,
      celda: celda ?? null,
      hora_entrada: datos.hora_entrada || ahoraSql(),
      tipo_tarifa: datos.tipo_tarifa || 'hora',
      tarifa_personalizada:
        datos.tipo_tarifa === 'personalizada' ? Number(datos.tarifa_personalizada) || 0 : null,
      observaciones: datos.observaciones || ''
    })

  return obtenerPorId(info.lastInsertRowid)
}

export function obtenerPorId(id) {
  return getDb().prepare('SELECT * FROM vehicles WHERE id = ?').get(id)
}

export function buscarActivoPorPlaca(placa) {
  return getDb()
    .prepare(`SELECT * FROM vehicles WHERE placa = ? AND estado = 'activo'`)
    .get(normalizarPlaca(placa))
}

/** Coincidencias parciales de placa entre los vehículos activos. */
export function buscarActivosSimilares(texto, limite = 8) {
  const q = `%${normalizarPlaca(texto)}%`
  return getDb()
    .prepare(
      `SELECT * FROM vehicles
        WHERE estado = 'activo' AND placa LIKE ?
        ORDER BY hora_entrada DESC LIMIT ?`
    )
    .all(q, limite)
}

export function listarActivos() {
  return getDb()
    .prepare(`SELECT * FROM vehicles WHERE estado = 'activo' ORDER BY celda ASC, hora_entrada ASC`)
    .all()
}

/** Últimos N ingresos (activos o no), más recientes primero. */
export function ultimosIngresos(limite = 7) {
  return getDb()
    .prepare(`SELECT * FROM vehicles ORDER BY hora_entrada DESC, id DESC LIMIT ?`)
    .all(limite)
}

/** Marca el vehículo como finalizado. Se usa dentro de la liquidación. */
export function finalizar(id, horaSalida = ahoraSql()) {
  getDb()
    .prepare(`UPDATE vehicles SET estado = 'finalizado', hora_salida = ? WHERE id = ? AND estado = 'activo'`)
    .run(horaSalida, id)
  return obtenerPorId(id)
}

/** Menor número de celda libre (1..total_celdas), o null si está lleno. */
export function primeraCeldaLibre() {
  const db = getDb()
  const { total_celdas: total } = db.prepare('SELECT total_celdas FROM settings WHERE id = 1').get()
  const ocupadas = new Set(
    db
      .prepare(`SELECT celda FROM vehicles WHERE estado = 'activo' AND celda IS NOT NULL`)
      .all()
      .map((r) => r.celda)
  )
  for (let i = 1; i <= total; i++) if (!ocupadas.has(i)) return i
  return null
}

/** Estadísticas del día para el header del dashboard. */
export function estadisticasHoy() {
  const db = getDb()
  const { total_celdas: total } = db.prepare('SELECT total_celdas FROM settings WHERE id = 1').get()

  const ocupadas = db
    .prepare(`SELECT COUNT(*) AS n FROM vehicles WHERE estado = 'activo'`)
    .get().n

  const entradasHoy = db
    .prepare(`SELECT COUNT(*) AS n FROM vehicles WHERE date(hora_entrada) = date('now','localtime')`)
    .get().n

  const salidasHoy = db
    .prepare(
      `SELECT COUNT(*) AS n FROM vehicles
        WHERE hora_salida IS NOT NULL AND date(hora_salida) = date('now','localtime')`
    )
    .get().n

  const recaudoHoy = db
    .prepare(
      `SELECT COALESCE(SUM(monto), 0) AS total FROM transactions
        WHERE date(fecha) = date('now','localtime')`
    )
    .get().total

  return {
    totalCeldas: total,
    ocupadas,
    disponibles: Math.max(0, total - ocupadas),
    entradasHoy,
    salidasHoy,
    recaudoHoy
  }
}

/**
 * Historial filtrable para la vista de Vehículos.
 * @param {{texto?:string, estado?:'activo'|'finalizado'|'todos', desde?:string,
 *          hasta?:string, limite?:number, offset?:number}} filtros
 */
export function historial({
  texto = '',
  estado = 'todos',
  desde = null,
  hasta = null,
  limite = 200,
  offset = 0
} = {}) {
  const condiciones = []
  const params = []

  const q = String(texto || '').trim()
  if (q) {
    // La placa se normaliza (sin espacios ni guiones); marca y color van tal cual.
    condiciones.push('(placa LIKE ? OR marca LIKE ? OR color LIKE ?)')
    params.push(`%${normalizarPlaca(q)}%`, `%${q}%`, `%${q}%`)
  }

  if (estado === 'activo' || estado === 'finalizado') {
    condiciones.push('estado = ?')
    params.push(estado)
  }

  if (desde) {
    condiciones.push('date(hora_entrada) >= ?')
    params.push(desde)
  }
  if (hasta) {
    condiciones.push('date(hora_entrada) <= ?')
    params.push(hasta)
  }

  const donde = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''

  return getDb()
    .prepare(
      `SELECT * FROM vehicles ${donde}
        ORDER BY (estado = 'activo') DESC, hora_entrada DESC, id DESC
        LIMIT ? OFFSET ?`
    )
    .all(...params, limite, offset)
}

/** Historial acumulado de una placa: cuántas veces vino y cuánto ha dejado. */
export function resumenPlaca(placa) {
  const db = getDb()
  const p = normalizarPlaca(placa)

  const visitas = db
    .prepare('SELECT COUNT(*) AS n, MIN(hora_entrada) AS primera FROM vehicles WHERE placa = ?')
    .get(p)

  const cobrado = db
    .prepare('SELECT COALESCE(SUM(monto), 0) AS total FROM transactions WHERE placa = ?')
    .get(p)

  return {
    placa: p,
    visitas: visitas.n,
    primeraVisita: visitas.primera,
    totalCobrado: cobrado.total
  }
}

/** Mapa de celdas para la cuadrícula visual. */
export function mapaCeldas() {
  const db = getDb()
  const { total_celdas: total } = db.prepare('SELECT total_celdas FROM settings WHERE id = 1').get()
  const activos = listarActivos()
  const porCelda = new Map(activos.filter((v) => v.celda).map((v) => [v.celda, v]))

  const celdas = []
  for (let i = 1; i <= total; i++) {
    const v = porCelda.get(i)
    celdas.push({
      numero: i,
      ocupada: Boolean(v),
      placa: v ? v.placa : null,
      horaEntrada: v ? v.hora_entrada : null,
      vehicleId: v ? v.id : null
    })
  }
  // Vehículos activos sin celda asignada (parqueadero lleno)
  const sinCelda = activos.filter((v) => !v.celda)
  return { celdas, sinCelda }
}

export { normalizarPlaca }
