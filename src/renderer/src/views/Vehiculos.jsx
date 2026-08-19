import { useCallback, useEffect, useState } from 'react'
import Icono from '../components/Icono.jsx'
import {
  celda as fmtCelda,
  cop,
  fecha,
  hora,
  isoLocal,
  transcurridoCorto,
  ETIQUETA_TARIFA
} from '../lib/format.js'

const FILTROS = [
  { id: 'activo', etiqueta: 'Adentro' },
  { id: 'finalizado', etiqueta: 'Salieron' },
  { id: 'todos', etiqueta: 'Todos' }
]

export default function Vehiculos({ ahora, placaInicial, onSalida, onAviso }) {
  const [texto, setTexto] = useState('')
  const [estado, setEstado] = useState('activo')
  const [soloHoy, setSoloHoy] = useState(false)
  const [lista, setLista] = useState([])
  const [cargando, setCargando] = useState(true)
  const [seleccion, setSeleccion] = useState(placaInicial || null)
  const [ficha, setFicha] = useState(null)

  const consultar = useCallback(async () => {
    setCargando(true)
    const res = await window.api.vehiculos.historial({
      texto,
      estado,
      desde: soloHoy ? isoLocal(new Date()) : null,
      limite: 300
    })
    setLista(res.ok ? res.data : [])
    setCargando(false)
  }, [texto, estado, soloHoy])

  useEffect(() => {
    const id = setTimeout(consultar, 140)
    return () => clearTimeout(id)
  }, [consultar])

  // Ficha del seleccionado
  useEffect(() => {
    if (!seleccion) {
      setFicha(null)
      return
    }
    let cancelado = false
    window.api.vehiculos.ficha(seleccion).then((res) => {
      if (!cancelado) setFicha(res.ok ? res.data : null)
    })
    return () => {
      cancelado = true
    }
  }, [seleccion])

  // Selecciona el primero automáticamente para que el panel nunca esté vacío.
  useEffect(() => {
    if (!seleccion && lista.length > 0) setSeleccion(lista[0].placa)
  }, [lista, seleccion])

  async function reimprimir() {
    const id = ficha?.ultimaTransaccion?.id
    if (!id) return
    const res = await window.api.impresora.reimprimir(id)
    onAviso?.(
      res.ok && res.data?.ok
        ? { tipo: 'ok', texto: 'Copia enviada a la impresora' }
        : { tipo: 'error', texto: 'No se pudo imprimir', detalle: res.data?.motivo || res.error }
    )
  }

  return (
    <div className="h-full flex flex-col gap-3 p-5 overflow-hidden">
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="relative flex-1 max-w-md">
          <Icono
            nombre="buscar"
            tam={17}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-niebla"
          />
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value.toUpperCase())}
            placeholder="Buscar placa, marca o color"
            autoComplete="off"
            spellCheck={false}
            className="campo pl-9"
          />
        </div>

        <div className="flex gap-1" role="group" aria-label="Filtrar por estado">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={estado === f.id}
              onClick={() => setEstado(f.id)}
              className={estado === f.id ? 'chip-activo' : 'chip hover:border-linea-fuerte'}
            >
              {f.etiqueta}
            </button>
          ))}
        </div>

        <button
          type="button"
          aria-pressed={soloHoy}
          onClick={() => setSoloHoy((v) => !v)}
          className={soloHoy ? 'chip-activo' : 'chip hover:border-linea-fuerte'}
        >
          <Icono nombre="calendario" tam={14} />
          Hoy
        </button>

        <span className="ml-auto text-mini text-niebla num">
          {cargando ? 'Buscando…' : `${lista.length} registros`}
        </span>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_296px] gap-4">
        {/* ---- Lista ---- */}
        <section className="panel flex flex-col min-h-0 overflow-hidden">
          <div
            className="grid grid-cols-[1fr_58px_86px_78px_78px] gap-3 px-3 py-2.5
                       border-b border-linea text-micro font-medium text-grafito shrink-0"
          >
            <span>Placa</span>
            <span>Celda</span>
            <span>Entró</span>
            <span>Tiempo</span>
            <span className="text-right">Cobrado</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {!cargando && lista.length === 0 && (
              <p className="px-3 py-12 text-center text-mini text-niebla">
                Ningún vehículo coincide con esa búsqueda.
              </p>
            )}

            {lista.map((v) => {
              const activo = v.estado === 'activo'
              const elegido = seleccion === v.placa
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSeleccion(v.placa)}
                  className={`relative grid w-full grid-cols-[1fr_58px_86px_78px_78px] gap-3
                    items-center px-3 py-2.5 text-left border-b border-linea
                    transition-colors duration-rapido
                    ${elegido ? 'bg-azul-50' : 'hover:bg-lienzo'}`}
                >
                  {elegido && <span className="absolute left-0 inset-y-0 w-[3px] bg-azul" />}
                  <span className={`placa text-base ${activo ? '' : 'text-grafito'}`}>
                    {v.placa}
                  </span>
                  <span className="text-mini text-grafito num">{fmtCelda(v.celda)}</span>
                  <span className="text-mini text-grafito num">{hora(v.hora_entrada)}</span>
                  <span className="text-mini num">
                    {activo ? (
                      transcurridoCorto(v.hora_entrada, ahora)
                    ) : (
                      <span className="text-niebla">{fecha(v.hora_entrada)}</span>
                    )}
                  </span>
                  <span className="text-mini text-right num">
                    {activo ? (
                      <span className="text-azul-700 font-medium">adentro</span>
                    ) : (
                      <span className="text-grafito">{hora(v.hora_salida)}</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {/* ---- Ficha ---- */}
        <aside className="panel p-5 overflow-y-auto">
          {!ficha?.vehicle ? (
            <p className="py-10 text-center text-mini text-niebla">
              Elija un vehículo para ver su historial.
            </p>
          ) : (
            <>
              <p className="placa text-dato">{ficha.vehicle.placa}</p>
              <p className="mt-1.5">
                {ficha.activo ? (
                  <span className="chip-activo">
                    Adentro · celda {fmtCelda(ficha.vehicle.celda)}
                  </span>
                ) : (
                  <span className="chip">Salió el {fecha(ficha.vehicle.hora_salida)}</span>
                )}
              </p>

              <dl className="mt-5 space-y-2.5 text-base">
                <Dato termino="Marca" valor={ficha.vehicle.marca || '—'} />
                <Dato termino="Color" valor={ficha.vehicle.color || '—'} />
                <Dato termino="Casco" valor={ficha.vehicle.casco ? 'Sí' : 'No'} />
                <Dato
                  termino="Tarifa"
                  valor={ETIQUETA_TARIFA[ficha.vehicle.tipo_tarifa] || ficha.vehicle.tipo_tarifa}
                />
                <Dato termino="Visitas" valor={ficha.resumen.visitas} num />
                <Dato termino="Cobro acumulado" valor={cop(ficha.resumen.totalCobrado)} num />
                {ficha.resumen.primeraVisita && (
                  <Dato termino="Cliente desde" valor={fecha(ficha.resumen.primeraVisita)} num />
                )}
              </dl>

              <div className="mt-5 pt-4 border-t border-linea space-y-2">
                {ficha.activo && (
                  <button
                    type="button"
                    onClick={() => onSalida?.(ficha.vehicle.placa)}
                    className="btn-azul w-full"
                  >
                    <Icono nombre="salida" tam={16} />
                    Registrar salida
                  </button>
                )}
                <button
                  type="button"
                  onClick={reimprimir}
                  disabled={!ficha.ultimaTransaccion}
                  className="btn-neutro w-full"
                >
                  <Icono nombre="impresora" tam={16} />
                  {ficha.ultimaTransaccion ? 'Reimprimir último recibo' : 'Sin recibos todavía'}
                </button>
              </div>

              {ficha.visitas.length > 1 && (
                <div className="mt-5">
                  <h3 className="panel-titulo mb-2">Visitas anteriores</h3>
                  <ul className="space-y-1.5">
                    {ficha.visitas.slice(0, 8).map((v) => (
                      <li
                        key={v.id}
                        className="flex justify-between text-mini text-grafito num"
                      >
                        <span>{fecha(v.hora_entrada)}</span>
                        <span>
                          {hora(v.hora_entrada)}
                          {v.hora_salida && ` → ${hora(v.hora_salida)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

function Dato({ termino, valor, num = false }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-grafito">{termino}</dt>
      <dd className={`font-medium text-right ${num ? 'num' : ''}`}>{valor}</dd>
    </div>
  )
}
