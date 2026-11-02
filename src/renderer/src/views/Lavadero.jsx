import { useCallback, useEffect, useState } from 'react'
import EntregaLavado from '../components/EntregaLavado.jsx'
import Icono from '../components/Icono.jsx'
import IngresoLavado from '../components/IngresoLavado.jsx'
import { cop, hora, transcurridoCorto } from '../lib/format.js'

const MODOS = [
  { id: 'ingreso', etiqueta: 'Ingresar moto', icono: 'entrada' },
  { id: 'entrega', etiqueta: 'Entregar y cobrar', icono: 'salida' }
]

/*
 * Lavadero. Los mismos dos gestos del parqueadero: ingresar la moto (con su
 * lavada y, si el operario lo pide, el tiquete) y entregarla cobrando. A la
 * derecha, siempre a la vista, las motos que están en el lavadero: tocar una
 * abre su entrega.
 */
export default function Lavadero({ placaInicial, ahora, onIr, onAviso }) {
  const [modo, setModo] = useState(placaInicial ? 'entrega' : 'ingreso')
  const [seleccion, setSeleccion] = useState(placaInicial || null)
  const [tipos, setTipos] = useState(null)
  const [activos, setActivos] = useState([])
  const [entregados, setEntregados] = useState([])
  // Lavada recién ingresada, mientras se pregunta si se imprime su tiquete.
  const [porImprimir, setPorImprimir] = useState(null)

  const cargar = useCallback(async () => {
    const [enLavadero, deHoy] = await Promise.all([
      window.api.lavadero.activos(),
      window.api.lavadero.entregadosHoy()
    ])
    if (enLavadero.ok) setActivos(enLavadero.data)
    if (deHoy.ok) setEntregados(deHoy.data)
  }, [])

  useEffect(() => {
    cargar()
    const id = setInterval(cargar, 10000)
    return () => clearInterval(id)
  }, [cargar])

  // Al entrar a la vista: el catálogo pudo cambiar en Configuración.
  useEffect(() => {
    window.api.lavadero.tipos().then((res) => setTipos(res.ok ? res.data : []))
  }, [])

  // Llegada desde el escáner (tiquete de lavadero o placa que está aquí).
  useEffect(() => {
    if (!placaInicial) return
    setSeleccion(placaInicial)
    setModo('entrega')
  }, [placaInicial])

  function entregar(placa) {
    setSeleccion(placa)
    setModo('entrega')
  }

  async function responderTiquete(imprimir) {
    const lavado = porImprimir
    setPorImprimir(null)
    if (!imprimir) return

    const res = await window.api.impresora.tiqueteLavado(lavado.id)
    onAviso?.(
      res.ok && res.data?.ok
        ? { tipo: 'ok', texto: `Tiquete de ${lavado.placa} impreso` }
        : {
            tipo: 'error',
            texto: 'El tiquete no se imprimió',
            detalle: `${res.data?.motivo || res.error || 'Impresora no disponible'}. Reimprímalo desde Entregar y cobrar.`
          }
    )
  }

  async function reimprimirRecibo(lavado) {
    const res = await window.api.impresora.reciboLavado(lavado.id)
    onAviso?.(
      res.ok && res.data?.ok
        ? { tipo: 'ok', texto: `Recibo de ${lavado.placa} enviado a la impresora` }
        : { tipo: 'error', texto: 'No se pudo imprimir', detalle: res.data?.motivo || res.error }
    )
    cargar()
  }

  return (
    <div className="h-full grid grid-cols-[minmax(0,1fr)_300px] gap-4 p-5 overflow-hidden">
      <div className="min-h-0 overflow-y-auto">
        <div
          role="tablist"
          aria-label="Lavadero"
          className="mx-auto mb-4 flex w-fit gap-1 rounded-campo border border-linea bg-blanco p-1"
        >
          {MODOS.map((m) => {
            const activo = modo === m.id
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={activo}
                onClick={() => setModo(m.id)}
                className={`flex items-center gap-2 rounded-[7px] px-3.5 py-1.5 text-base font-medium
                  transition-colors duration-rapido ease-salida
                  ${activo ? 'bg-azul-50 text-azul-700' : 'text-grafito hover:bg-lienzo hover:text-tinta'}`}
              >
                <Icono nombre={m.icono} tam={16} />
                {m.etiqueta}
              </button>
            )
          })}
        </div>

        {modo === 'ingreso' ? (
          <IngresoLavado
            tipos={tipos}
            bloqueado={Boolean(porImprimir)}
            onCrearTipos={() => onIr?.('ajustes', 'lavadas')}
            onError={(texto) => onAviso?.({ tipo: 'error', texto })}
            onIngresado={(lavado) => {
              setPorImprimir(lavado)
              cargar()
            }}
          />
        ) : (
          <EntregaLavado
            seleccion={seleccion}
            ahora={ahora}
            onSeleccionar={setSeleccion}
            onAviso={onAviso}
            onEntregado={({ lavado }) => {
              onAviso?.({ tipo: 'ok', texto: `${lavado.placa} entregada · ${cop(lavado.monto)}` })
              cargar()
            }}
          />
        )}
      </div>

      {/* ---- Las motos del lavadero ---- */}
      <aside className="flex flex-col gap-3 min-h-0">
        <section className="panel flex flex-col min-h-0 flex-1 overflow-hidden">
          <h2 className="panel-titulo px-3 pt-3 pb-2 flex items-baseline justify-between">
            <span>En el lavadero</span>
            <span className="num text-niebla">{activos.length}</span>
          </h2>

          <div className="flex-1 overflow-y-auto">
            {activos.length === 0 ? (
              <p className="px-3 py-8 text-center text-mini text-niebla">
                No hay motos en el lavadero.
              </p>
            ) : (
              activos.map((l) => {
                const elegida = modo === 'entrega' && seleccion === l.placa
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => entregar(l.placa)}
                    className={`relative block w-full border-b border-linea px-3 py-2.5 text-left
                      transition-colors duration-rapido last:border-b-0
                      ${elegida ? 'bg-azul-50' : 'hover:bg-lienzo'}`}
                  >
                    {elegida && <span className="absolute left-0 inset-y-0 w-[3px] bg-azul" />}
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="placa text-base">{l.placa}</span>
                      <span className="text-micro text-grafito num">
                        {transcurridoCorto(l.hora_entrada, ahora)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-micro text-grafito">
                      <span className="truncate">{l.tipo_lavada}</span>
                      <span className="text-niebla">·</span>
                      <span className="num shrink-0">{cop(l.precio)}</span>
                      {Boolean(l.casco) && (
                        <span
                          className="ml-auto flex items-center gap-1 shrink-0 num"
                          title={l.locker ? `Casco en el locker ${l.locker}` : 'Casco en custodia'}
                        >
                          <Icono nombre="casco" tam={13} />
                          {l.locker}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </section>

        {entregados.length > 0 && (
          <section className="panel flex flex-col max-h-[40%] overflow-hidden">
            <h2 className="panel-titulo px-3 pt-3 pb-2 flex items-baseline justify-between">
              <span>Entregadas hoy</span>
              <span className="num text-niebla">{entregados.length}</span>
            </h2>
            <div className="overflow-y-auto">
              {entregados.map((l) => (
                <div key={l.id} className="fila py-2">
                  <span className="placa text-mini flex-1 text-grafito">{l.placa}</span>
                  <span className="text-micro text-niebla num">{hora(l.hora_entrega)}</span>
                  <span className="text-micro font-medium num w-16 text-right">{cop(l.monto)}</span>
                  <button
                    type="button"
                    onClick={() => reimprimirRecibo(l)}
                    title={l.impreso ? 'Imprimir copia del recibo' : 'Imprimir el recibo'}
                    aria-label={`Imprimir el recibo de ${l.placa}`}
                    className="rounded-md p-1 text-niebla transition-colors duration-rapido
                               hover:bg-lienzo hover:text-tinta"
                  >
                    <Icono nombre="impresora" tam={14} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </aside>

      {porImprimir && <PreguntaTiquete lavado={porImprimir} onResponder={responderTiquete} />}
    </div>
  )
}

/**
 * La pregunta que sigue a cada ingreso. El botón de imprimir arranca con el
 * foco: Enter imprime y Esc sigue sin papel.
 */
function PreguntaTiquete({ lavado, onResponder }) {
  useEffect(() => {
    const alTeclear = (e) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onResponder(false)
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [onResponder])

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-tinta/30 p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pregunta-tiquete"
    >
      <div className="panel w-full max-w-sm p-5 shadow-lg">
        <p className="flex items-center gap-1.5 text-micro font-medium text-azul-700">
          <Icono nombre="visto" tam={14} />
          Moto ingresada al lavadero
        </p>
        <p className="placa text-dato mt-1.5">{lavado.placa}</p>
        <p className="mt-0.5 text-mini text-grafito">
          {lavado.tipo_lavada} · <span className="num">{cop(lavado.precio)}</span>
          {Boolean(lavado.casco) && (lavado.locker ? ` · casco en el locker ${lavado.locker}` : ' · casco en custodia')}
        </p>

        <h2 id="pregunta-tiquete" className="text-titulo font-medium mt-4">
          ¿Imprimir el tiquete de ingreso?
        </h2>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onResponder(false)} className="btn-neutro">
            No imprimir
          </button>
          <button type="button" autoFocus onClick={() => onResponder(true)} className="btn-azul">
            <Icono nombre="impresora" tam={16} />
            Imprimir
          </button>
        </div>
        <p className="mt-3 text-center text-micro text-niebla">Enter imprime · Esc no imprime</p>
      </div>
    </div>
  )
}
