import { getSettings } from '../db/settingsRepo.js'
import * as cajaRepo from '../db/cajaRepo.js'
import * as transacciones from '../db/transactionsRepo.js'
import * as vehiculos from '../db/vehiclesRepo.js'
import { resumenCaja } from './caja.js'
import { desdeTextoSql } from './tiempo.js'

/*
 * Aviso del cierre de caja al administrador por Telegram.
 *
 * Cumple el mismo contrato que la impresora: nada de aquí lanza ni deshace lo
 * guardado. El cierre ya quedó en la base cuando se intenta enviar; si no hay
 * internet, el aviso queda 'pendiente' en `caja_dias.aviso_estado` y
 * `reintentarAvisos()` lo manda cuando vuelva.
 *
 * El token nunca va en un mensaje de error ni en un log: está en la URL.
 */

const API = 'https://api.telegram.org'
const MS_ESPERA = 10000

// Una jornada se está enviando: el reintento periódico no debe duplicar el aviso.
const enviando = new Set()

const pesos = (valor) =>
  '$' + Number(valor || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })

// El mensaje va en HTML: lo que escribe el operario no puede romper el formato.
const escapar = (texto) =>
  String(texto).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Por qué Telegram rechazó la llamada, en palabras del administrador. */
function traducirError(estado, descripcion = '') {
  if (estado === 401 || estado === 404) return 'El token del bot no es válido'
  if (/chat not found/i.test(descripcion)) {
    return 'No se encontró ese chat. Escríbale primero un mensaje al bot'
  }
  if (estado === 403) return 'El bot no puede escribirle a ese chat. Revise que no esté bloqueado'
  if (estado === 429) return 'Telegram pidió esperar un momento antes de enviar otro mensaje'
  return `Telegram rechazó el mensaje (error ${estado})`
}

