/** Formateo de moneda, fechas y placas para la UI. */

const fmtCOP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
})

export const cop = (valor) => fmtCOP.format(Number(valor) || 0)

/** Sin símbolo, para cuando la etiqueta ya dice que son pesos. */
export const miles = (valor) =>
  Number(valor || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })

/** '2026-08-18 14:29:00' -> Date (hora local). */
export function parseSql(texto) {
  if (!texto) return null
  const [f, h = '00:00:00'] = String(texto).trim().split(/[ T]/)
  const [a, m, d] = f.split('-').map(Number)
  const [hh, mm, ss] = h.split(':').map(Number)
  return new Date(a, (m || 1) - 1, d || 1, hh || 0, mm || 0, ss || 0)
}

/** '02:35 p. m.' */
export function hora(texto) {
  const d = parseSql(texto)
  if (!d) return '--:--'
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true })
}

/** '18/08/2026' */
export function fecha(texto) {
  const d = parseSql(texto)
  if (!d) return '--'
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** '18/08/2026 02:35 p. m.' */
export function fechaHora(texto) {
  const d = parseSql(texto)
  if (!d) return '--'
  return d.toLocaleString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })
}

/** 'miércoles 19 de agosto de 2026' */
export function fechaLarga(d = new Date()) {
  return d.toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
}

/** 'YYYY-MM-DD' en hora local, para los filtros por día. */
export function isoLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Tiempo transcurrido legible desde una hora de entrada. */
export function transcurrido(texto, ahora = new Date()) {
  const d = parseSql(texto)
  if (!d) return '--'
  const min = Math.max(0, Math.floor((ahora - d) / 60000))
  const h = Math.floor(min / 60)
  return h === 0 ? `${min} min` : `${h} h ${min % 60} min`
}

/** Versión compacta para celdas y tablas: '3h 35m'. */
export function transcurridoCorto(texto, ahora = new Date()) {
  const d = parseSql(texto)
  if (!d) return '--'
  const min = Math.max(0, Math.floor((ahora - d) / 60000))
  const h = Math.floor(min / 60)
  return h === 0 ? `${min}m` : `${h}h ${min % 60}m`
}

export const normalizarPlaca = (p) =>
  String(p || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 7)

export const celda = (n) => (n ? String(n).padStart(2, '0') : '—')

export const ETIQUETA_TARIFA = {
  hora: 'Por hora',
  amanecida: 'Amanecida',
  mensualidad: 'Mensualidad',
  personalizada: 'Personalizada'
}

/** Espejo de METODOS_PAGO en `src/main/services/caja.js`. */
export const METODOS_PAGO = [
  { id: 'efectivo', etiqueta: 'Efectivo', icono: 'efectivo', ayuda: 'Entra a la caja' },
  {
    id: 'transferencia',
    etiqueta: 'Transferencia',
    icono: 'transferencia',
    ayuda: 'No entra a la caja'
  }
]

export const ETIQUETA_METODO = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia'
}

/** '19/08' — eje compacto para la serie diaria de ventas. */
export function diaCorto(iso) {
  const d = parseSql(iso)
  if (!d) return '--'
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' })
}
