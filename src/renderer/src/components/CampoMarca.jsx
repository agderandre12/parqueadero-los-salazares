// De la más común a la menos: con una sola letra se recomienda la primera que
// coincida ("H" es Honda, no Hero).
const MARCAS = [
  'Yamaha',
  'Honda',
  'Bajaj',
  'AKT',
  'Suzuki',
  'TVS',
  'Victory',
  'Hero',
  'KTM',
  'Kawasaki'
]

const recomendada = (texto) => {
  const inicio = texto.trimStart().toLowerCase()
  if (!inicio) return null
  return MARCAS.find((m) => m.toLowerCase().startsWith(inicio)) ?? null
}

/**
 * Marca de la moto con recomendación mientras se escribe: lo que falta de la
 * marca aparece en gris dentro del campo y se acepta con Tab, Enter o → (o
 * tocando "Tab"). Una marca que no está en la lista se escribe igual.
 */
export default function CampoMarca({ id, valor, onChange, disabled }) {
  const marca = recomendada(valor)
  const faltante = marca && marca.length > valor.trimStart().length ? marca : null
  const aceptar = () => onChange(faltante)

  function alTeclear(e) {
    if (!faltante) return
    const alFinal = e.target.selectionStart === valor.length
    // Tab acepta y sigue al campo siguiente; Enter sólo acepta, para no
    // registrar la entrada con la palabra a medias.
    if (e.key === 'Tab' && !e.shiftKey) aceptar()
    else if (e.key === 'ArrowRight' && alFinal) aceptar()
    else if (e.key === 'Enter') {
      e.preventDefault()
      aceptar()
    }
  }

  return (
    <div className="relative">
      <input
        id={id}
        value={valor}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={alTeclear}
        // "yamaha" y "YAMAHA" son la misma marca: queda escrita igual en el historial.
        onBlur={() => marca?.toLowerCase() === valor.trim().toLowerCase() && onChange(marca)}
        placeholder="Bajaj"
        autoComplete="off"
        spellCheck={false}
        className="campo"
      />
      {faltante && (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-px flex items-center overflow-hidden
                       whitespace-pre pl-3 text-base font-medium"
          >
            <span className="invisible">{valor}</span>
            <span className="text-niebla">{faltante.slice(valor.trimStart().length)}</span>
          </span>
          <button
            type="button"
            tabIndex={-1}
            // Sin esto el clic le quita el foco al campo.
            onMouseDown={(e) => e.preventDefault()}
            onClick={aceptar}
            title={`Usar ${faltante}`}
            aria-label={`Usar la marca recomendada: ${faltante}`}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-linea-fuerte
                       bg-lienzo px-1.5 py-0.5 text-micro text-grafito hover:text-tinta"
          >
            Tab
          </button>
        </>
      )}
    </div>
  )
}
