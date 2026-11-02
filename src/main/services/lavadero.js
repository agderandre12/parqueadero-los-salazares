import { enTransaccion } from '../db/index.js'
import { getSettings } from '../db/settingsRepo.js'
import * as repo from '../db/lavaderoRepo.js'
import { normalizarLocker, normalizarPlaca } from '../db/vehiclesRepo.js'
import { asegurarJornada, normalizarMetodoPago } from './caja.js'
import { totalCobrado } from './pricing.js'
import { debeImprimir, imprimirReciboLavado, sinImprimir } from './printer.js'
import { ahoraSql } from './tiempo.js'

/*
 * Lavadero. El administrador arma el catálogo de lavadas con su precio; el
 * operario ingresa la moto con una de ellas (o con un valor pactado a mano) y
 * la cobra al entregarla, con las mismas reglas de una salida del parqueadero:
 * método de pago obligatorio, valor final editable y el cobro guardado antes
 * de imprimir.
 */

// Lo que cabe en un renglón del recibo junto al precio.
const LARGO_NOMBRE = 40

const vacio = (valor) => valor === '' || valor === null || valor === undefined

function pesos(valor, mensaje) {
  const n = Number(valor)
  if (vacio(valor) || !Number.isFinite(n) || n < 0) throw new Error(mensaje)
  return Math.round(n)
}

/** Crea un tipo de lavada o, si trae `id`, corrige su nombre y su precio. */
export function guardarTipo({ id, nombre, precio } = {}) {
  const limpio = String(nombre ?? '').trim().replace(/\s+/g, ' ')
  if (!limpio) throw new Error('Escriba el nombre de la lavada')
  if (limpio.length > LARGO_NOMBRE) {
    throw new Error(`El nombre de la lavada puede tener hasta ${LARGO_NOMBRE} caracteres`)
  }
  const valor = pesos(precio, 'El precio de la lavada debe ser un valor en pesos mayor o igual a cero')

  const repetido = repo.buscarTipoPorNombre(limpio)
  if (repetido && repetido.id !== Number(id)) {
    throw new Error(`Ya existe una lavada llamada "${repetido.nombre}"`)
  }

  if (!id) return repo.crearTipo({ nombre: limpio, precio: valor })

  const actual = repo.obtenerTipo(id)
  if (!actual?.activo) throw new Error('Ese tipo de lavada ya no existe')
  return repo.actualizarTipo(actual.id, { nombre: limpio, precio: valor })
}

/** Deja de ofrecer un tipo de lavada; las motos que ya lo tienen lo conservan. */
export function retirarTipo(id) {
  const tipo = repo.obtenerTipo(id)
  if (!tipo) throw new Error('Ese tipo de lavada ya no existe')
  return repo.retirarTipo(tipo.id)
}

/**
 * Ingresa una moto al lavadero. Sólo guarda: el tiquete lo imprime la vista
 * cuando el operario dice que sí (`printer:tiqueteLavado`).
 *
 * `valorPactado` (opcional) reemplaza el precio del tipo cuando la lavada se
 * negoció con el cliente. Nombre y precio se copian a la fila: si después
 * cambia el catálogo, la moto que ya está adentro conserva lo que se le dijo.
 */
export function ingresarLavado(datos = {}) {
  const placa = normalizarPlaca(datos.placa)
  if (!placa) throw new Error('La placa es obligatoria')

  if (!datos.tipoLavadaId) throw new Error('Escoja el tipo de lavada')
  const tipo = repo.obtenerTipo(datos.tipoLavadaId)
  if (!tipo?.activo) throw new Error('Ese tipo de lavada ya no se ofrece; escoja otro')

  if (repo.buscarLavadoActivo(placa)) throw new Error(`La placa ${placa} ya está en el lavadero`)

  const pactado = !vacio(datos.valorPactado)
  const precio = pactado
    ? pesos(datos.valorPactado, 'El valor pactado debe ser un valor en pesos mayor o igual a cero')
    : tipo.precio

  return repo.crearLavado({
    placa,
    marca: String(datos.marca || '').trim(),
    color: String(datos.color || '').trim(),
    casco: Boolean(datos.casco),
    locker: datos.casco ? normalizarLocker(datos.locker) : '',
    tipo_lavada_id: tipo.id,
    tipo_lavada: tipo.nombre,
    precio_lista: tipo.precio,
    precio,
    pactado,
    hora_entrada: datos.hora_entrada
  })
}

/**
 * Entrega la moto y cobra la lavada. `totalAcordado` (opcional) es el valor
 * final que se pactó al pagar y `imprimir`, el botón que se usó. El cobro y la
 * jornada de caja se guardan juntos; la impresión va después y nunca los
 * revierte.
 *
 * @returns {Promise<{lavado:object, impresion:{ok:boolean, motivo?:string}}>}
 */
export async function entregarLavado({ id, metodoPago, totalAcordado, imprimir } = {}) {
  const settings = getSettings()
  const lavado = repo.obtenerLavado(id)
  if (!lavado) throw new Error('Lavada no encontrada')
  if (lavado.estado !== 'activo') throw new Error(`La lavada de ${lavado.placa} ya se entregó`)

  const metodo = normalizarMetodoPago(metodoPago)
  const { total, ajuste } = totalCobrado(lavado.precio, totalAcordado)
  const entrega = ahoraSql()

  const entregado = enTransaccion(() => {
    const fila = repo.entregarLavado({
      id: lavado.id,
      horaEntrega: entrega,
      ajuste,
      monto: total,
      metodoPago: metodo
    })
    // Como en el parqueadero: el efectivo entra al cajón aunque nadie haya
    // abierto la caja hoy.
    if (metodo === 'efectivo') asegurarJornada(entrega.slice(0, 10))
    return fila
  })

  let impresion = sinImprimir(imprimir)
  if (debeImprimir(imprimir, settings)) {
    impresion = await imprimirReciboLavado({ settings, lavado: entregado })
    if (impresion.ok) repo.marcarLavadoImpreso(entregado.id, true)
  }

  return { lavado: repo.obtenerLavado(entregado.id), impresion }
}
