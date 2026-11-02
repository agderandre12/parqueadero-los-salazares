import { ipcMain } from 'electron'
import { getSettings } from '../db/settingsRepo.js'
import * as vehiculos from '../db/vehiclesRepo.js'
import * as transacciones from '../db/transactionsRepo.js'
import * as lavaderoRepo from '../db/lavaderoRepo.js'
import { cotizar, liquidar } from '../services/liquidacion.js'
import { registrarEntrada } from '../services/entrada.js'
import { actualizarConfiguracion } from '../services/configuracion.js'
import { simularTarifaHora } from '../services/pricing.js'
import * as lavadero from '../services/lavadero.js'
import {
  resumenCaja,
  abrirCaja,
  cerrarCaja,
  reabrirCaja,
  historialCierres,
  metricasVentas
} from '../services/caja.js'
import {
  imprimirRecibo,
  imprimirTiquete,
  imprimirTiqueteLavado,
  imprimirReciboLavado,
  imprimirPrueba,
  estadoImpresora,
  listarImpresoras
} from '../services/printer.js'
import { avisarCierre, buscarChat, probarTelegram } from '../services/telegram.js'
import { hoySql } from '../services/tiempo.js'

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
  manejar('settings:update', (patch) => actualizarConfiguracion(patch))

  // Lo que pagaría una moto por hora con los precios que están en pantalla,
  // antes de guardarlos. Lanza con el mismo mensaje que al guardar.
  manejar('precios:simular', (borrador = {}) => simularTarifaHora({ ...getSettings(), ...borrador }))

  // ---------------- Dashboard --------------------
  manejar('dashboard:resumen', () => ({
    stats: vehiculos.estadisticasDelDia(),
    ...vehiculos.mapaCeldas(),
    ultimos: vehiculos.ultimosIngresos(7),
    settings: getSettings()
  }))

  // ---------------- Vehículos --------------------
  // Tiquete con código de barras, o cobro y comprobante si es mensualidad. Si
  // la impresora falla, lo guardado queda igual y `impresion` lo informa.
  manejar('vehicles:crear', (datos) => registrarEntrada(datos))

  manejar('vehicles:activos', () => vehiculos.listarActivos())
  manejar('vehicles:ultimos', (limite = 7) => vehiculos.ultimosIngresos(limite))
  manejar('vehicles:buscar', (texto) => vehiculos.buscarActivosSimilares(texto))
  manejar('vehicles:celdaLibre', () => vehiculos.primeraCeldaLibre())
  manejar('vehicles:historial', (filtros) => vehiculos.historial(filtros))

  /** Ficha completa de una placa para la vista de Vehículos. */
  manejar('vehicles:ficha', (placa) => {
    const activo = vehiculos.buscarActivoPorPlaca(placa)
    const resumen = vehiculos.resumenPlaca(placa)
    const historialPlaca = vehiculos.historial({ placa, limite: 20 })
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

  // Cierra la salida, cobra (con el valor acordado, si lo hay) e imprime según
  // el botón que se usó.
  manejar('vehicles:liquidar', (params) => liquidar(params))

  // ---------------- Lavadero ---------------------
  manejar('lavadero:tipos', (incluirRetirados = false) =>
    lavaderoRepo.listarTipos({ incluirRetirados })
  )
  manejar('lavadero:guardarTipo', (datos) => lavadero.guardarTipo(datos))
  manejar('lavadero:retirarTipo', (id) => lavadero.retirarTipo(id))

  manejar('lavadero:activos', () => lavaderoRepo.listarLavadosActivos())
  manejar('lavadero:buscar', (texto) => lavaderoRepo.buscarLavadosActivos(texto))
  manejar('lavadero:obtener', (id) => lavaderoRepo.obtenerLavado(id) ?? null)
  manejar('lavadero:entregadosHoy', () => lavaderoRepo.lavadosEntregadosDelDia(hoySql()))

  // Sólo guarda; el tiquete se pide aparte (`printer:tiqueteLavado`) si el
  // operario dice que sí.
  manejar('lavadero:ingresar', (datos) => lavadero.ingresarLavado(datos))
  manejar('lavadero:entregar', (params) => lavadero.entregarLavado(params))

  // ---------------- Transacciones ----------------
  manejar('transactions:hoy', (fecha = null) => transacciones.transaccionesDelDia(fecha))
  manejar('transactions:ultimas', (limite = 20) => transacciones.ultimasTransacciones(limite))

  // ---------------- Métricas y caja --------------
  manejar('metricas:ventas', () => metricasVentas())

  manejar('caja:resumen', (fecha) => resumenCaja(fecha || undefined))
  manejar('caja:abrir', (params) => abrirCaja(params))
  // El cierre ya quedó guardado cuando se avisa: si Telegram falla no se deshace
  // nada, `aviso` lo informa y el aviso queda pendiente.
  manejar('caja:cerrar', async (params) => {
    const { fecha } = cerrarCaja(params)
    const aviso = await avisarCierre(fecha)
    return { ...resumenCaja(fecha), aviso }
  })
  manejar('caja:reenviarAviso', async (fecha) => {
    const aviso = await avisarCierre(fecha)
    return { ...resumenCaja(fecha), aviso }
  })
  manejar('caja:reabrir', (fecha) => reabrirCaja(fecha || undefined))
  manejar('caja:cierres', (limite = 14) => historialCierres(limite))

  // ---------------- Telegram ---------------------
  // Con lo que está en pantalla: se prueba antes de guardar.
  manejar('telegram:probar', (datos) => probarTelegram(datos))
  manejar('telegram:buscarChat', (token) => buscarChat(token))

  // ---------------- Impresora --------------------
  manejar('printer:estado', () => estadoImpresora(getSettings()))
  manejar('printer:prueba', () => imprimirPrueba(getSettings()))
  // Impresoras instaladas en Windows, para escoger la térmica sin digitar su nombre.
  manejar('printer:lista', () => listarImpresoras())

  manejar('printer:tiquete', (vehicleId) => {
    const vehicle = vehiculos.obtenerPorId(vehicleId)
    if (!vehicle) throw new Error('Vehículo no encontrado')
    return imprimirTiquete({ settings: getSettings(), vehicle })
  })

  /*
   * `copia` imprime el sello ** COPIA ** cuando el original ya salió una vez:
   * el recibo no debe poder usarse dos veces como comprobante. Si se cobró sin
   * imprimir, el primer papel que sale es el original y queda marcado.
   */
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
    const copia = Boolean(transaccion.impreso)
    const impresion = await imprimirRecibo({ settings: getSettings(), vehicle, cobro, transaccion, copia })
    if (impresion.ok && !copia) transacciones.marcarImpreso(transaccion.id, true)
    return impresion
  })

  manejar('printer:tiqueteLavado', (lavadoId) => {
    const lavado = lavaderoRepo.obtenerLavado(lavadoId)
    if (!lavado) throw new Error('Lavada no encontrada')
    return imprimirTiqueteLavado({ settings: getSettings(), lavado })
  })

  // Mismo criterio que `printer:reimprimir`.
  manejar('printer:reciboLavado', async (lavadoId) => {
    const lavado = lavaderoRepo.obtenerLavado(lavadoId)
    if (!lavado) throw new Error('Lavada no encontrada')
    if (lavado.estado !== 'entregado') throw new Error('La lavada todavía no se ha cobrado')

    const copia = Boolean(lavado.impreso)
    const impresion = await imprimirReciboLavado({ settings: getSettings(), lavado, copia })
    if (impresion.ok && !copia) lavaderoRepo.marcarLavadoImpreso(lavado.id, true)
    return impresion
  })
}
