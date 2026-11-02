import Icono from './Icono.jsx'
import { METODOS_PAGO } from '../lib/format.js'

/**
 * Efectivo o transferencia. Sin valor por defecto a propósito: decide si el
 * dinero entra o no a la caja, así que el operario lo escoge siempre.
 */
export default function MetodoPago({ valor, onChange, disabled = false, className = '' }) {
  return (
    <fieldset className={className} disabled={disabled}>
      <legend className="etiqueta">Método de pago</legend>
      <div className="grid grid-cols-2 gap-1.5">
        {METODOS_PAGO.map((m) => {
          const activo = valor === m.id
          return (
            <button
              key={m.id}
              type="button"
              aria-pressed={activo}
              onClick={() => onChange(m.id)}
              className={`flex flex-col items-center gap-1 rounded-campo border px-2 py-3
                transition-colors duration-rapido ease-salida
                disabled:opacity-45 disabled:cursor-not-allowed
                ${
                  activo
                    ? 'border-azul bg-azul-50 text-azul-700'
                    : 'border-linea-fuerte text-grafito hover:border-niebla hover:bg-lienzo'
                }`}
            >
              <Icono nombre={m.icono} tam={19} />
              <span className="text-base font-medium">{m.etiqueta}</span>
              <span className="text-micro text-niebla">{m.ayuda}</span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
