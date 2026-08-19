import { ipcMain } from 'electron'
import { getSettings, updateSettings } from '../db/settingsRepo.js'
import * as vehiculos from '../db/vehiclesRepo.js'
import * as transacciones from '../db/transactionsRepo.js'
import { cotizar, liquidar } from '../services/liquidacion.js'
import {
  imprimirRecibo,
  imprimirTiquete,
  imprimirPrueba,
  estadoImpresora
} from '../services/printer.js'

/** Envuelve un handler para que el renderer reciba siempre {ok, data|error}. */
const manejar = (canal, fn) => {
  ipcMain.handle(canal, async (_evento, ...args) => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (error) {
      console.error(`[IPC ${canal}]`, error)
      return { ok: false, error: error.message || 'Error desconocido' }
    }
  })
}

export function registrarHandlers() {
  // ---------------- Configuración ----------------
  manejar('settings:get', () => getSettings())
  manejar('settings:update', (patch) => updateSettings(patch))

  // ---------------- Dashboard --------------------
  manejar('dashboard:resumen', () => ({
    stats: vehiculos.estadisticasHoy(),
    ...vehiculos.mapaCeldas(),
    ultimos: vehiculos.ultimosIngresos(7),
    settings: getSettings()
  }))

  // ---------------- Vehículos --------------------
  // Al registrar la entrada se imprime el tiquete con el código de barras que
  // el escáner leerá en la salida. Si la impresora falla, la entrada queda
  // registrada igual y el resultado lo informa en `impresion`.
  manejar('vehicles:crear', async (datos) => {
    const vehicle = vehiculos.crearEntrada(datos)
    const settings = getSettings()

    let impresion = { ok: false, motivo: 'Impresión automática desactivada' }
    if (settings.imprimir_automatico) {
      impresion = await imprimirTiquete({ settings, vehicle })
    }
    return { vehicle, impresion }
  })

  manejar('vehicles:activos', () => vehiculos.listarActivos())
  manejar('vehicles:ultimos', (limite = 7) => vehiculos.ultimosIngresos(limite))
  manejar('vehicles:buscar', (texto) => vehiculos.buscarActivosSimilares(texto))
  manejar('vehicles:celdaLibre', () => vehiculos.primeraCeldaLibre())
  manejar('vehicles:historial', (filtros) => vehiculos.historial(filtros))

  /** Ficha completa de una placa para la vista de Vehículos. */
  manejar('vehicles:ficha', (placa) => {
    const activo = vehiculos.buscarActivoPorPlaca(placa)
    const resumen = vehiculos.resumenPlaca(placa)
    const historialPlaca = vehiculos.historial({ texto: placa, limite: 20 })
    const ultimoRegistro = activo || historialPlaca[0] || null

    return {
      vehicle: ultimoRegistro,
      activo: Boolean(activo),
      resumen,
      visitas: historialPlaca,
      ultimaTransaccion: ultimoRegistro
        ? transacciones.ultimaDeVehiculo(ultimoRegistro.id)
        : null
    }
  })

  // Consulta el valor a cobrar (modal de liquidación y de ticket perdido)
  manejar('vehicles:cotizar', (params) => cotizar(params))

  // Cierra la salida, cobra e intenta imprimir
  manejar('vehicles:liquidar', (params) => liquidar(params))

  // ---------------- Transacciones ----------------
  manejar('transactions:hoy', (fecha = null) => transacciones.transaccionesDelDia(fecha))
  manejar('transactions:ultimas', (limite = 20) => transacciones.ultimasTransacciones(limite))

  // ---------------- Impresora --------------------
  manejar('printer:estado', () => estadoImpresora(getSettings()))
  manejar('printer:prueba', () => imprimirPrueba(getSettings()))

  manejar('printer:tiquete', (vehicleId) => {
    const vehicle = vehiculos.obtenerPorId(vehicleId)
    if (!vehicle) throw new Error('Vehículo no encontrado')
    return imprimirTiquete({ settings: getSettings(), vehicle })
  })

  manejar('printer:reimprimir', async (transaccionId) => {
    const transaccion = transacciones.obtenerPorId(transaccionId)
    if (!transaccion) throw new Error('Transacción no encontrada')

    const vehicle = vehiculos.obtenerPorId(transaccion.vehicle_id)
    const cobro = {
      minutos: transaccion.minutos,
      montoBase: transaccion.monto_base,
      recargo: transaccion.recargo,
      total: transaccion.monto,
      tipoTarifa: transaccion.tipo_tarifa,
      detalle: 'Servicio de parqueadero'
    }
    // `copia` imprime el sello ** COPIA **: el original ya salió una vez y el
    // recibo no debe poder usarse dos veces como comprobante.
    return imprimirRecibo({ settings: getSettings(), vehicle, cobro, transaccion, copia: true })
  })
}
