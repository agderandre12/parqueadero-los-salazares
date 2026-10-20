/**
 * Impresión térmica — Jaltech POS 58mm (JAL58M).
 *
 * La JAL58M habla ESC/POS estándar, así que se maneja con el perfil EPSON.
 * A 58 mm caben 32 caracteres por línea con la fuente A; el ancho real se lee
 * de la configuración por si se cambia a una de 80 mm (48 caracteres).
 *
 * La conexión es el nombre de la impresora en Windows (con o sin el prefijo
 * `printer:`), que se imprime por `colaWindows.js`, o una dirección de red
 * `tcp://IP`, que maneja la librería.
 *
 * Ninguna función `imprimir*` lanza: un fallo de impresora nunca puede tumbar
 * un cobro que ya se registró en la base de datos. Todo devuelve { ok, motivo }.
 * El armado del papel (`componer*`) está separado del envío para poder
 * probarlo y previsualizarlo sin impresora.
 */

import { formatearPermanencia } from './pricing.js'
import { interfazWindows, nombreCola } from './colaWindows.js'

export { listarImpresoras } from './colaWindows.js'

const ETIQUETA_TARIFA = {
  hora: 'Por hora',
  amanecida: 'Amanecida',
  mensualidad: 'Mensualidad',
  personalizada: 'Personalizada'
}

// Sin tildes: el recibo debe leerse igual aunque la térmica pierda el juego de
// caracteres, y esta línea es la que se coteja contra el cierre de caja.
const ETIQUETA_METODO = {
  efectivo: 'EFECTIVO',
  transferencia: 'TRANSFERENCIA'
}

// Con la fuente A cada carácter mide 12 puntos: 32 caracteres son los 384
// puntos imprimibles de una térmica de 58 mm a 203 ppp (8 puntos por mm).
const PUNTOS_POR_CARACTER = 12

// La fuente B (letra menuda de las políticas) mide 9 x 17 puntos: 42
// caracteres en 58 mm. El interlineado de ESC/POS no se achica solo con la
// letra, así que se baja a mano mientras se imprime en fuente B.
const PUNTOS_POR_CARACTER_B = 9
const INTERLINEADO_B = 22

// 140 puntos ≈ 17 mm de barras: perdona el ángulo con que se pasa el lector.
const ALTO_CODIGO = 140

// Code 128 pide 10 módulos en blanco a cada lado para leerse sin fallas.
const MARGEN_CODIGO = 10

const pesos = (valor) =>
  '$' + Number(valor || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })

const recibo = (id) => String(id).padStart(6, '0')

const anchoLinea = (settings) => Number(settings.impresora_ancho) || 32

const anchoLetraMenuda = (settings) =>
  Math.floor((anchoLinea(settings) * PUNTOS_POR_CARACTER) / PUNTOS_POR_CARACTER_B)

const esRed = (conexion) => /^tcp:\/\//i.test(String(conexion || '').trim())

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

/** Parte un texto en líneas de `ancho` caracteres sin cortar palabras. */
export function plegar(texto, ancho) {
  const lineas = []
  for (const parrafo of String(texto || '').split('\n')) {
    let linea = ''
    for (const palabra of parrafo.split(/\s+/).filter(Boolean)) {
      if (!linea) linea = palabra
      else if (linea.length + 1 + palabra.length <= ancho) linea += ` ${palabra}`
      else {
        lineas.push(linea)
        linea = palabra
      }
      // Una sola palabra más larga que la línea se parte a la fuerza.
      while (linea.length > ancho) {
        lineas.push(linea.slice(0, ancho))
        linea = linea.slice(ancho)
      }
    }
    if (linea) lineas.push(linea)
  }
  return lineas
}

/** Políticas listas para imprimir, con el recargo vigente en lugar de {ticket_perdido}. */
export function textoPoliticas(settings) {
  return String(settings.politicas_tiquete || '').replaceAll(
    '{ticket_perdido}',
    pesos(settings.cargo_ticket_perdido ?? 2000)
  )
}

/** Construye la instancia de impresora a partir de la configuración guardada. */
async function abrirImpresora(settings, interfaz) {
  const { ThermalPrinter, PrinterTypes, CharacterSet } = await import('node-thermal-printer')
  const conexion = String(settings.impresora_interface || '').trim()

  return new ThermalPrinter({
    type: settings.impresora_tipo === 'STAR' ? PrinterTypes.STAR : PrinterTypes.EPSON,
    interface: interfaz ?? (esRed(conexion) ? conexion : interfazWindows(conexion)),
    width: anchoLinea(settings),
    // Sin esto las tildes y la ñ salen como basura en la térmica.
    characterSet: CharacterSet.PC858_EURO,
    // Último recurso si la térmica no trae la página PC858: quita las tildes.
    removeSpecialCharacters: Boolean(Number(settings.impresora_sin_tildes)),
    options: { timeout: 5000 }
  })
}

