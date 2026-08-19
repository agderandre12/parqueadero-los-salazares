import { useCallback, useEffect, useRef, useState } from 'react'
import Icono from '../components/Icono.jsx'
import {
  celda as fmtCelda,
  cop,
  fechaHora,
  hora,
  normalizarPlaca,
  transcurrido,
  ETIQUETA_TARIFA
} from '../lib/format.js'

/*
 * Registrar salida. Es una vista y no un modal: el escáner puede traer al
 * operario aquí en cualquier momento, y una ventana encima de otra ventana
 * complica lo que debería ser el gesto más frecuente del día.
 *
 * Fases: 'vacio' -> 'cargando' -> 'listo' -> 'cobrando' -> 'hecho'   (o 'error')
 */
export default function Salida({ placaInicial, ahora, onLiquidado, onAviso }) {
  const [texto, setTexto] = useState('')
  const [sugerencias, setSugerencias] = useState([])
  const [fase, setFase] = useState('vacio')
  const [error, setError] = useState(null)
  const [datos, setDatos] = useState(null) // { vehicle, settings, cobro }
  const [recibo, setRecibo] = useState(null)
  const [ticketPerdido, setTicketPerdido] = useState(false)
  const buscadorRef = useRef(null)

  const cargoTicket = datos?.settings?.cargo_ticket_perdido ?? 2000

  /** Cotiza una placa concreta y la deja lista para cobrar. */
  const cotizar = useCallback(async (placa, conRecargo) => {
    if (!placa) return
    setFase('cargando')
    setError(null)
    setRecibo(null)
    setSugerencias([])

    const res = await window.api.vehiculos.cotizar({ placa, ticketPerdido: conRecargo })
    if (res.ok) {
      setDatos(res.data)
      setTexto(res.data.vehicle.placa)
      setFase('listo')
    } else {
      setDatos(null)
      setError(res.error)
      setFase('error')
    }
  }, [])

  // Llegada desde el panel, la cuadrícula, la lista o el escáner.
  useEffect(() => {
    if (placaInicial) cotizar(placaInicial, false)
    else buscadorRef.current?.focus()
  }, [placaInicial, cotizar])

  // Recotiza al marcar ticket perdido: el recargo cambia el total.
  useEffect(() => {
    if (fase === 'listo' && datos?.vehicle) cotizar(datos.vehicle.placa, ticketPerdido)
    // Sólo debe dispararse al cambiar el interruptor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketPerdido])

  // Sugerencias mientras se digita.
  useEffect(() => {
    if (fase === 'listo' || fase === 'hecho') return
    let cancelado = false
    if (texto.length < 2) {
      setSugerencias([])
      return
    }
    const id = setTimeout(async () => {
      const res = await window.api.vehiculos.buscar(texto)
      if (!cancelado && res.ok) setSugerencias(res.data)
    }, 140)
    return () => {
      cancelado = true
      clearTimeout(id)
    }
  }, [texto, fase])

  const cobrar = useCallback(
    async (imprimir) => {
      if (fase !== 'listo' || !datos) return
      setFase('cobrando')

      const res = await window.api.vehiculos.liquidar({
        vehicleId: datos.vehicle.id,
        ticketPerdido
      })

      if (!res.ok) {
        setError(res.error)
        setFase('error')
        return
      }

      setRecibo(res.data)
      setFase('hecho')
      onLiquidado?.(res.data)

      // La liquidación ya intentó imprimir si la impresión automática está
      // activa. Este botón fuerza la copia cuando el operario la pidió y la
      // automática está apagada o falló.
      if (imprimir && !res.data.impresion?.ok) {
        const rei = await window.api.impresora.reimprimir(res.data.transaccion.id)
        if (!rei.ok || !rei.data?.ok) {
          onAviso?.({
            tipo: 'error',
            texto: 'Cobro guardado, pero el recibo no se imprimió',
            detalle: rei.data?.motivo || rei.error
          })
        }
      }
    },
    [fase, datos, ticketPerdido, onLiquidado, onAviso]
  )

  function limpiar() {
    setTexto('')
    setDatos(null)
    setRecibo(null)
    setError(null)
    setTicketPerdido(false)
    setFase('vacio')
    setTimeout(() => buscadorRef.current?.focus(), 0)
  }

  // Enter cobra; en el comprobante, Enter despeja para el siguiente cliente.
  useEffect(() => {
    const alTeclear = (e) => {
      if (e.key === 'Escape' && fase !== 'cobrando') return limpiar()
      if (e.key !== 'Enter') return
      if (fase === 'listo') {
        e.preventDefault()
        cobrar(true)
      } else if (fase === 'hecho') {
        e.preventDefault()
        limpiar()
      }
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [fase, cobrar])

  const cobro = fase === 'hecho' ? recibo?.cobro : datos?.cobro
  const vehiculo = fase === 'hecho' ? recibo?.vehicle : datos?.vehicle

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto w-full max-w-3xl grid grid-cols-[minmax(0,1fr)_290px] gap-4 items-start">
        {/* ---- Izquierda: identificación del vehículo ---- */}
        <div className="panel p-5">
          <label className="etiqueta" htmlFor="buscar-placa">
            Placa
          </label>

          <div className="relative">
            <input
              id="buscar-placa"
              ref={buscadorRef}
              data-escaner="local"
              value={texto}
              disabled={fase === 'cobrando' || fase === 'hecho'}
              onChange={(e) => {
                setTexto(normalizarPlaca(e.target.value))
                if (fase === 'listo' || fase === 'error') {
                  setFase('vacio')
                  setDatos(null)
                  setError(null)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && fase !== 'listo' && fase !== 'hecho') {
                  e.preventDefault()
                  cotizar(sugerencias.length === 1 ? sugerencias[0].placa : texto, ticketPerdido)
                }
              }}
              placeholder="ABC12D"
              autoComplete="off"
              spellCheck={false}
              className="campo-placa"
            />

            {/* Sólo mientras se está buscando: en 'listo' y 'hecho' el campo ya
                está resuelto y la lista quedaría flotando sobre el comprobante. */}
            {sugerencias.length > 0 && (fase === 'vacio' || fase === 'error') && (
              <ul
                className="absolute left-0 right-0 top-full mt-1 z-20 overflow-hidden
                           rounded-campo border border-linea-fuerte bg-blanco shadow-lg"
              >
                {sugerencias.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => cotizar(v.placa, ticketPerdido)}
                      className="fila w-full text-left transition-colors duration-rapido hover:bg-lienzo"
                    >
                      <span className="placa flex-1">{v.placa}</span>
                      <span className="text-micro text-grafito num">
                        celda {fmtCelda(v.celda)} · {transcurrido(v.hora_entrada, ahora)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="mt-2 flex items-center justify-center gap-1.5 text-mini text-niebla">
            <Icono nombre="escaner" tam={14} />
            Escanee el tiquete o digite la placa
          </p>

          {fase === 'cargando' && (
            <p className="mt-6 text-center text-mini text-niebla">Consultando…</p>
          )}

          {fase === 'error' && (
            <p
              role="alert"
              className="mt-6 flex items-start gap-2 rounded-campo border border-alerta/40
                         bg-alerta-50 px-3 py-3 text-base text-alerta"
            >
              <Icono nombre="alerta" tam={17} />
              {error}
            </p>
          )}

          {vehiculo && cobro && (
            <>
              <dl className="mt-6 grid grid-cols-3 overflow-hidden rounded-campo border border-linea">
                <div className="p-3 border-r border-linea">
                  <dt className="text-micro font-medium text-grafito">Entró</dt>
                  <dd className="text-base font-medium num mt-0.5">
                    {hora(vehiculo.hora_entrada)}
                  </dd>
                </div>
                <div className="p-3 border-r border-linea">
                  <dt className="text-micro font-medium text-grafito">
                    {fase === 'hecho' ? 'Salió' : 'Sale'}
                  </dt>
                  <dd className="text-base font-medium num mt-0.5">
                    {fase === 'hecho' ? hora(vehiculo.hora_salida) : hora(nowSql(ahora))}
                  </dd>
                </div>
                <div className="p-3">
                  <dt className="text-micro font-medium text-grafito">Permanencia</dt>
                  <dd className="text-base font-medium num mt-0.5">{cobro.detalle}</dd>
                </div>
              </dl>

              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-mini text-grafito px-0.5">
                <span>
                  Celda <b className="font-medium text-tinta num">{fmtCelda(vehiculo.celda)}</b>
                  {fase === 'hecho' && <span className="text-niebla"> · liberada</span>}
                </span>
                <span>{ETIQUETA_TARIFA[cobro.tipoTarifa] || cobro.tipoTarifa}</span>
                {(vehiculo.marca || vehiculo.color) && (
                  <span>{[vehiculo.marca, vehiculo.color].filter(Boolean).join(' ')}</span>
                )}
                {Boolean(vehiculo.casco) && (
                  <span className="flex items-center gap-1.5">
                    <Icono nombre="casco" tam={15} />
                    Casco en custodia
                  </span>
                )}
              </div>

              <p className="mt-3 text-micro text-niebla num">
                Ingresó el {fechaHora(vehiculo.hora_entrada)}
              </p>

              {fase !== 'hecho' && (
                <label
                  className="mt-5 flex items-center gap-3 rounded-campo border border-linea
                             px-3 py-3 cursor-pointer transition-colors duration-rapido
                             hover:border-linea-fuerte"
                >
                  <input
                    type="checkbox"
                    checked={ticketPerdido}
                    onChange={(e) => setTicketPerdido(e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-base font-medium">Perdió el tiquete</span>
                  <span className="ml-auto text-mini text-grafito num">+{cop(cargoTicket)}</span>
                </label>
              )}
            </>
          )}
        </div>

        {/* ---- Derecha: el cobro ---- */}
        <div className="panel p-5">
          {!cobro && (
            <p className="py-10 text-center text-mini text-niebla">
              Escanee un tiquete para ver el cobro.
            </p>
          )}

          {cobro && (
            <>
              <div className="flex justify-between text-base text-grafito">
                <span>{cobro.detalle}</span>
                <span className="num font-medium text-tinta">{cop(cobro.montoBase)}</span>
              </div>

              <div className="mt-2.5 flex justify-between border-b border-linea pb-3 text-base text-grafito">
                <span>Recargo tiquete perdido</span>
                <span className="num">{cobro.recargo > 0 ? cop(cobro.recargo) : '—'}</span>
              </div>

              <div className="pt-3.5">
                <div className="text-micro font-medium text-grafito">
                  {fase === 'hecho' ? 'Total cobrado' : 'Total a cobrar'}
                </div>
                <div className="text-total font-semibold num tracking-tight mt-1">
                  {cop(cobro.total)}
                </div>
              </div>

              {fase === 'hecho' ? (
                <>
                  <div className="mt-5 rounded-campo border border-linea bg-lienzo px-3 py-3">
                    <p className="text-base font-medium flex items-center gap-2">
                      <Icono nombre="visto" tam={16} className="text-azul-700" />
                      Recibo N.° <span className="num">
                        {String(recibo.transaccion.id).padStart(6, '0')}
                      </span>
                    </p>
                    <p className="mt-1 text-micro text-grafito">
                      {recibo.impresion?.ok
                        ? 'Impreso en la JAL58M.'
                        : `Sin imprimir: ${recibo.impresion?.motivo || 'impresora no disponible'}`}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => window.api.impresora.reimprimir(recibo.transaccion.id)}
                    className="btn-neutro w-full mt-3"
                  >
                    <Icono nombre="impresora" tam={16} />
                    Imprimir copia
                  </button>
                  <button type="button" onClick={limpiar} className="btn-azul w-full py-3 mt-2">
                    Siguiente cliente
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => cobrar(true)}
                    disabled={fase !== 'listo'}
                    className="btn-azul w-full py-3.5 mt-5"
                  >
                    <Icono nombre="impresora" tam={17} />
                    {fase === 'cobrando' ? 'Cobrando…' : 'Cobrar e imprimir'}
                  </button>
                  <button
                    type="button"
                    onClick={() => cobrar(false)}
                    disabled={fase !== 'listo'}
                    className="btn-fantasma w-full mt-1.5 text-mini"
                  >
                    Cobrar sin imprimir
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** El reloj vivo en el formato SQL que consume `hora()`. */
function nowSql(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`
}
