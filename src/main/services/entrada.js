import { enTransaccion } from '../db/index.js'
import { getSettings } from '../db/settingsRepo.js'
import * as vehiculos from '../db/vehiclesRepo.js'
import * as transacciones from '../db/transactionsRepo.js'
import * as cajaRepo from '../db/cajaRepo.js'
import { normalizarMetodoPago } from './caja.js'
import { imprimirRecibo, imprimirTiquete } from './printer.js'
import { ahoraSql } from './tiempo.js'

/** El cobro de una mensualidad tal como lo pide el recibo. */
export function cobroMensualidad(transaccion) {
  return {
    minutos: 0,
    montoBase: transaccion.monto_base,
    recargo: 0,
    total: transaccion.monto,
    tipoTarifa: 'mensualidad',
    detalle: 'Mensualidad'
  }
}

/**
 * Registra la entrada de una moto.
 *
 * Las tarifas por tiempo se cobran a la salida: la entrada sólo crea el
 * ingreso e imprime el tiquete con el código de barras de la placa.
 *
 * La mensualidad se paga al entrar. El ingreso y la venta se guardan en una
 * sola operación atómica — o quedan los dos o ninguno — y el comprobante de pago
 * se imprime siempre, aunque la impresión automática esté apagada. Cada entrada
 * con mensualidad cobra la tarifa completa: la moto se queda el mes adentro.
 *
 * Como en la salida, la impresión ocurre después y nunca revierte lo guardado.
 *
 * @returns {Promise<{vehicle:object, transaccion:object|null, impresion:object}>}
 */
export async function registrarEntrada(datos = {}) {
  const settings = getSettings()

  if (datos.tipo_tarifa !== 'mensualidad') {
    const vehicle = vehiculos.crearEntrada(datos)
    let impresion = { ok: false, motivo: 'Impresión automática desactivada' }
    if (settings.imprimir_automatico) {
      impresion = await imprimirTiquete({ settings, vehicle })
    }
    return { vehicle, transaccion: null, impresion }
  }

  const metodo = normalizarMetodoPago(datos.metodoPago)
  const entrada = datos.hora_entrada || ahoraSql()
  const valor = Math.max(0, Math.round(Number(settings.tarifa_mensualidad) || 0))

  const { vehicle, transaccion } = enTransaccion(() => {
    const creado = vehiculos.crearEntrada({ ...datos, hora_entrada: entrada })
    const venta = transacciones.registrarTransaccion({
      vehicle_id: creado.id,
      placa: creado.placa,
      monto_base: valor,
      recargo: 0,
      minutos: 0,
      tipo_tarifa: 'mensualidad',
      tipo: 'normal',
      metodo_pago: metodo,
      fecha: entrada
    })

    if (metodo === 'efectivo') {
      cajaRepo.asegurarDia(entrada.slice(0, 10), settings.caja_base_predeterminada)
    }

    return { vehicle: creado, transaccion: venta }
  })

  const impresion = await imprimirRecibo({
    settings,
    vehicle,
    transaccion,
    cobro: cobroMensualidad(transaccion)
  })
  if (impresion.ok) transacciones.marcarImpreso(transaccion.id, true)

  return { vehicle, transaccion, impresion }
}