/** 'Etiqueta:        valor' a todo el ancho; el valor se recorta si no cabe. */
function fila(printer, ancho, etiqueta, valor) {
  printer.leftRight(etiqueta, String(valor).slice(0, Math.max(1, ancho - etiqueta.length - 1)))
}

/** Rótulo centrado entre caracteres de relleno: '***** POLÍTICAS *****'. */
function rotulo(texto, ancho, relleno) {
  const sobra = Math.max(0, ancho - texto.length)
  const izquierda = Math.floor(sobra / 2)
  return relleno.repeat(izquierda) + texto + relleno.repeat(sobra - izquierda)
}

/**
 * Nombre, dirección, horario y teléfono del negocio. Lo comparten el tiquete,
 * el recibo y la página de prueba, para que los tres papeles se vean iguales.
 */
function encabezado(printer, settings, { nit = false } = {}) {
  const ancho = anchoLinea(settings)
  const nombre = (settings.nombre_parqueadero || 'Parqueadero Los Salazares').toLocaleUpperCase('es-CO')

  printer.alignCenter()
  printer.bold(true)
  printer.setTextSize(1, 1)
  // A doble ancho cabe la mitad de caracteres, y la librería siempre parte al
  // ancho normal: se parte a mano para no cortar palabras.
  for (const linea of plegar(nombre, Math.floor(ancho / 2))) printer.println(linea)
  printer.setTextSize(0, 0)
  printer.bold(false)

  if (nit && settings.nit) printer.println(`NIT ${settings.nit}`)
  for (const linea of plegar(settings.direccion, ancho)) printer.println(linea)
  for (const linea of plegar(settings.horario, ancho)) printer.println(linea)
  if (settings.telefono) {
    printer.bold(true)
    printer.println(`Tel. ${settings.telefono}`)
    printer.bold(false)
  }

  printer.drawLine()
}

/**
 * Código de barras con el módulo más ancho que deje la zona en blanco a cada
 * lado. Code 128 B (el que arma la librería) mide 35 + 11 × caracteres módulos:
 * en 58 mm una placa de 6 caracteres sale con módulo de 3 puntos (~38 mm de
 * barras) y una de 7, con 2. Sin texto debajo: la placa ya va grande encima.
 */
function codigoDeBarras(printer, settings, codigo) {
  const datos = String(codigo || '').replace(/[^\x20-\x7E]/g, '')
  const modulos = 35 + 11 * datos.length + 2 * MARGEN_CODIGO
  const puntos = anchoLinea(settings) * PUNTOS_POR_CARACTER
  const modulo = [4, 3, 2].find((m) => modulos * m <= puntos) ?? 2

  printer.alignCenter()
  printer.printBarcode(datos, 73, { hriPos: 0, hriFont: 0, width: modulo, height: ALTO_CODIGO })
  printer.newLine()
}

/**
 * Políticas al pie del tiquete, en letra menuda como en cualquier tiquete: en
 * fuente A ocuparían el doble de papel. La etiqueta de cada párrafo va en
 * negrilla. Los renglones se envían con `add` porque `print` los volvería a
 * partir al ancho de la fuente A.
 */
function politicas(printer, settings) {
  const parrafos = textoPoliticas(settings)
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parrafos.length === 0) return

  printer.alignCenter()
  printer.bold(true)
  printer.println(rotulo(' POLÍTICAS ', anchoLinea(settings), '*'))
  printer.bold(false)

  printer.alignLeft()
  printer.setTypeFontB()
  printer.setLineSpacing(INTERLINEADO_B)

  for (const parrafo of parrafos) {
    const corte = parrafo.indexOf(':') + 1
    plegar(parrafo, anchoLetraMenuda(settings)).forEach((linea, i) => {
      if (i === 0 && corte > 0 && corte <= linea.length) {
        printer.bold(true)
        printer.add(linea.slice(0, corte))
        printer.bold(false)
        printer.add(linea.slice(corte))
      } else {
        printer.add(linea)
      }
      printer.newLine()
    })
  }

  printer.resetLineSpacing()
  printer.setTypeFontA()
  printer.drawLine()
}

