import { enTransaccion } from '../db/index.js'
import { getSettings } from '../db/settingsRepo.js'
import * as vehiculos from '../db/vehiclesRepo.js'
import * as transacciones from '../db/transactionsRepo.js'
import { calcularCobro } from './pricing.js'
import { imprimirRecibo } from './printer.js'
import { ahoraSql } from './tiempo.js'

/**
 * Cotiza (sin cobrar) el valor a pagar de una placa que está adentro.
 * @throws si la placa no tiene un ingreso activo.
 */
export function cotizar({ placa, ticketPerdido = false }) {
  const vehicle = vehiculos.buscarActivoPorPlaca(placa)
  if (!vehicle) throw new Error(`No hay un vehículo activo con la placa ${placa}`)

  const settings = getSettings()
  return { vehicle, settings, cobro: calcularCobro({ vehicle, settings, ticketPerdido }) }
}

/**
 * Liquida la salida: cierra el vehículo (libera la celda), guarda la
 * transacción y manda a imprimir el recibo.
 *
 * El cierre en base de datos es atómico. La impresión ocurre después y nunca
 * revierte el cobro: si la impresora falla, la salida ya quedó registrada y el
 * resultado lo informa en `impresion`.
 */
export async function liquidar({ vehicleId, placa, ticketPerdido = false }) {
  const settings = getSettings()

  const vehicle = vehicleId
    ? vehiculos.obtenerPorId(vehicleId)
    : vehiculos.buscarActivoPorPlaca(placa)

  if (!vehicle) throw new Error('Vehículo no encontrado')
  if (vehicle.estado !== 'activo') throw new Error(`La placa ${vehicle.placa} ya fue liquidada`)

  const cobro = calcularCobro({ vehicle, settings, ticketPerdido })
  const salida = ahoraSql()

  const { vehicle: finalizado, transaccion } = enTransaccion(() => {
    const actualizado = vehiculos.finalizar(vehicle.id, salida)
    const registro = transacciones.registrarTransaccion({
      vehicle_id: vehicle.id,
      placa: vehicle.placa,
      monto_base: cobro.montoBase,
      recargo: cobro.recargo,
      minutos: cobro.minutos,
      tipo_tarifa: cobro.tipoTarifa,
      tipo: ticketPerdido ? 'ticket_perdido' : 'normal',
      fecha: salida
    })
    return { vehicle: actualizado, transaccion: registro }
  })

  let impresion = { ok: false, motivo: 'Impresión automática desactivada' }
  if (settings.imprimir_automatico) {
    impresion = await imprimirRecibo({ settings, vehicle: finalizado, cobro, transaccion })
    if (impresion.ok) transacciones.marcarImpreso(transaccion.id, true)
  }

  return { vehicle: finalizado, transaccion, cobro, impresion }
}
