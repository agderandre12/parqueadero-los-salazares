import { getSettings } from '../db/settingsRepo.js'
import * as cajaRepo from '../db/cajaRepo.js'
import * as transacciones from '../db/transactionsRepo.js'
import { hoySql } from './tiempo.js'

/*
 * Caja registradora y analítica de ventas.
 *
 * La regla que gobierna todo el módulo: sólo el efectivo entra al cajón. Una
 * transferencia es una venta idéntica para las métricas, pero el dinero llegó a
 * una cuenta digital y el saldo físico no se mueve. Por eso el saldo esperado
 * es siempre `base_inicial + efectivo del día` y nunca incluye el total.
 *
 * El efectivo del día no se guarda en `caja_dias`: se suma en cada consulta
 * desde la vista `ventas`, que junta los cobros del parqueadero (`transactions`)
 * y los del lavadero (`lavados`). Así un cobro anulado o reimpreso no puede
 * dejar el cajón descuadrado contra su propio historial.
 */

export const METODOS_PAGO = ['efectivo', 'transferencia']

export const ETIQUETA_METODO = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia'
}

/**
 * Valida el método de pago de una liquidación. Es obligatorio: el operario lo
 * escoge en la vista de salida antes de poder cobrar.
 */
export function normalizarMetodoPago(metodo) {
  const valor = String(metodo || '').trim().toLowerCase()
  if (!METODOS_PAGO.includes(valor)) {
    throw new Error('Seleccione el método de pago: efectivo o transferencia')
  }
  return valor
}

/**
 * Lo que quedó en el cajón al cerrar una jornada, o null si no se cerró. Los
 * cierres anteriores a `queda_en_caja` dejaban en el cajón todo lo contado.
 */
function quedoEnCaja(jornada) {
  if (!jornada?.cerrada_at) return null
  return jornada.queda_en_caja ?? jornada.conteo_final
}

/**
 * Garantiza la fila de la jornada. Una nueva abre con lo que quedó en el cajón
 * al cerrar la anterior — la plata pasa la noche ahí —; si la anterior no se
 * cerró, o es la primera, con la base predeterminada de la configuración.
 *
 * Se llama en cada consulta y en cada cobro en efectivo: cobrar nunca queda
 * esperando a que alguien abra la caja.
 */
export function asegurarJornada(fecha = hoySql()) {
  const existente = cajaRepo.obtenerDia(fecha)
  if (existente) return existente
  const base =
    quedoEnCaja(cajaRepo.jornadaAnterior(fecha)) ?? getSettings().caja_base_predeterminada
  return cajaRepo.asegurarDia(fecha, base)
}

/**
 * Estado de la jornada (la crea si aún no existe, ver `asegurarJornada`).
 * `anterior` es la jornada previa: de su cierre sale la base y, si quedó sin
 * cerrar (se olvidó, o se cerró pasada la medianoche), la vista avisa.
 *
 * @param {string} [fecha] 'YYYY-MM-DD'; por defecto hoy.
 */
export function resumenCaja(fecha = hoySql()) {
  const dia = asegurarJornada(fecha)
  const anterior = cajaRepo.jornadaAnterior(fecha)
  const ventas = transacciones.totalesEntre(fecha, fecha)

  const baseInicial = dia.base_inicial
  const esperado = baseInicial + ventas.efectivo

  return {
    fecha,
    baseInicial,
    efectivo: ventas.efectivo,
    transferencia: ventas.transferencia,
    totalVentas: ventas.total,
    operaciones: ventas.operaciones,
    cobrosEfectivo: ventas.cobrosEfectivo,
    // Lo que debería haber físicamente en el cajón en este momento.
    esperado,
    cerrada: Boolean(dia.cerrada_at),
    cerradaAt: dia.cerrada_at,
    abiertaAt: dia.abierta_at,
    conteoFinal: dia.conteo_final,
    diferencia: dia.diferencia,
    quedaEnCaja: dia.queda_en_caja,
    observaciones: dia.observaciones,
    anterior: anterior
      ? {
          fecha: anterior.fecha,
          cerrada: Boolean(anterior.cerrada_at),
          quedaEnCaja: quedoEnCaja(anterior)
        }
      : null,
    movimientos: transacciones.ventasDelDia(fecha)
  }
}

/** Abre la jornada fijando la base de dinero en caja. */
export function abrirCaja({ fecha = hoySql(), baseInicial = 0 } = {}) {
  const base = Number(baseInicial)
  if (!Number.isFinite(base) || base < 0) {
    throw new Error('La base de caja debe ser un valor en pesos mayor o igual a cero')
  }

  cajaRepo.fijarBase(fecha, base)
  return resumenCaja(fecha)
}

/**
 * Cierre de caja: se compara el dinero contado con `base + efectivo del día`.
 * La diferencia se guarda con signo — positiva sobra, negativa falta — porque
 * el dato útil al día siguiente es el descuadre, no sólo que hubo uno.
 *
 * `quedaEnCaja` es lo que se deja en el cajón para la jornada siguiente (el
 * resto se retira); vacío deja todo lo contado. Es con lo que abre mañana.
 */
export function cerrarCaja({
  fecha = hoySql(),
  conteoFinal,
  quedaEnCaja,
  observaciones = ''
} = {}) {
  const conteo = Number(conteoFinal)
  if (!Number.isFinite(conteo) || conteo < 0) {
    throw new Error('Ingrese el dinero contado en caja para poder cerrar')
  }

  const vacio = quedaEnCaja === undefined || quedaEnCaja === null || quedaEnCaja === ''
  const queda = vacio ? conteo : Number(quedaEnCaja)
  if (!Number.isFinite(queda) || queda < 0 || queda > conteo) {
    throw new Error('Lo que queda en el cajón debe estar entre $0 y lo que se contó')
  }

  const antes = resumenCaja(fecha)
  if (antes.cerrada) throw new Error(`La caja del ${fecha} ya fue cerrada`)

  cajaRepo.cerrarDia({
    fecha,
    conteoFinal: conteo,
    diferencia: conteo - antes.esperado,
    quedaEnCaja: queda,
    observaciones: String(observaciones || '').slice(0, 300)
  })

  return resumenCaja(fecha)
}

/**
 * Deshace un cierre equivocado; la base y los cobros del día se conservan. Si
 * la jornada siguiente ya abrió con lo que quedó, su base no cambia: se corrige
 * a mano.
 */
export function reabrirCaja(fecha = hoySql()) {
  cajaRepo.reabrirDia(fecha)
  return resumenCaja(fecha)
}

export function historialCierres(limite = 14) {
  return cajaRepo.ultimosCierres(limite)
}

/**
 * Analítica de ventas en COP: día, semana en curso (desde el lunes) y mes en
 * curso, cada una desglosada en efectivo y transferencia.
 */
export function metricasVentas() {
  const { hoy, inicioSemana, inicioMes } = transacciones.limitesPeriodos()

  return {
    hoy,
    dia: { desde: hoy, hasta: hoy, ...transacciones.totalesEntre(hoy, hoy) },
    semana: {
      desde: inicioSemana,
      hasta: hoy,
      ...transacciones.totalesEntre(inicioSemana, hoy)
    },
    mes: { desde: inicioMes, hasta: hoy, ...transacciones.totalesEntre(inicioMes, hoy) },
    serieMes: transacciones.ventasPorDia(inicioMes, hoy)
  }
}
