import { desdeTextoSql } from './tiempo.js'

export const CARGO_TICKET_PERDIDO_DEFECTO = 2000

/**
 * Calcula el cobro de un vehículo.
 *
 * Reglas:
 *  - 'hora'          : se cobra por hora iniciada, con tope de amanecida por cada
 *                      bloque de 24h (nunca se cobra más que la amanecida del día).
 *  - 'amanecida'     : tarifa fija por cada bloque de 24h iniciado.
 *  - 'mensualidad'   : $0 al salir (el mes ya está pagado).
 *  - 'personalizada' : valor fijo pactado, guardado en tarifa_personalizada.
 *  - Antes de `minutos_gracia` no se cobra nada.
 *  - `ticketPerdido` suma el recargo configurado (por defecto $2.000).
 *
 * @returns {{minutos:number, horas:number, dias:number, montoBase:number,
 *            recargo:number, total:number, tipoTarifa:string, detalle:string}}
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

  if (minutos <= (Number(settings.minutos_gracia) || 0) && tipo !== 'personalizada') {
    montoBase = 0
    detalle = `Tiempo de gracia (${minutos} min)`
  } else {
    switch (tipo) {
      case 'mensualidad':
        montoBase = 0
        detalle = 'Mensualidad vigente'
        break

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
        const porHoras = horas * Number(settings.tarifa_hora)
        const tope = dias * Number(settings.tarifa_amanecida)
        montoBase = Math.min(porHoras, tope)
        detalle =
          montoBase === tope && porHoras > tope
            ? `${horas} h (tope amanecida x${dias})`
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
    detalle
  }
}

/** '2 h 35 min' a partir de minutos totales. */
export function formatearPermanencia(minutos) {
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  if (h === 0) return `${m} min`
  return `${h} h ${m} min`
}
