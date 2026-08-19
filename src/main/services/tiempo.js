/** Utilidades de fecha/hora locales en formato SQLite: 'YYYY-MM-DD HH:MM:SS'. */

const dosDigitos = (n) => String(n).padStart(2, '0')

/** Date -> 'YYYY-MM-DD HH:MM:SS' en hora local. */
export function aTextoSql(fecha = new Date()) {
  return (
    `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}-${dosDigitos(fecha.getDate())} ` +
    `${dosDigitos(fecha.getHours())}:${dosDigitos(fecha.getMinutes())}:${dosDigitos(fecha.getSeconds())}`
  )
}

/** 'YYYY-MM-DD HH:MM:SS' (hora local) -> Date. */
export function desdeTextoSql(texto) {
  if (!texto) return null
  const [f, h = '00:00:00'] = String(texto).trim().split(/[ T]/)
  const [a, m, d] = f.split('-').map(Number)
  const [hh, mm, ss] = h.split(':').map(Number)
  return new Date(a, (m || 1) - 1, d || 1, hh || 0, mm || 0, ss || 0)
}

export function ahoraSql() {
  return aTextoSql(new Date())
}