/**
 * Avanza lo justo para que el último renglón pase la barra de corte (unos
 * 17 mm) y corta. Por defecto la librería avanza el doble: ~3,4 cm en blanco
 * por papel.
 */
function cortar(printer) {
  printer.cut({ verticalTabAmount: 1 })
}

/**
 * Tiquete de entrada. El código de barras es la placa: es lo que identifica al
 * vehículo y funciona aunque el cliente pierda el papel y la dicte de memoria.
 */
export function componerTiquete(printer, { settings, vehicle }) {
  const ancho = anchoLinea(settings)

  encabezado(printer, settings)

  printer.alignCenter()
  printer.bold(true)
  printer.println('TIQUETE DE ENTRADA')
  printer.setTextSize(2, 2)
  printer.println(vehicle.placa)
  printer.setTextSize(0, 0)
  printer.bold(false)

  codigoDeBarras(printer, settings, vehicle.placa)

  printer.alignLeft()
  printer.bold(true)
  fila(printer, ancho, 'Entrada:', fechaLegible(vehicle.hora_entrada))
  printer.bold(false)
  if (vehicle.celda) fila(printer, ancho, 'Celda:', String(vehicle.celda).padStart(2, '0'))
  fila(printer, ancho, 'Tarifa:', ETIQUETA_TARIFA[vehicle.tipo_tarifa] || vehicle.tipo_tarifa)
  fila(printer, ancho, 'Vehículo:', ['Moto', vehicle.marca, vehicle.color].filter(Boolean).join(' '))
  if (vehicle.casco) fila(printer, ancho, 'Casco:', 'En custodia')
  printer.drawLine()

  politicas(printer, settings)

  printer.alignCenter()
  printer.bold(true)
  printer.println('Presente este tiquete')
  printer.println('para retirar su vehículo')
  printer.bold(false)

  cortar(printer)
}

/**
 * Recibo de una liquidación, con la hora de salida y el desglose del cobro; o
 * comprobante de pago de una mensualidad, que se cobra al entrar.
 */
export function componerRecibo(printer, { settings, vehicle, cobro, transaccion, copia = false }) {
  const ancho = anchoLinea(settings)
  const tipoTarifa = transaccion.tipo_tarifa || cobro.tipoTarifa
  const esMensualidad = tipoTarifa === 'mensualidad'

  encabezado(printer, settings, { nit: true })

  printer.alignCenter()
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
  // La mensualidad se paga al entrar: su comprobante no tiene salida,
  // permanencia ni método de pago.
  printer.alignLeft()
  if (esMensualidad) {
    printer.bold(true)
    fila(printer, ancho, 'Fecha:', fechaLegible(transaccion.fecha || vehicle.hora_entrada))
    printer.bold(false)
  } else {
    fila(printer, ancho, 'Entrada:', fechaLegible(vehicle.hora_entrada))
    printer.bold(true)
    fila(printer, ancho, 'Salida:', fechaLegible(vehicle.hora_salida || transaccion.fecha))
    printer.bold(false)
    fila(printer, ancho, 'Permanencia:', formatearPermanencia(cobro.minutos))
  }
  fila(printer, ancho, 'Tarifa:', ETIQUETA_TARIFA[tipoTarifa] || tipoTarifa)
  if (vehicle.celda) fila(printer, ancho, 'Celda:', String(vehicle.celda).padStart(2, '0'))
  if (vehicle.marca || vehicle.color) {
    fila(printer, ancho, 'Vehículo:', [vehicle.marca, vehicle.color].filter(Boolean).join(' '))
  }
  if (vehicle.casco) fila(printer, ancho, 'Casco:', 'En custodia')

  printer.drawLine()

  // ---- Cobro ----
  printer.leftRight(esMensualidad ? 'Mensualidad' : cobro.detalle || 'Servicio', pesos(cobro.montoBase))
  if (cobro.recargo > 0) {
    printer.leftRight('Recargo tiquete perdido', pesos(cobro.recargo))
  }

  printer.drawLine()
  printer.bold(true)
  // A doble ancho la línea tiene la mitad de caracteres: `leftRight` no lo
  // sabe y partiría el total en dos renglones.
  const total = pesos(cobro.total)
  printer.setTextSize(1, 1)
  printer.println('TOTAL'.padEnd(Math.max(6, Math.floor(ancho / 2) - total.length)) + total)
  printer.setTextSize(0, 0)
  if (!esMensualidad) {
    printer.leftRight(
      'Pago:',
      ETIQUETA_METODO[transaccion.metodo_pago] || String(transaccion.metodo_pago || '').toUpperCase()
    )
  }
  printer.bold(false)

  // ---- Pie ----
  printer.newLine()
  printer.alignCenter()
  for (const linea of plegar(settings.mensaje_recibo, ancho)) printer.println(linea)
  printer.println('-'.repeat(Math.min(ancho, 32)))
  printer.println('Conserve este recibo')
  printer.println('para reclamar su vehículo')

  cortar(printer)
}

