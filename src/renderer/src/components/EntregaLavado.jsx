import { useCallback, useEffect, useRef, useState } from 'react'
import Icono from './Icono.jsx'
import MetodoPago from './MetodoPago.jsx'
import TotalEditable from './TotalEditable.jsx'
import {
  cop,
  fechaHora,
  hora,
  idDeCodigoLavado,
  transcurrido,
  ETIQUETA_METODO
} from '../lib/format.js'

/** Placa o código de tiquete de lavadero ('LAV000123'), que tiene 9 caracteres. */
const normalizarBusqueda = (texto) =>
  String(texto || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 9)

/*
 * Entrega de una moto del lavadero: el mismo gesto que una salida del
 * parqueadero. Se busca por placa o con el tiquete, se escoge el método de
 * pago y se cobra, con el lápiz para un valor final acordado.
 *
 * Fases: 'vacio' -> 'cargando' -> 'listo' -> 'cobrando' -> 'hecho'   (o 'error')
 */
export default function EntregaLavado({ seleccion, ahora, onSeleccionar, onEntregado, onAviso }) {
  const [texto, setTexto] = useState('')
  const [sugerencias, setSugerencias] = useState([])
  const [fase, setFase] = useState('vacio')
  const [error, setError] = useState(null)
  const [lavado, setLavado] = useState(null)
  const [resultado, setResultado] = useState(null) // { lavado, impresion, imprimir }
  const [metodoPago, setMetodoPago] = useState(null)
  const [acordado, setAcordado] = useState(null)
  const [editandoTotal, setEditandoTotal] = useState(false)
  const buscadorRef = useRef(null)

  const puedeCobrar = fase === 'listo' && !editandoTotal && Boolean(metodoPago)

  /** Busca la lavada activa de una placa, o la de un tiquete de lavadero. */
  const abrir = useCallback(async (busqueda) => {
    const id = idDeCodigoLavado(busqueda)
    const placa = normalizarBusqueda(busqueda)
    if (!id && placa.length < 3) return

    setFase('cargando')
    setError(null)
    setResultado(null)
    setSugerencias([])
    setAcordado(null)
    setEditandoTotal(false)
    setMetodoPago(null)

    let encontrado = null
    if (id) {
      const res = await window.api.lavadero.obtener(id)
      encontrado = res.ok && res.data?.estado === 'activo' ? res.data : null
    } else {
      const res = await window.api.lavadero.buscar(placa)
      encontrado = res.ok ? (res.data.find((l) => l.placa === placa) ?? null) : null
    }

    if (encontrado) {
      setLavado(encontrado)
      setTexto(encontrado.placa)
      setFase('listo')
    } else {
      setLavado(null)
      setError(
        id ? 'Ese tiquete no corresponde a una moto en el lavadero' : `${placa} no está en el lavadero`
      )
      setFase('error')
    }
  }, [])

  // Llegada desde la lista de la derecha o desde el escáner.
  useEffect(() => {
    if (seleccion) abrir(seleccion)
    else buscadorRef.current?.focus()
  }, [seleccion, abrir])

  // Sugerencias mientras se digita.
  useEffect(() => {
    if (fase === 'listo' || fase === 'hecho') return
    let cancelado = false
    if (texto.length < 2 || idDeCodigoLavado(texto)) {
      setSugerencias([])
      return
    }
    const id = setTimeout(async () => {
      const res = await window.api.lavadero.buscar(texto)
      if (!cancelado && res.ok) setSugerencias(res.data)
    }, 140)
    return () => {
      cancelado = true
      clearTimeout(id)
    }
  }, [texto, fase])

  const cobrar = useCallback(
    async (imprimir) => {
      if (fase !== 'listo' || !lavado || editandoTotal) return
      if (!metodoPago) {
        onAviso?.({ tipo: 'error', texto: 'Seleccione el método de pago antes de cobrar' })
        return
      }
      setFase('cobrando')

      const res = await window.api.lavadero.entregar({
        id: lavado.id,
        metodoPago,
        imprimir,
        totalAcordado: acordado ?? undefined
      })

      if (!res.ok) {
        setError(res.error)
        setFase('error')
        return
      }

      setResultado({ ...res.data, imprimir })
      setFase('hecho')
      onEntregado?.(res.data)

      if (imprimir && !res.data.impresion?.ok) {
        onAviso?.({
          tipo: 'error',
          texto: 'Cobro guardado, pero el recibo no se imprimió',
          detalle: res.data.impresion?.motivo
        })
      }
    },
    [fase, lavado, editandoTotal, metodoPago, acordado, onEntregado, onAviso]
  )

  async function reimprimirTiquete() {
    const res = await window.api.impresora.tiqueteLavado(lavado.id)
    onAviso?.(
      res.ok && res.data?.ok
        ? { tipo: 'ok', texto: `Tiquete de ${lavado.placa} enviado a la impresora` }
        : { tipo: 'error', texto: 'No se pudo imprimir', detalle: res.data?.motivo || res.error }
    )
  }

  async function imprimirRecibo() {
    const res = await window.api.impresora.reciboLavado(resultado.lavado.id)
    if (res.ok && res.data?.ok) {
      onAviso?.({ tipo: 'ok', texto: 'Recibo enviado a la impresora' })
      setResultado((r) => ({ ...r, impresion: { ok: true } }))
    } else {
      onAviso?.({ tipo: 'error', texto: 'No se pudo imprimir', detalle: res.data?.motivo || res.error })
    }
  }

  function limpiar() {
    setTexto('')
    setLavado(null)
    setResultado(null)
    setError(null)
    setMetodoPago(null)
    setAcordado(null)
    setEditandoTotal(false)
    setFase('vacio')
    onSeleccionar?.(null)
    setTimeout(() => buscadorRef.current?.focus(), 0)
  }

  // Enter cobra; en el comprobante, Enter despeja. Mientras se edita el total,
  // Enter y Esc son del campo.
  useEffect(() => {
    const alTeclear = (e) => {
      if (editandoTotal) return
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
  }, [fase, cobrar, editandoTotal])

  const actual = fase === 'hecho' ? resultado?.lavado : lavado

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_290px] gap-4 items-start">
      {/* ---- Izquierda: la moto ---- */}
      <div className="panel p-5">
        <label className="etiqueta" htmlFor="lavado-buscar">
          Placa
        </label>
        <div className="relative">
          <input
            id="lavado-buscar"
            ref={buscadorRef}
            data-escaner="local"
            value={texto}
            disabled={fase === 'cobrando' || fase === 'hecho'}
            onChange={(e) => {
              setTexto(normalizarBusqueda(e.target.value))
              if (fase === 'listo' || fase === 'error') {
                setFase('vacio')
                setLavado(null)
                setError(null)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && fase !== 'listo' && fase !== 'hecho') {
                e.preventDefault()
                abrir(sugerencias.length === 1 ? sugerencias[0].placa : texto)
              }
            }}
            placeholder="ABC12D"
            autoComplete="off"
            spellCheck={false}
            className="campo-placa"
          />

          {sugerencias.length > 0 && (fase === 'vacio' || fase === 'error') && (
            <ul
              className="absolute left-0 right-0 top-full mt-1 z-20 overflow-hidden
                         rounded-campo border border-linea-fuerte bg-blanco shadow-lg"
            >
              {sugerencias.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => abrir(l.placa)}
                    className="fila w-full text-left transition-colors duration-rapido hover:bg-lienzo"
                  >
                    <span className="placa flex-1">{l.placa}</span>
                    <span className="text-micro text-grafito truncate">{l.tipo_lavada}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="mt-2 flex items-center justify-center gap-1.5 text-mini text-niebla">
          <Icono nombre="escaner" tam={14} />
          Escanee el tiquete de lavadero o digite la placa
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

        {actual && (
          <>
            <dl className="mt-6 grid grid-cols-3 overflow-hidden rounded-campo border border-linea">
              <div className="p-3 border-r border-linea">
                <dt className="text-micro font-medium text-grafito">Entró</dt>
                <dd className="text-base font-medium num mt-0.5">{hora(actual.hora_entrada)}</dd>
              </div>
              <div className="p-3 border-r border-linea">
                <dt className="text-micro font-medium text-grafito">
                  {fase === 'hecho' ? 'Se entregó' : 'En el lavadero'}
                </dt>
                <dd className="text-base font-medium num mt-0.5">
                  {fase === 'hecho'
                    ? hora(actual.hora_entrega)
                    : transcurrido(actual.hora_entrada, ahora)}
                </dd>
              </div>
              <div className="p-3 min-w-0">
                <dt className="text-micro font-medium text-grafito">Lavada</dt>
                <dd className="text-base font-medium mt-0.5 truncate" title={actual.tipo_lavada}>
                  {actual.tipo_lavada}
                </dd>
              </div>
            </dl>

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-mini text-grafito px-0.5">
              <span>
                Servicio N.° <b className="font-medium text-tinta num">
                  {String(actual.id).padStart(6, '0')}
                </b>
              </span>
              {(actual.marca || actual.color) && (
                <span>{[actual.marca, actual.color].filter(Boolean).join(' ')}</span>
              )}
              {Boolean(actual.casco) && (
                <span className="flex items-center gap-1.5">
                  <Icono nombre="casco" tam={15} />
                  Casco en custodia
                  {actual.locker && (
                    <b className="font-medium text-tinta num">· locker {actual.locker}</b>
                  )}
                </span>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-micro text-niebla num">Ingresó el {fechaHora(actual.hora_entrada)}</p>
              {fase !== 'hecho' && (
                <button
                  type="button"
                  onClick={reimprimirTiquete}
                  disabled={fase === 'cobrando'}
                  className="btn-fantasma py-1 px-2 text-micro"
                >
                  <Icono nombre="impresora" tam={14} />
                  Reimprimir tiquete
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* ---- Derecha: el cobro ---- */}
      <div className="panel p-5">
        {!actual && (
          <p className="py-10 text-center text-mini text-niebla">
            Escoja una moto de la lista o escanee su tiquete.
          </p>
        )}

        {actual && (
          <>
            <div className="flex justify-between gap-3 text-base text-grafito">
              <span className="truncate">{actual.tipo_lavada}</span>
              <span className="num font-medium text-tinta">{cop(actual.precio)}</span>
            </div>
            <p className="mt-1 border-b border-linea pb-3 text-micro text-niebla num">
              {actual.pactado
                ? `Valor pactado al ingresar · precio de lista ${cop(actual.precio_lista)}`
                : 'Precio de lista al ingresar'}
            </p>

            {fase === 'hecho' ? (
              <TotalEditable
                editable={false}
                etiqueta="Total cobrado"
                calculado={actual.precio}
                acordado={actual.ajuste ? actual.monto : null}
              />
            ) : (
              <TotalEditable
                key={actual.id}
                editable={fase === 'listo'}
                calculado={actual.precio}
                acordado={acordado}
                onAcordar={setAcordado}
                onEditando={setEditandoTotal}
              />
            )}

            {fase === 'hecho' ? (
              <>
                <div className="mt-4 flex items-center justify-between rounded-campo border border-linea px-3 py-2.5">
                  <span className="flex items-center gap-2 text-base font-medium">
                    <Icono
                      nombre={actual.metodo_pago === 'efectivo' ? 'efectivo' : 'transferencia'}
                      tam={16}
                      className="text-azul-700"
                    />
                    {ETIQUETA_METODO[actual.metodo_pago] || actual.metodo_pago}
                  </span>
                  <span className="text-micro text-grafito">
                    {actual.metodo_pago === 'efectivo' ? 'Sumado a la caja' : 'A cuentas digitales'}
                  </span>
                </div>

                <div className="mt-2 rounded-campo border border-linea bg-lienzo px-3 py-3">
                  <p className="text-base font-medium flex items-center gap-2">
                    <Icono nombre="visto" tam={16} className="text-azul-700" />
                    Moto entregada
                  </p>
                  <p className="mt-1 text-micro text-grafito">
                    {resultado.impresion?.ok
                      ? 'Recibo impreso en la JAL58M.'
                      : resultado.imprimir === false
                        ? 'Se cobró sin imprimir el recibo.'
                        : `Sin imprimir: ${resultado.impresion?.motivo || 'impresora no disponible'}`}
                  </p>
                </div>

                <button type="button" onClick={imprimirRecibo} className="btn-neutro w-full mt-3">
                  <Icono nombre="impresora" tam={16} />
                  {resultado.impresion?.ok ? 'Imprimir copia' : 'Imprimir recibo'}
                </button>
                <button type="button" onClick={limpiar} className="btn-azul w-full py-3 mt-2">
                  Siguiente moto
                </button>
              </>
            ) : (
              <>
                <MetodoPago
                  className="mt-5"
                  valor={metodoPago}
                  onChange={setMetodoPago}
                  disabled={fase === 'cobrando'}
                />

                <button
                  type="button"
                  onClick={() => cobrar(true)}
                  disabled={!puedeCobrar}
                  className="btn-azul w-full py-3.5 mt-3"
                >
                  <Icono nombre="impresora" tam={17} />
                  {fase === 'cobrando' ? 'Cobrando…' : 'Cobrar e imprimir'}
                </button>
                <button
                  type="button"
                  onClick={() => cobrar(false)}
                  disabled={!puedeCobrar}
                  className="btn-fantasma w-full mt-1.5 text-mini"
                >
                  Cobrar sin imprimir
                </button>

                {fase === 'listo' && (editandoTotal || !metodoPago) && (
                  <p className="mt-2 text-center text-micro text-niebla">
                    {editandoTotal
                      ? 'Aplique o cancele el nuevo valor para cobrar.'
                      : 'Escoja cómo paga el cliente para habilitar el cobro.'}
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
