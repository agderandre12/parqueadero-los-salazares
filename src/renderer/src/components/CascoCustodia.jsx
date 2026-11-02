import Icono from './Icono.jsx'

/**
 * Casco en custodia y, si lo deja, el locker donde quedó. El locker es
 * opcional y no se imprime: es para que el operario encuentre el casco.
 */
export default function CascoCustodia({ casco, locker, onCambio, disabled = false, id = 'locker' }) {
  return (
    <div
      className={`mt-4 rounded-campo border transition-colors duration-rapido
        ${casco ? 'border-linea-fuerte' : 'border-linea hover:border-linea-fuerte'}`}
    >
      <label className="flex items-center justify-between gap-3 px-3 py-3 cursor-pointer">
        <span className="flex items-center gap-2.5 text-base font-medium">
          <Icono nombre="casco" tam={18} className="text-grafito" />
          Deja el casco en custodia
        </span>
        <input
          type="checkbox"
          checked={casco}
          disabled={disabled}
          onChange={(e) => onCambio({ casco: e.target.checked })}
          className="w-4 h-4 rounded"
        />
      </label>

      {casco && (
        <div className="flex items-center justify-between gap-3 border-t border-linea px-3 py-2.5">
          <label htmlFor={id} className="text-mini text-grafito">
            Locker asignado <span className="text-niebla">opcional</span>
          </label>
          <input
            id={id}
            value={locker}
            maxLength={10}
            disabled={disabled}
            onChange={(e) => onCambio({ locker: e.target.value.toUpperCase() })}
            placeholder="Ej. 12"
            autoComplete="off"
            spellCheck={false}
            className="campo w-28 py-1.5 text-center num"
          />
        </div>
      )}
    </div>
  )
}
