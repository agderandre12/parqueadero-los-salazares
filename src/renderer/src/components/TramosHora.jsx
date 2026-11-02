import CampoPesos, { CampoEntero } from './CampoPesos.jsx'
import Icono from './Icono.jsx'

/** Los tramos tal como están en el formulario; si el texto está dañado, ninguno. */
function leer(json) {
  try {
    const lista = JSON.parse(json || '[]')
    return Array.isArray(lista) ? lista : []
  } catch {
    return []
  }
}

/**
 * Reglas por tiempo de la tarifa por hora: "más de 5 h y hasta 12 h se cobran
 * $10.000". Se editan dentro del formulario de configuración (son el JSON de
 * `tramos_hora`) y se validan al guardar, en `services/pricing.js`.
 */
export default function TramosHora({ valor, onChange }) {
  const tramos = leer(valor)
  const guardar = (lista) => onChange(JSON.stringify(lista))
  const cambiar = (i, campo) => (v) =>
    guardar(tramos.map((t, j) => (j === i ? { ...t, [campo]: v } : t)))

  // La primera propone el ejemplo de siempre; las siguientes arrancan donde
  // terminó la anterior, que es lo que casi siempre se quiere.
  function agregar() {
    const ultimo = tramos[tramos.length - 1]
    const desde = ultimo ? Number(ultimo.hasta) || 0 : 5
    guardar([...tramos, { desde, hasta: desde + (ultimo ? 6 : 7), valor: '' }])
  }

  return (
    <section className="panel overflow-hidden mt-4">
      <div className="px-4 pt-3.5 pb-3 border-b border-linea">
        <h3 className="text-base font-medium">Reglas por tiempo</h3>
        <p className="text-mini text-grafito mt-0.5">
          Un valor fijo para un tramo de la estadía, en lugar de sumar horas. Fuera de los tramos
          se cobra la hora iniciada, siempre con el tope de la amanecida.
        </p>
      </div>

      {tramos.map((t, i) => (
        <div key={i} className="px-4 py-2.5 border-b border-linea">
          <div className="flex items-center gap-2 text-base text-grafito">
            <span>Más de</span>
            <CampoEntero
              valor={t.desde}
              onChange={cambiar(i, 'desde')}
              className="w-14 py-1.5 text-center"
              aria-label={`Regla ${i + 1}: más de cuántas horas`}
            />
            <span>h y hasta</span>
            <CampoEntero
              valor={t.hasta}
              onChange={cambiar(i, 'hasta')}
              className="w-14 py-1.5 text-center"
              aria-label={`Regla ${i + 1}: hasta cuántas horas`}
            />
            <span>h se cobran</span>
            <div className="ml-auto w-36">
              <CampoPesos
                valor={t.valor}
                onChange={cambiar(i, 'valor')}
                className="py-1.5"
                placeholder="0"
                aria-label={`Regla ${i + 1}: valor en pesos`}
              />
            </div>
            <button
              type="button"
              onClick={() => guardar(tramos.filter((_, j) => j !== i))}
              title="Quitar esta regla"
              aria-label={`Quitar la regla ${i + 1}`}
              className="rounded-md p-1.5 text-niebla transition-colors duration-rapido
                         hover:bg-alerta-50 hover:text-alerta"
            >
              <Icono nombre="eliminar" tam={16} />
            </button>
          </div>
          {Number(t.hasta) > Number(t.desde) && (
            <p className="mt-1 text-micro text-niebla">
              Cubre de la hora {Number(t.desde) + 1} a la hora {t.hasta}: con {t.desde} h y 1 min la
              moto ya entró a la regla, y con {t.hasta} h y 1 min ya salió.
            </p>
          )}
        </div>
      ))}

      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <button type="button" onClick={agregar} className="btn-neutro py-2">
          <Icono nombre="mas" tam={15} />
          Agregar regla
        </button>
        {tramos.length === 0 && (
          <span className="text-mini text-niebla">
            Sin reglas: toda estadía se cobra por hora iniciada.
          </span>
        )}
      </div>
    </section>
  )
}
