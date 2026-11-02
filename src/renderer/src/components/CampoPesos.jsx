import { useLayoutEffect, useRef } from 'react'
import { miles } from '../lib/format.js'

/*
 * Campos numéricos de la aplicación. Son de texto y no `type="number"` a
 * propósito: el campo numérico no admite el punto de miles, y la rueda del
 * mouse le cambiaba el valor a un precio con sólo pasar por encima.
 */

const sinValor = (valor) => valor === '' || valor === null || valor === undefined

/**
 * Pesos con punto de miles: se lee "50.000" mientras se escribe.
 * `valor` y lo que entrega `onChange` son un entero, o '' si quedó vacío.
 */
export default function CampoPesos({ valor, onChange, grande = false, className = '', ...resto }) {
  const ref = useRef(null)
  // Cifras que había antes del cursor: al reformatear, el cursor vuelve detrás
  // de esa misma cifra aunque los puntos cambien de lugar.
  const cifrasAntes = useRef(null)
  const texto = sinValor(valor) ? '' : miles(valor)

  useLayoutEffect(() => {
    const el = ref.current
    if (cifrasAntes.current === null || !el || document.activeElement !== el) return
    let restantes = cifrasAntes.current
    let i = 0
    while (i < el.value.length && restantes > 0) {
      if (/\d/.test(el.value[i])) restantes--
      i++
    }
    el.setSelectionRange(i, i)
    cifrasAntes.current = null
  }, [texto])

  return (
    <div className="relative">
      <span
        className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-niebla
          ${grande ? 'text-dato font-medium' : 'text-base'}`}
      >
        $
      </span>
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={texto}
        onChange={(e) => {
          const { value, selectionStart } = e.target
          cifrasAntes.current = value
            .slice(0, selectionStart ?? value.length)
            .replace(/\D/g, '').length
          const cifras = value.replace(/\D/g, '').slice(0, 9)
          onChange(cifras === '' ? '' : Number(cifras))
        }}
        className={`campo num text-right ${grande ? 'pl-8 py-2 text-dato font-semibold' : 'pl-7'} ${className}`}
        {...resto}
      />
    </div>
  )
}

/**
 * Entero corto sin separadores: minutos, horas, celdas. `className` reemplaza
 * la alineación a la derecha (dos alineaciones a la vez no se pueden mezclar).
 */
export function CampoEntero({ valor, onChange, cifras = 3, className = 'text-right', ...resto }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      value={sinValor(valor) ? '' : String(valor)}
      onChange={(e) => {
        const limpio = e.target.value.replace(/\D/g, '').slice(0, cifras)
        onChange(limpio === '' ? '' : Number(limpio))
      }}
      className={`campo num ${className}`}
      {...resto}
    />
  )
}
