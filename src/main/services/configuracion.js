import { updateSettings } from '../db/settingsRepo.js'
import { normalizarTramos } from './pricing.js'

/*
 * Validación de la configuración antes de guardarla. El formulario manda lo
 * que haya en pantalla: un campo de pesos vacío llegaría a la base como '' y la
 * tarifa quedaría cobrando $0 sin que nadie lo note.
 */

const PESOS = {
  tarifa_hora: 'La tarifa por hora',
  tarifa_amanecida: 'La tarifa de amanecida',
  tarifa_mensualidad: 'La tarifa de mensualidad',
  cargo_ticket_perdido: 'El recargo por tiquete perdido',
  caja_base_predeterminada: 'La base de caja predeterminada'
}

const CANTIDADES = {
  total_celdas: { etiqueta: 'El total de celdas', min: 1, max: 500 },
  minutos_gracia: { etiqueta: 'Los minutos de gracia', min: 0, max: 120 },
  horas_tope_dia: { etiqueta: 'Las horas por bloque', min: 1, max: 48 }
}

const BANDERAS = ['imprimir_automatico', 'impresora_sin_tildes']

const ANCHOS_PAPEL = [32, 48]

const vacio = (valor) => valor === '' || valor === null || valor === undefined

/**
 * Guarda los campos de `patch` que sean editables, ya validados.
 * @throws con un mensaje para el administrador si algún valor no sirve
 */
export function actualizarConfiguracion(patch = {}) {
  const limpio = { ...patch }

  for (const [campo, etiqueta] of Object.entries(PESOS)) {
    if (!(campo in limpio)) continue
    const valor = Number(limpio[campo])
    if (vacio(limpio[campo]) || !Number.isFinite(valor) || valor < 0) {
      throw new Error(`${etiqueta} debe ser un valor en pesos mayor o igual a cero`)
    }
    limpio[campo] = Math.round(valor)
  }

  for (const [campo, { etiqueta, min, max }] of Object.entries(CANTIDADES)) {
    if (!(campo in limpio)) continue
    const valor = Number(limpio[campo])
    if (vacio(limpio[campo]) || !Number.isInteger(valor) || valor < min || valor > max) {
      throw new Error(`${etiqueta} debe ser un número entero entre ${min} y ${max}`)
    }
    limpio[campo] = valor
  }

  for (const campo of BANDERAS) {
    if (campo in limpio) limpio[campo] = Number(limpio[campo]) ? 1 : 0
  }

  if ('impresora_ancho' in limpio) {
    const ancho = Number(limpio.impresora_ancho)
    if (!ANCHOS_PAPEL.includes(ancho)) {
      throw new Error('El ancho del papel debe ser de 32 o 48 caracteres')
    }
    limpio.impresora_ancho = ancho
  }

  if ('tramos_hora' in limpio) {
    limpio.tramos_hora = JSON.stringify(normalizarTramos(limpio.tramos_hora))
  }

  return updateSettings(limpio)
}
