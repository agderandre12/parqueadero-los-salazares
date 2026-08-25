import { enTransaccion } from '../db/index.js'
import { getSettings } from '../db/settingsRepo.js'
import * as vehiculos from '../db/vehiclesRepo.js'
import * as transacciones from '../db/transactionsRepo.js'
import * as cajaRepo from '../db/cajaRepo.js'
import { calcularCobro } from './pricing.js'
import { normalizarMetodoPago } from './caja.js'
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
 * `metodoPago` es obligatorio ('efectivo' | 'transferencia'): de él depende si
 * el cobro entra o no al saldo físico de la caja registradora.
 *
 * El cierre en base de datos es atómico. La impresión ocurre después y nunca
 * revierte el cobro: si la impresora falla, la salida ya quedó registrada y el
 * resultado lo informa en `impresion`.
 */
export async function liquidar({ vehicleId, placa, ticketPerdido = false, metodoPago }) {
  const settings = getSettings()
  const metodo = normalizarMetodoPago(metodoPago)

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
      metodo_pago: metodo,
      fecha: salida
    })

    /*
     * Si es efectivo, el dinero acaba de entrar al cajón: la jornada tiene que
     * existir aunque nadie haya abierto la caja hoy. El saldo se deriva de las
     * transacciones, así que basta con garantizar la fila y su base.
     */
    if (metodo === 'efectivo') {
      cajaRepo.asegurarDia(salida.slice(0, 10), settings.caja_base_predeterminada)
    }

    return { vehicle: actualizado, transaccion: registro }
  })

  let impresion = { ok: false, motivo: 'Impresión automática desactivada' }
  if (settings.imprimir_automatico) {
    impresion = await imprimirRecibo({ settings, vehicle: finalizado, cobro, transaccion })
    if (impresion.ok) transacciones.marcarImpreso(transaccion.id, true)
  }

  return { vehicle: finalizado, transaccion, cobro, impresion }
}
