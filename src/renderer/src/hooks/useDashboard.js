import { useCallback, useEffect, useRef, useState } from 'react'

const VACIO = {
  stats: {
    totalCeldas: 0,
    ocupadas: 0,
    disponibles: 0,
    entradasHoy: 0,
    salidasHoy: 0,
    recaudoHoy: 0
  },
  celdas: [],
  sinCelda: [],
  ultimos: [],
  settings: null
}

/**
 * Estado del dashboard con auto-refresco.
 * @param {number} intervaloMs cada cuánto se vuelve a consultar la base de datos
 */
export function useDashboard(intervaloMs = 5000) {
  const [datos, setDatos] = useState(VACIO)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const montado = useRef(true)

  const refrescar = useCallback(async () => {
    try {
      const res = await window.api.dashboard.resumen()
      if (!montado.current) return
      if (res.ok) {
        setDatos(res.data)
        setError(null)
      } else {
        setError(res.error)
      }
    } catch (e) {
      if (montado.current) setError(e.message)
    } finally {
      if (montado.current) setCargando(false)
    }
  }, [])

  useEffect(() => {
    montado.current = true
    refrescar()
    const id = setInterval(refrescar, intervaloMs)
    return () => {
      montado.current = false
      clearInterval(id)
    }
  }, [refrescar, intervaloMs])

  return { ...datos, cargando, error, refrescar }
}

/** Reloj que se actualiza cada segundo (para el header y los tiempos vivos). */
export function useReloj() {
  const [ahora, setAhora] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return ahora
}

/**
 * Estado de la impresora térmica. Se consulta despacio (30 s) porque abrir el
 * puerto es costoso y el dato sólo alimenta un indicador.
 */
export function useImpresora(intervaloMs = 30000) {
  const [estado, setEstado] = useState({ conectada: false, motivo: 'Consultando…' })

  const consultar = useCallback(async () => {
    try {
      const res = await window.api.impresora.estado()
      setEstado(res.ok ? res.data : { conectada: false, motivo: res.error })
    } catch (e) {
      setEstado({ conectada: false, motivo: e.message })
    }
  }, [])

  useEffect(() => {
    consultar()
    const id = setInterval(consultar, intervaloMs)
    return () => clearInterval(id)
  }, [consultar, intervaloMs])

  return { impresora: estado, revisarImpresora: consultar }
}
