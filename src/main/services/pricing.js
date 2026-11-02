import { aTextoSql, desdeTextoSql } from './tiempo.js'

export const CARGO_TICKET_PERDIDO_DEFECTO = 2000

// Más allá de un mes una regla por horas deja de tener sentido: es una mensualidad.
const HORAS_MAXIMAS_TRAMO = 720

/**
 * Calcula el cobro de un vehículo.
 *
 * Reglas:
 *  - 'hora'          : se cobra por hora iniciada, con tope de amanecida por cada
 *                      bloque de 24h (nunca se cobra más que la amanecida del día).
 *                      Si la estadía cae en un tramo de `tramos_hora`, se cobra el
 *                      valor fijo del tramo en lugar de las horas (con el mismo tope).
 *  - 'amanecida'     : tarifa fija por cada bloque de 24h iniciado.
 *  - 'mensualidad'   : $0 al salir: se cobró al entrar (`services/entrada.js`).
 *                      No aplican gracia ni tiquete perdido.
 *  - 'personalizada' : valor fijo pactado, guardado en tarifa_personalizada.
 *  - Antes de `minutos_gracia` no se cobra nada.
 *  - `ticketPerdido` suma el recargo configurado (por defecto $2.000).
 *
 * @returns {{minutos:number, horas:number, dias:number, montoBase:number,
 *            recargo:number, total:number, tipoTarifa:string, detalle:string,
 *            tramo:object|null, tope:boolean}}
 */
export function calcularCobro({ vehicle, settings, ahora = new Date(), ticketPerdido = false }) {
  const entrada = desdeTextoSql(vehicle.hora_entrada)
  const ms = Math.max(0, ahora.getTime() - entrada.getTime())
  const minutos = Math.floor(ms / 60000)
  const horas = Math.max(1, Math.ceil(ms / 3600000))
  const horasBloque = Number(settings.horas_tope_dia) || 24
  const dias = Math.max(1, Math.ceil(horas / horasBloque))

  const tipo = vehicle.tipo_tarifa || 'hora'
  let montoBase = 0
  let detalle = ''
  let tramo = null
  let tope = false

  if (tipo === 'mensualidad') {
    return {
      minutos,
      horas,
      dias,
      montoBase: 0,
      recargo: 0,
      total: 0,
      tipoTarifa: tipo,
      detalle: 'Mensualidad',
      tramo,
      tope
    }
  }

  if (minutos <= (Number(settings.minutos_gracia) || 0) && tipo !== 'personalizada') {
    montoBase = 0
    detalle = `Tiempo de gracia (${minutos} min)`
  } else {
    switch (tipo) {
      case 'personalizada':
        montoBase = Number(vehicle.tarifa_personalizada) || 0
        detalle = 'Tarifa personalizada'
        break

      case 'amanecida':
        montoBase = dias * Number(settings.tarifa_amanecida)
        detalle = `${dias} amanecida(s)`
        break

      case 'hora':
      default: {
        tramo = tramosGuardados(settings).find((t) => horas > t.desde && horas <= t.hasta) ?? null
        const porHoras = tramo ? tramo.valor : horas * Number(settings.tarifa_hora)
        const maximo = dias * Number(settings.tarifa_amanecida)
        montoBase = Math.min(porHoras, maximo)
        tope = porHoras > maximo
        detalle = tope
          ? `${horas} h (tope amanecida x${dias})`
          : tramo
            ? `${horas} h (tramo ${tramo.desde}-${tramo.hasta} h)`
            : `${horas} hora(s)`
        break
      }
    }
  }

  const recargo = ticketPerdido
    ? Number(settings.cargo_ticket_perdido ?? CARGO_TICKET_PERDIDO_DEFECTO)
    : 0

  return {
    minutos,
    horas,
    dias,
    montoBase,
    recargo,
    total: montoBase + recargo,
    tipoTarifa: tipo,
    detalle,
    tramo,
    tope
  }
}

/**
 * Valida y ordena los tramos de la tarifa por hora antes de guardarlos. El
 * tramo { desde: 5, hasta: 12, valor: 10000 } cobra $10.000 fijos a la moto que
 * se queda más de 5 horas y hasta 12 (en horas iniciadas, como el resto de la
 * tarifa). Fuera de los tramos se vuelve a cobrar por hora.
 *
 * @param {string|Array} entrada el JSON guardado o la lista del formulario
 * @returns {{desde:number, hasta:number, valor:number}[]}
 * @throws con un mensaje para el administrador si algún tramo no tiene sentido
 */
