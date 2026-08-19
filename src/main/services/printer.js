/**
 * Impresión térmica — Jaltech POS 58mm (JAL58M).
 *
 * La JAL58M habla ESC/POS estándar, así que se maneja con el perfil EPSON.
 * A 58 mm caben 32 caracteres por línea con la fuente A; el ancho real se lee
 * de la configuración por si se cambia a una de 80 mm (48 caracteres).
 *
 * Ninguna función de este módulo lanza: un fallo de impresora nunca puede
 * tumbar un cobro que ya se registró en la base de datos. Todo devuelve
 * { ok, motivo }.
 */

import { formatearPermanencia } from './pricing.js'

const ETIQUETA_TARIFA = {
  hora: 'Por hora',
  amanecida: 'Amanecida',
  mensualidad: 'Mensualidad',
  personalizada: 'Personalizada'
}

const pesos = (valor) =>
  '$' + Number(valor || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })

const recibo = (id) => String(id).padStart(6, '0')

/** '18/08/2026 02:35 p. m.' a partir del texto SQL 'YYYY-MM-DD HH:MM:SS'. */
function fechaLegible(texto) {
  if (!texto) return '--'
  const [f, h = '00:00:00'] = String(texto).trim().split(/[ T]/)
  const [a, m, d] = f.split('-')
  const [hh, mm] = h.split(':').map(Number)
  const sufijo = hh >= 12 ? 'p. m.' : 'a. m.'
  const h12 = hh % 12 === 0 ? 12 : hh % 12
  return `${d}/${m}/${a} ${String(h12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${sufijo}`
}

/** Construye la instancia de impresora a partir de la configuración guardada. */
async function abrirImpresora(settings) {
  const { ThermalPrinter, PrinterTypes, CharacterSet } = await import('node-thermal-printer')

  return new ThermalPrinter({
    type: settings.impresora_tipo === 'STAR' ? PrinterTypes.STAR : PrinterTypes.EPSON,
    interface: settings.impresora_interface,
    width: Number(settings.impresora_ancho) || 32,
    // Sin esto las tildes y la ñ salen como basura en la térmica.
    characterSet: CharacterSet.PC858_EURO,
    removeSpecialCharacters: false,
    options: { timeout: 5000 }
  })
}

export async function estadoImpresora(settings) {
  if (!settings?.impresora_interface) {
    return { conectada: false, motivo: 'Impresora no configurada' }
  }
  try {
    const printer = await abrirImpresora(settings)
    const conectada = await printer.isPrinterConnected()
    return { conectada, motivo: conectada ? null : 'Sin respuesta de la impresora' }
  } catch (error) {
    return { conectada: false, motivo: error.message }
  }
}

/**
 * Imprime el recibo de una liquidación.
 * @param {{settings:object, vehicle:object, cobro:object, transaccion:object,
 *          copia?:boolean}} params
 * @returns {Promise<{ok:boolean, motivo?:string}>}
 */
export async function imprimirRecibo({ settings, vehicle, cobro, transaccion, copia = false }) {
  if (!settings?.impresora_interface) {
    return { ok: false, motivo: 'Impresora no configurada' }
  }

  try {
    const printer = await abrirImpresora(settings)
    const ancho = Number(settings.impresora_ancho) || 32

    // ---- Encabezado del negocio ----
    printer.alignCenter()
    printer.bold(true)
    printer.setTextSize(1, 1)
    printer.println(settings.nombre_parqueadero || 'Parqueadero Los Salazares')
    printer.setTextSize(0, 0)
    printer.bold(false)

    if (settings.nit) printer.println(`NIT ${settings.nit}`)
    if (settings.direccion) printer.println(settings.direccion)
    if (settings.telefono) printer.println(`Tel. ${settings.telefono}`)

    printer.drawLine()

    if (copia) {
      printer.bold(true)
      printer.println('** COPIA **')
      printer.bold(false)
    }

    // ---- Placa, el dato que el cliente busca ----
    printer.println(`RECIBO No. ${recibo(transaccion.id)}`)
    printer.setTextSize(1, 1)
    printer.bold(true)
    printer.println(vehicle.placa)
    printer.bold(false)
    printer.setTextSize(0, 0)
    printer.drawLine()

    // ---- Detalle del servicio ----
    printer.alignLeft()
    printer.leftRight('Entrada:', fechaLegible(vehicle.hora_entrada))
    printer.leftRight('Salida:', fechaLegible(vehicle.hora_salida || transaccion.fecha))
    printer.leftRight('Permanencia:', formatearPermanencia(cobro.minutos))
    printer.leftRight('Tarifa:', ETIQUETA_TARIFA[cobro.tipoTarifa] || cobro.tipoTarifa)
    if (vehicle.celda) printer.leftRight('Celda:', String(vehicle.celda).padStart(2, '0'))
    if (vehicle.marca || vehicle.color) {
      printer.leftRight('Vehiculo:', [vehicle.marca, vehicle.color].filter(Boolean).join(' '))
    }
    if (vehicle.casco) printer.println('Dejo casco en custodia')

    printer.drawLine()

    // ---- Cobro ----
    printer.leftRight(cobro.detalle || 'Servicio', pesos(cobro.montoBase))
    if (cobro.recargo > 0) {
      printer.leftRight('Recargo ticket perdido', pesos(cobro.recargo))
    }

    printer.drawLine()
    printer.bold(true)
    printer.setTextSize(1, 1)
    printer.leftRight('TOTAL', pesos(cobro.total))
    printer.setTextSize(0, 0)
    printer.bold(false)

    // ---- Pie ----
    printer.newLine()
    printer.alignCenter()
    if (settings.mensaje_recibo) printer.println(settings.mensaje_recibo)
    printer.println('-'.repeat(Math.min(ancho, 32)))
    printer.println('Conserve este recibo')
    printer.println('para reclamar su vehiculo')

    printer.newLine()
    printer.cut()

    await printer.execute()
    return { ok: true }
  } catch (error) {
    return { ok: false, motivo: error.message || 'No se pudo imprimir' }
  }
}