/**
 * Página de prueba para la instalación: tildes, ancho de línea y un código de
 * barras del mismo tamaño que el de un tiquete, para probar el lector.
 */
export function componerPrueba(printer, settings) {
  const ancho = anchoLinea(settings)

  encabezado(printer, settings)

  printer.alignCenter()
  printer.bold(true)
  printer.println('PRUEBA DE IMPRESIÓN')
  printer.bold(false)

  printer.alignLeft()
  printer.println('Tildes: áéíóú ÁÉÍÓÚ ñÑ ü ¿? ¡!')
  // Las reglas deben caber exactas en un renglón; si saltan de línea, el
  // ancho configurado (o la fuente B de las políticas) no es el de la térmica.
  printer.println('1234567890'.repeat(5).slice(0, ancho))
  printer.println('Letra menuda de las políticas:')
  printer.setTypeFontB()
  printer.add('1234567890'.repeat(7).slice(0, anchoLetraMenuda(settings)))
  printer.newLine()
  printer.setTypeFontA()
  fila(printer, ancho, 'Ancho:', `${ancho} caracteres`)
  fila(printer, ancho, 'Perfil:', settings.impresora_tipo || 'EPSON')
  printer.drawLine()

  printer.alignCenter()
  for (const linea of plegar('Escanee este código: la aplicación debe avisar "PRUEBA no está adentro".', ancho)) {
    printer.println(linea)
  }
  codigoDeBarras(printer, settings, 'PRUEBA')

  cortar(printer)
}

/**
 * Bytes ESC/POS de un papel, sin enviarlos a ninguna impresora: los usan la
 * prueba de integración y la vista previa.
 */
export async function generarBytes(settings, componer) {
  const enMemoria = { execute: async () => {}, isPrinterConnected: async () => true }
  const printer = await abrirImpresora(settings, enMemoria)
  componer(printer)
  return printer.getBuffer()
}

/** Arma el papel y lo envía. Nunca lanza. */
async function enviar(settings, componer) {
  if (!String(settings?.impresora_interface || '').trim()) {
    return { ok: false, motivo: 'Impresora no configurada' }
  }

  try {
    const printer = await abrirImpresora(settings)
    componer(printer)
    await printer.execute()
    return { ok: true }
  } catch (error) {
    return { ok: false, motivo: error.message || 'No se pudo imprimir' }
  }
}

export async function estadoImpresora(settings) {
  const conexion = String(settings?.impresora_interface || '').trim()
  if (!conexion) return { conectada: false, motivo: 'Impresora no configurada' }

  try {
    if (esRed(conexion)) {
      const printer = await abrirImpresora(settings)
      const conectada = await printer.isPrinterConnected()
      return { conectada, motivo: conectada ? null : 'Sin respuesta de la impresora' }
    }

    // En Windows sólo se puede saber si la impresora está instalada: si está
    // apagada, el trabajo queda en la cola y sale al encenderla.
    const instalada = await interfazWindows(conexion).isPrinterConnected()
    return {
      conectada: instalada,
      motivo: instalada ? null : `No hay una impresora "${nombreCola(conexion)}" instalada en Windows`
    }
  } catch (error) {
    return { conectada: false, motivo: error.message || 'Sin respuesta de la impresora' }
  }
}

/**
 * Imprime el recibo de una liquidación.
 * @param {{settings:object, vehicle:object, cobro:object, transaccion:object,
 *          copia?:boolean}} params
 * @returns {Promise<{ok:boolean, motivo?:string}>}
 */
export function imprimirRecibo(params) {
  return enviar(params.settings, (printer) => componerRecibo(printer, params))
}

/** Imprime el tiquete de entrada con el código de barras de la placa. */
export function imprimirTiquete(params) {
  return enviar(params.settings, (printer) => componerTiquete(printer, params))
}

/** Prueba de impresión desde la vista de Configuración. */
export function imprimirPrueba(settings) {
  return enviar(settings, (printer) => componerPrueba(printer, settings))
}
