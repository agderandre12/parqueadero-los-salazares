import { useCallback, useEffect, useState } from 'react'
import Icono from './Icono.jsx'
import { cop, fecha as fmtFecha, isoLocal, miles, parseSql } from '../lib/format.js'

/*
 * Analítica de ventas del administrador: día, semana en curso y mes en curso,
 * siempre en pesos y siempre partidas en efectivo / transferencia. La partición
 * no es decorativa: es la que explica por qué el cajón tiene menos dinero que
 * las ventas totales. Incluyen el lavadero, que además se informa aparte.
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
        {datos?.lavadero > 0 && <> · lavadero {cop(datos.lavadero)}</>}
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

/**
 * Todos los días del periodo, también los que no tuvieron cobros: si se
 * saltaran, la gráfica juntaría fechas sin avisar y parecería que no pasó el
 * tiempo.
 */
function diasDelPeriodo(serie, desde, hasta) {
  if (!desde || !hasta) return []
  const porDia = new Map((serie || []).map((d) => [d.dia, d]))
  const fin = parseSql(hasta)
  const dias = []
  for (let d = parseSql(desde); d <= fin; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const iso = isoLocal(d)
    dias.push(porDia.get(iso) ?? { dia: iso, efectivo: 0, transferencia: 0, total: 0 })
  }
  return dias
}

/** Total del periodo entre los días que lleva (los días sin cobros cuentan). */
function promedioDiario(periodo) {
  if (!periodo?.desde || !periodo?.hasta) return 0
  const dias = Math.round((parseSql(periodo.hasta) - parseSql(periodo.desde)) / 86400000) + 1
  return Math.round((periodo.total || 0) / Math.max(1, dias))
}

/** 'mié, 28/10' para la etiqueta emergente de cada día. */
const diaSemana = (iso) =>
  parseSql(iso).toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: '2-digit' })

/** Último día del mes de una fecha 'YYYY-MM-DD'. */
const finDeMes = (iso) => {
  const d = parseSql(iso)
  return isoLocal(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

/**
 * Ventas de cada día del mes. Cada barra se parte como las tarjetas: efectivo
 * abajo, transferencia arriba. La escala sólo rotula el máximo y el cero, y la
 * línea punteada es el promedio diario: con eso se lee si un día estuvo flojo o
 * bueno sin llenar la gráfica de números.
 *
 * El eje es el mes completo, también los días que faltan: si sólo llegara a
 * hoy, el día 2 del mes serían dos barras de media pantalla cada una.
 */
function Tendencia({ serie, desde, hasta }) {
  const dias = diasDelPeriodo(serie, desde, hasta && finDeMes(hasta))
  if (!dias.some((d) => d.total > 0)) {
    return (
      <p className="px-4 py-8 text-center text-mini text-niebla">
        Todavía no hay cobros registrados este mes.
      </p>
    )
  }

  const maximo = Math.max(...dias.map((d) => d.total), 1)
  const promedio = promedioDiario({ desde, hasta, total: dias.reduce((suma, d) => suma + d.total, 0) })
  const alto = (valor) => `${(valor / maximo) * 100}%`
  // El promedio es de los días que van: su línea termina en la barra de hoy.
  // Cada barra mide (100% − huecos) / n, así que lo que sobra a la derecha es
  // (100% + 3px) × faltan / n.
  const faltan = dias.filter((d) => d.dia > hasta).length

  return (
    <div className="px-4 pb-4">
      <div className="flex gap-2">
        <div className="flex h-40 w-16 shrink-0 flex-col justify-between text-right text-micro text-niebla num">
          <span className="-mt-1.5">{cop(maximo)}</span>
          <span className="-mb-1.5">{cop(0)}</span>
        </div>

        <div className="relative min-w-0 flex-1">
          <div
            className="relative flex h-40 items-end gap-[3px] border-b border-linea-fuerte"
            role="img"
            aria-label={`Ventas por día del mes. Máximo ${cop(maximo)}, promedio ${cop(promedio)} por día`}
          >
            <div
              className="pointer-events-none absolute left-0 z-10 border-t border-dashed border-tinta/45"
              style={{
                bottom: alto(promedio),
                right: `calc((100% + 3px) * ${faltan / dias.length})`
              }}
            />
            {dias.map((d, i) => {
              if (d.dia > hasta) return <div key={d.dia} className="min-w-0 flex-1" />
              // La etiqueta se ancla al borde en las primeras y últimas barras
              // para que no se salga del panel.
              const ancla =
                i < 4 ? 'left-0' : i > dias.length - 5 ? 'right-0' : 'left-1/2 -translate-x-1/2'
              return (
                <div
                  key={d.dia}
                  className="group relative flex h-full min-w-0 flex-1 flex-col justify-end rounded-t-[3px]
                             transition-colors duration-rapido hover:bg-lienzo"
                >
                  {d.transferencia > 0 && (
                    <div
                      className="w-full rounded-t-[3px] bg-azul-200"
                      style={{ height: alto(d.transferencia) }}
                    />
                  )}
                  {d.efectivo > 0 && (
                    <div
                      className={`w-full bg-azul ${d.transferencia > 0 ? '' : 'rounded-t-[3px]'}`}
                      style={{ height: alto(d.efectivo) }}
                    />
                  )}
                  <span
                    role="tooltip"
                    className={`pointer-events-none absolute bottom-full ${ancla} z-20 mb-1
                               whitespace-nowrap rounded-md bg-tinta px-2 py-1 text-micro text-blanco
                               opacity-0 shadow-lg transition-opacity duration-rapido
                               group-hover:opacity-100 num`}
                  >
                    <b className="font-medium">
                      {diaSemana(d.dia)} · {cop(d.total)}
                    </b>
                    <span className="block text-humo">
                      Efectivo {cop(d.efectivo)} · Transferencia {cop(d.transferencia)}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>

          <div className="mt-1.5 flex gap-[3px]">
            {dias.map((d) => (
              <span
                key={d.dia}
                className={`min-w-0 flex-1 text-center text-micro num
                  ${d.dia === hasta ? 'font-semibold text-tinta' : 'text-niebla'}`}
              >
                {Number(d.dia.slice(8))}
              </span>
            ))}
          </div>
        </div>
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
          <div className="min-w-0">
            <h3 className="panel-titulo">Ventas por día del mes</h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-micro text-grafito">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-azul" />
                Efectivo
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-azul-200" />
                Transferencia
              </span>
              <span className="flex items-center gap-1.5 num">
                <span className="w-3.5 border-t border-dashed border-tinta/45" />
                Promedio {cop(promedioDiario(datos?.mes))} por día
              </span>
            </p>
          </div>
          <button type="button" onClick={cargar} className="btn-fantasma text-mini py-1.5 px-2.5 shrink-0">
            <Icono nombre="refrescar" tam={14} />
            Actualizar
          </button>
        </div>
        <Tendencia serie={datos?.serieMes} desde={datos?.mes?.desde} hasta={datos?.mes?.hasta} />
      </section>

      <p className="text-micro text-niebla px-1">
        Periodo del mes: {fmtFecha(datos?.mes?.desde)} al {fmtFecha(datos?.mes?.hasta)}. Las
        transferencias cuentan como venta pero no aumentan el dinero en caja.
      </p>
    </div>
  )
}
