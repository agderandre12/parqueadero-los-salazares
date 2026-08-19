import { celda as fmtCelda, hora, transcurridoCorto, transcurrido } from '../lib/format.js'

/*
 * Mapa de celdas.
 *
 * La ocupación no se lee por color sino por peso: la celda ocupada es un bloque
 * oscuro con la placa en blanco, la libre es apenas un contorno con su número.
 * De un vistazo, el parqueadero lleno se ve denso y el vacío se ve claro, sin
 * gastar el azul (que está reservado para acciones) ni recurrir a un semáforo
 * rojo/verde que a esta escala se vuelve ruido.
 */
export default function CeldasGrid({ celdas, sinCelda = [], ahora, onSeleccionar }) {
  return (
    <div>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(66px, 1fr))' }}
      >
        {celdas.map((c) => {
          if (!c.ocupada) {
            return (
              <div
                key={c.numero}
                title={`Celda ${fmtCelda(c.numero)} · libre`}
                className="aspect-[5/4] rounded-lg border border-dashed border-linea-fuerte
                           flex items-end p-1.5 text-micro font-medium text-niebla num"
              >
                {fmtCelda(c.numero)}
              </div>
            )
          }

          return (
            <button
              key={c.numero}
              type="button"
              onClick={() => onSeleccionar?.(c.placa)}
              title={`${c.placa} · entró ${hora(c.horaEntrada)} · ${transcurrido(c.horaEntrada, ahora)}`}
              className="group relative aspect-[5/4] rounded-lg bg-tinta-800 p-1.5
                         flex flex-col justify-between text-left text-blanco
                         transition-colors duration-rapido ease-salida
                         hover:bg-tinta focus-visible:ring-offset-blanco"
            >
              <span className="text-micro font-medium text-humo num">{fmtCelda(c.numero)}</span>
              <span>
                <span className="block placa text-mini leading-tight">{c.placa}</span>
                <span className="block text-micro text-humo num leading-tight">
                  {transcurridoCorto(c.horaEntrada, ahora)}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {sinCelda.length > 0 && (
        <div className="mt-3 rounded-campo border border-linea bg-lienzo p-3">
          <p className="text-micro font-medium text-grafito mb-2">
            Adentro sin celda asignada ({sinCelda.length}) — el parqueadero estaba lleno al ingresar
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sinCelda.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => onSeleccionar?.(v.placa)}
                className="placa text-mini rounded-md border border-linea-fuerte bg-blanco
                           px-2 py-1 transition-colors duration-rapido hover:border-azul hover:text-azul-700"
              >
                {v.placa}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
