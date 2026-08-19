import CeldasGrid from '../components/CeldasGrid.jsx'
import Icono from '../components/Icono.jsx'
import { cop, fechaLarga, hora, transcurridoCorto } from '../lib/format.js'

function Cifra({ etiqueta, valor }) {
  return (
    <div>
      <div className="text-micro font-medium text-grafito">{etiqueta}</div>
      <div className="text-dato font-semibold num mt-0.5">{valor}</div>
    </div>
  )
}

export default function Panel({ stats, celdas, sinCelda, ultimos, ahora, onIr, onSalida }) {
  const ocupacion = stats.totalCeldas > 0 ? stats.ocupadas / stats.totalCeldas : 0
  const lleno = stats.disponibles === 0

  return (
    <div className="h-full grid grid-cols-[minmax(0,1fr)_248px] gap-4 p-5 overflow-hidden">
      <section className="panel flex flex-col min-h-0 overflow-hidden">
        <header className="flex items-end justify-between gap-6 p-5 pb-4">
          <div>
            <div className="flex items-baseline gap-2.5">
              <span className="text-cifra font-semibold num tracking-tight">
                {stats.disponibles}
              </span>
              <span className="text-cuerpo text-grafito">
                {stats.disponibles === 1 ? 'celda libre' : 'celdas libres'} de{' '}
                <span className="num">{stats.totalCeldas}</span>
              </span>
            </div>

            <div
              className="mt-3 h-1 w-72 rounded-full bg-linea overflow-hidden"
              role="img"
              aria-label={`${stats.ocupadas} de ${stats.totalCeldas} celdas ocupadas`}
            >
              <div
                className={`h-full rounded-full transition-[width] duration-500 ease-salida
                  ${lleno ? 'bg-alerta' : 'bg-tinta'}`}
                style={{ width: `${Math.round(ocupacion * 100)}%` }}
              />
            </div>

            <p className="text-mini text-niebla mt-2 first-letter:uppercase">{fechaLarga(ahora)}</p>
          </div>

          <div className="flex gap-7 text-right shrink-0">
            <Cifra etiqueta="Entradas hoy" valor={stats.entradasHoy} />
            <Cifra etiqueta="Salidas hoy" valor={stats.salidasHoy} />
            <Cifra etiqueta="Recaudo hoy" valor={cop(stats.recaudoHoy)} />
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-5">
          <CeldasGrid
            celdas={celdas}
            sinCelda={sinCelda}
            ahora={ahora}
            onSeleccionar={onSalida}
          />
        </div>
      </section>

      <aside className="flex flex-col gap-2.5 min-h-0">
        <button type="button" onClick={() => onIr('entrada')} className="btn-azul py-3">
          <Icono nombre="mas" tam={17} />
          Nueva entrada
        </button>
        <button type="button" onClick={() => onIr('salida')} className="btn-neutro py-3">
          <Icono nombre="salida" tam={17} />
          Registrar salida
        </button>

        <section className="panel flex flex-col min-h-0 mt-1.5 overflow-hidden">
          <h2 className="panel-titulo px-3 pt-3 pb-2">Movimiento reciente</h2>

          <div className="flex-1 overflow-y-auto">
            {ultimos.length === 0 ? (
              <p className="px-3 py-8 text-center text-mini text-niebla">
                Todavía no hay movimientos. Registre la primera entrada del día.
              </p>
            ) : (
              ultimos.map((v) => {
                const activo = v.estado === 'activo'
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={!activo}
                    onClick={() => onSalida?.(v.placa)}
                    className="fila w-full text-left transition-colors duration-rapido
                               enabled:hover:bg-lienzo disabled:cursor-default"
                  >
                    <span className={`placa text-mini flex-1 ${activo ? '' : 'text-niebla'}`}>
                      {v.placa}
                    </span>
                    {activo ? (
                      <span className="text-micro text-grafito num">
                        {transcurridoCorto(v.hora_entrada, ahora)}
                      </span>
                    ) : (
                      <span className="text-micro text-niebla num">{hora(v.hora_salida)}</span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </section>
      </aside>
    </div>
  )
}
