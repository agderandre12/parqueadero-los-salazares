import { useEffect, useState } from 'react'
import Icono from './Icono.jsx'
import { cop } from '../lib/format.js'

// Lo que mueve el cobro por hora; el resto de la configuración no lo toca.
const CAMPOS = ['tarifa_hora', 'tarifa_amanecida', 'minutos_gracia', 'horas_tope_dia', 'tramos_hora']

/**
 * Cuánto paga una moto por hora con los valores que están en pantalla, antes
 * de guardarlos. Lo calcula el proceso principal con la misma función que
 * cobra (`precios:simular`): lo que se ve aquí es exactamente lo que se cobrará.
 */
export default function SimulacionCobro({ form, sinGuardar }) {
  const [filas, setFilas] = useState([])
  const [error, setError] = useState(null)
  const borrador = JSON.stringify(Object.fromEntries(CAMPOS.map((c) => [c, form[c]])))

  useEffect(() => {
    let vigente = true
    const id = setTimeout(async () => {
      const res = await window.api.precios.simular(JSON.parse(borrador))
      if (!vigente) return
      if (res.ok) {
        setFilas(res.data)
        setError(null)
      } else {
        setError(res.error)
      }
    }, 180)
    return () => {
      vigente = false
      clearTimeout(id)
    }
  }, [borrador])

  // Una regla por encima del tope no se cobra nunca: si no se dice, parece que
  // las reglas no funcionan.
  const topadas = [
    ...new Map(
      filas.filter((f) => f.tramoTopado).map((f) => [f.tramoTopado.desde, f])
    ).values()
  ]
  const baja = filas.find((f, i) => i > 0 && f.total < filas[i - 1].total)

  return (
    <section className="panel overflow-hidden mt-4">
      <div className="flex items-baseline justify-between gap-4 px-4 pt-3.5 pb-2.5">
        <h3 className="panel-titulo">Así queda el cobro por hora</h3>
        <span className={`text-micro ${sinGuardar ? 'text-alerta font-medium' : 'text-niebla'}`}>
          {sinGuardar
            ? 'Sin guardar: los cobros siguen con los precios anteriores'
            : 'Son los precios que se están cobrando'}
        </span>
      </div>

      {error ? (
        <p
          role="alert"
          className="mx-4 mb-4 flex items-start gap-2 rounded-campo border border-alerta/40
                     bg-alerta-50 px-3 py-2.5 text-mini text-alerta"
        >
          <Icono nombre="alerta" tam={15} />
          {error}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-6 gap-1.5 px-4">
            {filas.map((f) => (
              <div
                key={f.horas}
                className={`rounded-lg border px-2 py-1.5
                  ${f.tramo ? 'border-azul-200 bg-azul-50' : f.tope ? 'border-linea bg-lienzo' : 'border-linea'}`}
              >
                <div className="text-micro text-grafito num">{f.horas} h</div>
                <div
                  className={`text-mini font-medium num ${f.tramo ? 'text-azul-700' : 'text-tinta'}`}
                >
                  {cop(f.total)}
                </div>
              </div>
            ))}
          </div>

          {(topadas.length > 0 || baja) && (
            <ul className="mx-4 mt-2.5 space-y-1 rounded-campo border border-alerta/40 bg-alerta-50 px-3 py-2.5 text-mini text-alerta">
              {topadas.map(({ tramoTopado: t, total }) => (
                <li key={t.desde} className="flex items-start gap-2">
                  <Icono nombre="alerta" tam={15} />
                  La regla de {t.desde} a {t.hasta} h vale {cop(t.valor)}, más que el tope de la
                  amanecida ({cop(total)}): en esas horas se cobra el tope. Para que se aplique,
                  suba la amanecida o baje la regla.
                </li>
              ))}
              {baja && (
                <li className="flex items-start gap-2">
                  <Icono nombre="alerta" tam={15} />
                  Quedarse más sale más barato: {baja.horas - 1} h cuestan{' '}
                  {cop(filas[baja.horas - 2].total)} y {baja.horas} h cuestan {cop(baja.total)}.
                </li>
              )}
            </ul>
          )}

          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-2.5 pb-3.5 text-micro text-niebla">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm border border-azul-200 bg-azul-50" />
              Regla por tiempo
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm border border-linea bg-lienzo" />
              Tope de la amanecida
            </span>
            <span>La hora empezada se cobra completa.</span>
          </p>
        </>
      )}
    </section>
  )
}