export function normalizarTramos(entrada) {
  let lista = entrada ?? []
  if (typeof lista === 'string') {
    try {
      lista = JSON.parse(lista || '[]')
    } catch {
      throw new Error('Las reglas de cobro por tiempo no se pudieron leer')
    }
  }
  if (!Array.isArray(lista)) throw new Error('Las reglas de cobro por tiempo no se pudieron leer')

  const tramos = lista
    .map((t) => {
      const desde = entero(t?.desde)
      const hasta = entero(t?.hasta)
      const valor = entero(t?.valor)
      if (desde === null || hasta === null) {
        throw new Error('Complete las horas de cada regla de cobro')
      }
      if (valor === null || valor < 0) {
        throw new Error('Escriba el valor de cada regla de cobro, en pesos')
      }
      if (desde < 0 || hasta <= desde) {
        throw new Error(`En la regla de ${desde} a ${hasta} h, la segunda hora debe ser mayor`)
      }
      if (hasta > HORAS_MAXIMAS_TRAMO) {
        throw new Error(`Una regla de cobro puede llegar hasta ${HORAS_MAXIMAS_TRAMO} horas`)
      }
      return { desde, hasta, valor }
    })
    .sort((a, b) => a.desde - b.desde)

  for (let i = 1; i < tramos.length; i++) {
    const [a, b] = [tramos[i - 1], tramos[i]]
    if (b.desde < a.hasta) {
      throw new Error(
        `Las reglas de ${a.desde} a ${a.hasta} h y de ${b.desde} a ${b.hasta} h se cruzan`
      )
    }
  }

  return tramos
}

/** Los tramos guardados. Una configuración dañada no puede tumbar un cobro. */
function tramosGuardados(settings) {
  try {
    return normalizarTramos(settings.tramos_hora)
  } catch {
    return []
  }
}

/** Entero de un valor del formulario, o null si viene vacío o no es un número. */
function entero(valor) {
  if (valor === '' || valor === null || valor === undefined) return null
  const n = Number(valor)
  return Number.isFinite(n) ? Math.round(n) : null
}

/**
 * Lo que de verdad se cobra: el total calculado, o el valor que el operario
 * acordó con el cliente al momento de pagar (casi siempre un descuento).
 *
 * @param {number} calculado total según las tarifas
 * @param {number|string|null} [acordado] vacío = se cobra lo calculado
 * @returns {{total:number, ajuste:number}} `ajuste` = total − calculado
 * @throws si el valor acordado no es un monto válido
 */
export function totalCobrado(calculado, acordado) {
  if (acordado === undefined || acordado === null || acordado === '') {
    return { total: calculado, ajuste: 0 }
  }
  const valor = Number(acordado)
  if (!Number.isFinite(valor) || valor < 0) {
    throw new Error('El valor a cobrar debe ser un monto en pesos mayor o igual a cero')
  }
  const total = Math.round(valor)
  return { total, ajuste: total - calculado }
}

/**
 * Cuánto pagaría una moto por hora con una configuración, guardada o en
 * edición: la tabla que ve el administrador mientras arma los precios. Cubre
 * el primer bloque de horas y, si un tramo llega más lejos, una hora después
 * de su final.
 *
 * @throws si los tramos no son válidos, con el mismo mensaje que al guardar
 */
export function simularTarifaHora(settings) {
  const tramos = normalizarTramos(settings.tramos_hora)
  const ajustes = { ...settings, tramos_hora: tramos }
  const hasta = Math.min(
    72,
    Math.max(Number(settings.horas_tope_dia) || 24, ...tramos.map((t) => t.hasta + 1))
  )

  const entrada = new Date(2026, 0, 1, 0, 0, 0)
  const vehicle = { hora_entrada: aTextoSql(entrada), tipo_tarifa: 'hora' }
  const filas = []

  for (let horas = 1; horas <= hasta; horas++) {
    // Un minuto antes de cumplirse: son exactamente `horas` horas iniciadas.
    const ahora = new Date(entrada.getTime() + horas * 3600000 - 60000)
    const cobro = calcularCobro({ vehicle, settings: ajustes, ahora })
    filas.push({ horas, total: cobro.total, tramo: Boolean(cobro.tramo), tope: cobro.tope })
  }

  return filas
}

/** '2 h 35 min' a partir de minutos totales. */
export function formatearPermanencia(minutos) {
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  if (h === 0) return `${m} min`
  return `${h} h ${m} min`
}