async function llamar(token, metodo, cuerpo) {
  let respuesta
  try {
    respuesta = await fetch(`${API}/bot${token}/${metodo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(MS_ESPERA)
    })
  } catch {
    throw new Error('No hubo conexión con Telegram. Revise el internet del equipo')
  }

  const datos = await respuesta.json().catch(() => ({}))
  if (!datos.ok) throw new Error(traducirError(respuesta.status, datos.description))
  return datos.result
}

/** Envía un mensaje. Nunca lanza: devuelve `{ ok, motivo? }`. */
export async function enviarMensaje({ token, chatId }, texto) {
  if (!token || !chatId) return { ok: false, motivo: 'Falta el token del bot o el chat' }
  try {
    await llamar(token, 'sendMessage', {
      chat_id: chatId,
      text: texto,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, motivo: error.message }
  }
}

/** El mensaje de prueba de Configuración, con lo que está en pantalla. */
export function probarTelegram({ token, chatId }, nombreNegocio = getSettings().nombre_parqueadero) {
  return enviarMensaje(
    { token: String(token ?? '').trim(), chatId: String(chatId ?? '').trim() },
    `✅ <b>${escapar(nombreNegocio)}</b>\nAquí llegará el resumen de cada cierre de caja.`
  )
}

/**
 * El chat de quien le escribió último al bot: así el administrador no tiene que
 * averiguar su número.
 * @throws con un mensaje para el administrador si no se pudo o nadie ha escrito
 */
export async function buscarChat(token) {
  const limpio = String(token ?? '').trim()
  if (!limpio) throw new Error('Escriba primero el token del bot')

  const novedades = await llamar(limpio, 'getUpdates', {})
  const chat = novedades
    .map((n) => (n.message ?? n.edited_message ?? n.my_chat_member)?.chat)
    .filter(Boolean)
    .pop()
  if (!chat) throw new Error('Aún no hay mensajes: escríbale cualquier cosa al bot y vuelva a buscar')

  return { id: String(chat.id), nombre: chat.title || chat.first_name || chat.username || '' }
}

/** El resumen del cierre de una jornada, tal como lo lee el administrador. */
export function textoCierre(fecha, settings = getSettings()) {
  const caja = resumenCaja(fecha)
  const dia = transacciones.totalesEntre(fecha, fecha)
  const mes = transacciones.totalesEntre(`${fecha.slice(0, 7)}-01`, fecha)
  const { entradasHoy, salidasHoy, ocupadas } = vehiculos.estadisticasDelDia(fecha)

  const quedo = caja.quedaEnCaja ?? caja.conteoFinal
  const retiro = caja.conteoFinal - quedo
  const titulo = desdeTextoSql(fecha).toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
  const hora = desdeTextoSql(caja.cerradaAt).toLocaleTimeString('es-CO', {
    hour: 'numeric',
    minute: '2-digit'
  })
  const cuadre =
    caja.diferencia === 0
      ? '✅ Cuadró exacto'
      : `⚠️ <b>${caja.diferencia > 0 ? 'Sobrante' : 'Faltante'}: ${pesos(Math.abs(caja.diferencia))}</b>`

  const lineas = [
    `🧾 <b>Cierre de caja · ${escapar(settings.nombre_parqueadero)}</b>`,
    `${titulo[0].toUpperCase()}${titulo.slice(1)}`,
    `Cerró a las ${hora}`,
    '',
    `💰 <b>Ventas del día: ${pesos(dia.total)}</b>`,
    `${dia.operaciones} ${dia.operaciones === 1 ? 'cobro' : 'cobros'}`,
    `Parqueadero: ${pesos(dia.total - dia.lavadero)}`,
    `Lavadero: ${pesos(dia.lavadero)}`,
    `Efectivo: ${pesos(dia.efectivo)}`,
    `Transferencia: ${pesos(dia.transferencia)}`,
    ...(dia.descuentos > 0 ? [`Descuentos dados: ${pesos(dia.descuentos)}`] : []),
    '',
    '🏦 <b>Caja</b>',
    `Base: ${pesos(caja.baseInicial)}`,
    `Debía haber: ${pesos(caja.conteoFinal - caja.diferencia)}`,
    `Contado: ${pesos(caja.conteoFinal)}`,
    cuadre,
    ...(retiro > 0 ? [`Se retiró: ${pesos(retiro)}`] : []),
    `Quedó en el cajón: ${pesos(quedo)}`,
    '',
    '🏍️ <b>Movimiento</b>',
    `Entradas: ${entradasHoy} · Salidas: ${salidasHoy}`,
    `Lavadas entregadas: ${dia.lavadas}`,
    `Motos adentro ahora: ${ocupadas}`,
    '',
    `📅 <b>Ventas del mes hasta este día: ${pesos(mes.total)}</b>`
  ]
  if (caja.observaciones) lineas.push('', `📝 ${escapar(caja.observaciones)}`)

  return lineas.join('\n')
}

async function enviarCierre(fecha, settings) {
  if (enviando.has(fecha)) return { ok: false, motivo: 'El aviso ya se está enviando' }
  enviando.add(fecha)
  try {
    const resultado = await enviarMensaje(
      { token: settings.telegram_token, chatId: settings.telegram_chat_id },
      textoCierre(fecha, settings)
    )
    if (resultado.ok) cajaRepo.marcarAviso(fecha, 'enviado')
    return resultado
  } catch (error) {
    return { ok: false, motivo: error.message }
  } finally {
    enviando.delete(fecha)
  }
}

/**
 * Avisa el cierre de una jornada. `omitido` = Telegram está apagado. Si falla,
 * el aviso queda pendiente y lo retoma `reintentarAvisos()`.
 *
 * @returns {Promise<{ok:boolean, motivo?:string, omitido?:boolean}>}
 */
export async function avisarCierre(fecha) {
  const settings = getSettings()
  if (!settings.telegram_activo) {
    return { ok: false, omitido: true, motivo: 'Telegram está apagado en Configuración' }
  }
  if (!cajaRepo.obtenerDia(fecha)?.cerrada_at) {
    return { ok: false, motivo: 'La jornada todavía no está cerrada' }
  }

  cajaRepo.marcarAviso(fecha, 'pendiente')
  return enviarCierre(fecha, settings)
}

/** Reenvía los avisos pendientes; al primero que falla se detiene hasta la próxima. */
export async function reintentarAvisos() {
  const settings = getSettings()
  if (!settings.telegram_activo) return

  for (const fecha of cajaRepo.avisosPendientes()) {
    const { ok } = await enviarCierre(fecha, settings)
    if (!ok) return
  }
}
