import { useCallback, useEffect, useState } from 'react'
import Icono from './Icono.jsx'
import { cop, diaCorto, fecha as fmtFecha, miles } from '../lib/format.js'

/*
 * Analítica de ventas del administrador: día, semana en curso y mes en curso,
 * siempre en pesos y siempre partidas en efectivo / transferencia. La partición
 * no es decorativa: es la que explica por qué el cajón tiene menos dinero que
 * las ventas totales.
 */

const PERIODOS = [
  { id: 'dia', etiqueta: 'Ventas del día', ayuda: 'Hoy' },
  { id: 'semana', etiqueta: 'Ventas de la semana', ayuda: 'Desde el lunes' },
  { id: 'mes', etiqueta: 'Ventas del mes', ayuda: 'Desde el día 1' }
]

function Tarjeta({ etiqueta, ayuda, datos, destacada }) {
  const total = datos?.total ?? 0
  const efectivo = datos?.efectivo ?? 0
  const transferencia = datos?.transferencia ?? 0
  const proporcion = total > 0 ? efectivo / total : 0

  return (
    <section
      className={`panel p-4 ${destacada ? 'border-azul-200 bg-azul-50/40' : ''}`}
      aria-label={etiqueta}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-micro font-medium text-grafito">{etiqueta}</h3>
        <span className="text-micro text-niebla">{ayuda}</span>
      </div>

      <div className="text-dato font-semibold num tracking-tight mt-1">{cop(total)}</div>
      <p className="text-micro text-niebla num mt-0.5">
        {miles(datos?.operaciones ?? 0)} {datos?.operaciones === 1 ? 'cobro' : 'cobros'}
      </p>

      {/* Una sola barra: cuánto del periodo entró en billetes y cuánto no. */}
      <div className="mt-3 h-1 rounded-full bg-linea overflow-hidden" aria-hidden="true">
        <div
          className="h-full rounded-full bg-azul transition-[width] duration-500 ease-salida"
          style={{ width: `${Math.round(proporcion * 100)}%` }}
        />
      </div>

      <dl className="mt-2.5 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-1.5 text-mini text-grafito">
            <Icono nombre="efectivo" tam={14} className="text-azul-700" />
            Efectivo
          </dt>
          <dd className="text-mini font-medium num">{cop(efectivo)}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-1.5 text-mini text-grafito">
            <Icono nombre="transferencia" tam={14} className="text-niebla" />
            Transferencia
          </dt>
          <dd className="text-mini font-medium num">{cop(transferencia)}</dd>
        </div>
      </dl>
    </section>
  )
}

/** Tendencia diaria del mes. Sin ejes: sólo la forma y el máximo rotulado. */
function Tendencia({ serie }) {
  if (!serie?.length) {
    return (
      <p className="px-4 py-8 text-center text-mini text-niebla">
        Todavía no hay cobros registrados este mes.
      </p>
    )
  }

  const maximo = Math.max(...serie.map((d) => d.total), 1)

  return (
    <div className="px-4 pb-4">
      <div className="flex items-end gap-1 h-24" role="img" aria-label="Ventas por día del mes">
        {serie.map((d) => (
          <div key={d.dia} className="flex-1 min-w-0 flex flex-col justify-end h-full group relative">
            <div
              className="w-full rounded-t-[3px] bg-azul-200 group-hover:bg-azul transition-colors duration-rapido"
              style={{ height: `${Math.max(3, Math.round((d.total / maximo) * 100))}%` }}
            />
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1
                         whitespace-nowrap rounded-md bg-tinta px-2 py-1 text-micro text-blanco
                         opacity-0 shadow-lg transition-opacity duration-rapido
                         group-hover:opacity-100 z-20 num"
            >
              {diaCorto(d.dia)} · {cop(d.total)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex justify-between mt-1.5 text-micro text-niebla num">
        <span>{diaCorto(serie[0].dia)}</span>
        <span>Máximo {cop(maximo)}</span>
        <span>{diaCorto(serie[serie.length - 1].dia)}</span>
      </div>
    </div>
  )
}

export default function PanelVentas({ onAviso }) {
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    const res = await window.api.metricas.ventas()
    setCargando(false)
    if (res.ok) setDatos(res.data)
    else onAviso?.({ tipo: 'error', texto: 'No se pudieron leer las ventas', detalle: res.error })
  }, [onAviso])

  // 15 s: son cifras de consulta, no de operación; refrescarlas más rápido
  // sólo haría bailar los números mientras el administrador los lee.
  useEffect(() => {
    cargar()
    const id = setInterval(cargar, 15000)
    return () => clearInterval(id)
  }, [cargar])

  if (cargando && !datos) {
    return <p className="p-8 text-mini text-niebla">Calculando ventas…</p>
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {PERIODOS.map((p, i) => (
          <Tarjeta
            key={p.id}
            etiqueta={p.etiqueta}
            ayuda={p.ayuda}
            datos={datos?.[p.id]}
            destacada={i === 0}
          />
        ))}
      </div>

      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-3">
          <h3 className="panel-titulo">Ventas por día del mes</h3>
          <button type="button" onClick={cargar} className="btn-fantasma text-mini py-1.5 px-2.5">
            <Icono nombre="refrescar" tam={14} />
            Actualizar
          </button>
        </div>
        <Tendencia serie={datos?.serieMes} />
      </section>

      <p className="text-micro text-niebla px-1">
        Periodo del mes: {fmtFecha(datos?.mes?.desde)} al {fmtFecha(datos?.mes?.hasta)}. Las
        transferencias cuentan como venta pero no aumentan el dinero en caja.
      </p>
    </div>
  )
}
