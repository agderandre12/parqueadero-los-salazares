import { getDb } from './index.js'

const CAMPOS_EDITABLES = [
  'nombre_parqueadero',
  'nit',
  'direccion',
  'telefono',
  'total_celdas',
  'tarifa_hora',
  'tarifa_amanecida',
  'tarifa_mensualidad',
  'cargo_ticket_perdido',
  'minutos_gracia',
  'horas_tope_dia',
  'impresora_tipo',
  'impresora_interface',
  'impresora_ancho',
  'imprimir_automatico',
  'mensaje_recibo'
]

export function getSettings() {
  const db = getDb()
  db.prepare('INSERT OR IGNORE INTO settings (id) VALUES (1)').run()
  return db.prepare('SELECT * FROM settings WHERE id = 1').get()
}

export function updateSettings(patch = {}) {
  const db = getDb()
  const campos = Object.keys(patch).filter((k) => CAMPOS_EDITABLES.includes(k))
  if (campos.length === 0) return getSettings()

  const sets = campos.map((c) => `${c} = @${c}`).join(', ')
  const valores = {}
  for (const c of campos) {
    valores[c] = typeof patch[c] === 'boolean' ? (patch[c] ? 1 : 0) : patch[c]
  }

  db.prepare(
    `UPDATE settings SET ${sets}, updated_at = datetime('now','localtime') WHERE id = 1`
  ).run(valores)

  return getSettings()
}