/**
 * Imprime el tiquete de entrada, con el código de barras que después lee el
 * escáner en la salida. El código es la placa: es lo que identifica al vehículo
 * y funciona aunque el cliente pierda el papel y dicte la placa de memoria.
 */
export async function imprimirTiquete({ settings, vehicle }) {
  if (!settings?.impresora_interface) {
    return { ok: false, motivo: 'Impresora no configurada' }
  }

  try {
    const printer = await abrirImpresora(settings)

    printer.alignCenter()
    printer.bold(true)
    printer.println(settings.nombre_parqueadero || 'Parqueadero Los Salazares')
    printer.bold(false)
    if (settings.telefono) printer.println(`Tel. ${settings.telefono}`)
    printer.drawLine()

    printer.println('TIQUETE DE ENTRADA')
    printer.setTextSize(1, 1)
    printer.bold(true)
    printer.println(vehicle.placa)
    printer.bold(false)
    printer.setTextSize(0, 0)

    printer.newLine()
    // CODE128 lo lee el JAL PLUS 01 sin configuración extra.
    printer.printBarcode(vehicle.placa, 73, {
      hriPos: 2,
      hriFont: 0,
      width: 2,
      height: 80
    })
    printer.newLine()

    printer.alignLeft()
    printer.leftRight('Entrada:', fechaLegible(vehicle.hora_entrada))
    if (vehicle.celda) printer.leftRight('Celda:', String(vehicle.celda).padStart(2, '0'))
    printer.leftRight('Tarifa:', ETIQUETA_TARIFA[vehicle.tipo_tarifa] || vehicle.tipo_tarifa)
    if (vehicle.casco) printer.println('Dejo casco en custodia')

    printer.drawLine()
    printer.alignCenter()
    printer.println('Presente este tiquete')
    printer.println('para retirar su vehiculo')

    printer.newLine()
    printer.cut()

    await printer.execute()
    return { ok: true }
  } catch (error) {
    return { ok: false, motivo: error.message || 'No se pudo imprimir' }
  }
}

/** Prueba de impresión desde la vista de Configuración. */
export async function imprimirPrueba(settings) {
  if (!settings?.impresora_interface) {
    return { ok: false, motivo: 'Impresora no configurada' }
  }
  try {
    const printer = await abrirImpresora(settings)
    printer.alignCenter()
    printer.bold(true)
    printer.println(settings.nombre_parqueadero || 'Parqueadero Los Salazares')
    printer.bold(false)
    printer.drawLine()
    printer.println('PRUEBA DE IMPRESION')
    printer.println('Acentos: áéíóú ñ Ñ')
    printer.leftRight('Ancho:', `${settings.impresora_ancho} caracteres`)
    printer.leftRight('Perfil:', settings.impresora_tipo)
    printer.newLine()
    printer.cut()
    await printer.execute()
    return { ok: true }
  } catch (error) {
    return { ok: false, motivo: error.message || 'No se pudo imprimir' }
  }
}
