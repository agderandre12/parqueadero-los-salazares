import { getDb } from './index.js'
import { normalizarPlaca } from './vehiclesRepo.js'
import { ahoraSql } from '../services/tiempo.js'

/*
 * Lavadero: el catálogo de tipos de lavada y las motos que entran a lavarse.
 * Sólo SQL; las reglas (qué se puede ingresar, cómo se cobra) viven en
 * `services/lavadero.js`.
 */

// ---------------- Tipos de lavada ----------------

export function listarTipos({ incluirRetirados = false } = {}) {
  return getDb()
    .prepare(
      `SELECT * FROM tipos_lavada
        ${incluirRetirados ? '' : 'WHERE activo = 1'}
        ORDER BY activo DESC, precio ASC, nombre COLLATE NOCASE ASC`
    )
    .all()
}

export function obtenerTipo(id) {
  return getDb().prepare('SELECT * FROM tipos_lavada WHERE id = ?').get(id)
}

/** Un tipo vigente con ese nombre (sin distinguir mayúsculas), para no repetirlo. */
export function buscarTipoPorNombre(nombre) {
  return getDb()
    .prepare('SELECT * FROM tipos_lavada WHERE activo = 1 AND nombre = ? COLLATE NOCASE')
    .get(nombre)
}

export function crearTipo({ nombre, precio }) {
  const info = getDb()
    .prepare('INSERT INTO tipos_lavada (nombre, precio) VALUES (?, ?)')
    .run(nombre, precio)
  return obtenerTipo(info.lastInsertRowid)
}

export function actualizarTipo(id, { nombre, precio }) {
  getDb().prepare('UPDATE tipos_lavada SET nombre = ?, precio = ? WHERE id = ?').run(nombre, precio, id)
  return obtenerTipo(id)
}

/** Lo saca del catálogo sin borrarlo: las lavadas que lo usaron lo siguen nombrando. */
export function retirarTipo(id) {
  getDb().prepare('UPDATE tipos_lavada SET activo = 0 WHERE id = ?').run(id)
  return obtenerTipo(id)
}

// ---------------- Lavados ----------------

export function crearLavado(datos) {
  const info = getDb()
    .prepare(
      `INSERT INTO lavados
         (placa, marca, color, casco, locker, tipo_lavada_id, tipo_lavada,
          precio_lista, precio, pactado, hora_entrada, estado)
       VALUES
         (@placa, @marca, @color, @casco, @locker, @tipo_lavada_id, @tipo_lavada,
          @precio_lista, @precio, @pactado, @hora_entrada, 'activo')`
    )
    .run({
      placa: datos.placa,
      marca: datos.marca || '',
      color: datos.color || '',
      casco: datos.casco ? 1 : 0,
      locker: datos.locker || '',
      tipo_lavada_id: datos.tipo_lavada_id,
      tipo_lavada: datos.tipo_lavada,
      precio_lista: datos.precio_lista,
      precio: datos.precio,
      pactado: datos.pactado ? 1 : 0,
      hora_entrada: datos.hora_entrada || ahoraSql()
    })

  return obtenerLavado(info.lastInsertRowid)
}

export function obtenerLavado(id) {
  return getDb().prepare('SELECT * FROM lavados WHERE id = ?').get(id)
}

export function buscarLavadoActivo(placa) {
  return getDb()
    .prepare(`SELECT * FROM lavados WHERE placa = ? AND estado = 'activo'`)
    .get(normalizarPlaca(placa))
}

/** Las motos que están en el lavadero, de la que lleva más tiempo a la última. */
export function listarLavadosActivos() {
  return getDb()
    .prepare(`SELECT * FROM lavados WHERE estado = 'activo' ORDER BY hora_entrada ASC, id ASC`)
    .all()
}

/** Coincidencias parciales de placa entre las motos que están en el lavadero. */
export function buscarLavadosActivos(texto, limite = 8) {
  return getDb()
    .prepare(
      `SELECT * FROM lavados
        WHERE estado = 'activo' AND placa LIKE ?
        ORDER BY hora_entrada DESC LIMIT ?`
    )
    .all(`%${normalizarPlaca(texto)}%`, limite)
}

/** Lavadas entregadas en un día ('YYYY-MM-DD'), de la más reciente. */
export function lavadosEntregadosDelDia(fecha, limite = 30) {
  return getDb()
    .prepare(
      `SELECT * FROM lavados
        WHERE estado = 'entregado' AND date(hora_entrega) = ?
        ORDER BY hora_entrega DESC, id DESC LIMIT ?`
    )
    .all(fecha, limite)
}

/** Cierra la lavada con su cobro. Sólo toca una que siga en el lavadero. */
export function entregarLavado({ id, horaEntrega, ajuste, monto, metodoPago }) {
  getDb()
    .prepare(
      `UPDATE lavados
          SET estado = 'entregado', hora_entrega = ?, ajuste = ?, monto = ?, metodo_pago = ?
        WHERE id = ? AND estado = 'activo'`
    )
    .run(horaEntrega, ajuste, monto, metodoPago, id)
  return obtenerLavado(id)
}

export function marcarLavadoImpreso(id, impreso = true) {
  getDb().prepare('UPDATE lavados SET impreso = ? WHERE id = ?').run(impreso ? 1 : 0, id)
}
