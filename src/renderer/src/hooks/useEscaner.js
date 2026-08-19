import { useEffect, useRef, useState } from 'react'

/*
 * Lector Jaltech PLUS 1D/QR (JAL PLUS 01).
 *
 * El aparato se conecta por USB y el sistema lo ve como un teclado: teclea el
 * código carácter por carácter y cierra con Enter. No hay driver ni puerto que
 * abrir — se distingue de una persona por la velocidad.
 *
 * Un humano tarda 80-300 ms entre teclas; el lector, menos de 20 ms. Si toda
 * la ráfaga viene por debajo del umbral y termina en Enter, es una lectura.
 *
 * Si el foco está en un campo marcado con data-escaner="local", la lectura se
 * deja caer en ese campo y NO se emite: el operario está digitando o escaneando
 * dentro de un formulario y no queremos que la app navegue debajo de él.
 */

const MS_ENTRE_TECLAS = 35 // por encima de esto, es una persona
const LARGO_MINIMO = 3 // descarta pulsaciones sueltas
const MS_REINICIO = 400 // olvida un búfer abandonado

export function useEscaner({ activo = true, onLectura } = {}) {
  const [leyendo, setLeyendo] = useState(false)
  const buffer = useRef('')
  const ultimaTecla = useRef(0)
  const esRafaga = useRef(true)
  const onLecturaRef = useRef(onLectura)

  // El consumidor suele pasar una función nueva en cada render; guardarla en
  // una ref evita re-suscribir el listener del documento en cada uno.
  useEffect(() => {
    onLecturaRef.current = onLectura
  }, [onLectura])

  useEffect(() => {
    if (!activo) {
      buffer.current = ''
      setLeyendo(false)
      return
    }

    const limpiar = () => {
      buffer.current = ''
      esRafaga.current = true
      setLeyendo(false)
    }

    const enCampoPropio = () => {
      const el = document.activeElement
      return Boolean(el?.dataset?.escaner === 'local')
    }

    const alTeclear = (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return

      const ahora = performance.now()
      const brecha = ahora - ultimaTecla.current

      if (e.key === 'Enter') {
        // Hay que leer el veredicto ANTES de limpiar: `limpiar` reinicia
        // `esRafaga` a true y si se consulta después siempre da positivo.
        const codigo = buffer.current
        const fueRafaga = esRafaga.current
        limpiar()

        // Sólo intercepta si fue una ráfaga real y el foco no está en un campo
        // que ya recibe el escaneo por sí mismo.
        if (!fueRafaga || codigo.length < LARGO_MINIMO) return
        if (enCampoPropio()) return

        e.preventDefault()
        e.stopPropagation()
        onLecturaRef.current?.(codigo)
        return
      }

      // Sólo caracteres imprimibles
      if (e.key.length !== 1) return

      if (brecha > MS_REINICIO || buffer.current === '') {
        buffer.current = ''
        esRafaga.current = true
      } else if (brecha > MS_ENTRE_TECLAS) {
        esRafaga.current = false
      }

      buffer.current += e.key
      ultimaTecla.current = ahora

      if (buffer.current.length >= LARGO_MINIMO && esRafaga.current) setLeyendo(true)
    }

    // Fase de captura: el lector debe verse antes que cualquier handler de campo.
    document.addEventListener('keydown', alTeclear, true)
    return () => document.removeEventListener('keydown', alTeclear, true)
  }, [activo])

  return { leyendo }
}
