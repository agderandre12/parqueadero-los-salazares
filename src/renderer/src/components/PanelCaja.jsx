import { useCallback, useEffect, useRef, useState } from 'react'
import CampoPesos from './CampoPesos.jsx'
import Icono from './Icono.jsx'
import { cop, fecha as fmtFecha, hora, isoLocal, miles } from '../lib/format.js'

/*
 * Caja registradora del día.
 *
 * La cuenta que se corrobora al cerrar es una sola y está escrita en pantalla
 * tal cual se hace con la plata en la mano:
 *
 *     base inicial + efectivo cobrado hoy = lo que debe haber en el cajón
 *
 * Las transferencias aparecen aparte y en gris justamente para que nadie las
 * sume: ese dinero está en la cuenta del banco, no en el cajón.
 *
 * Al cerrar se dice cuánto se deja en el cajón; con eso abre la jornada
 * siguiente. Si la anterior quedó sin cerrar (se olvidó, o se cerró pasada la
 * medianoche), la vista lo avisa y deja abrirla para cerrarla.
 */

function Linea({ etiqueta, valor, ayuda, signo, atenuada }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3 border-b border-linea last:border-b-0">
      <div className="min-w-0">
        <div className={`text-base ${atenuada ? 'text-niebla' : 'text-grafito'}`}>{etiqueta}</div>
        {ayuda && <p className="text-micro text-niebla mt-0.5">{ayuda}</p>}
      </div>
      <div
        className={`num shrink-0 ${atenuada ? 'text-mini text-niebla' : 'text-base font-medium'}`}
      >
        {signo}
        {cop(valor)}
      </div>
    </div>
  )
}

export default function PanelCaja({ onAviso }) {
  // null = la jornada de hoy; una fecha = una jornada anterior que quedó abierta.
  const [fecha, setFecha] = useState(null)
  const [caja, setCaja] = useState(null)
  const [cierres, setCierres] = useState([])
  const [base, setBase] = useState('')
  const [conteo, setConteo] = useState('')
  // Vacío = queda todo lo contado.
  const [queda, setQueda] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [ocupado, setOcupado] = useState(false)
  // La última base que mandó la base de datos: con ella se sabe si el campo se
  // está editando.
  const baseGuardada = useRef(null)

  const cargar = useCallback(async () => {
    const [resCaja, resCierres] = await Promise.all([
      window.api.caja.resumen(fecha ?? undefined),
      window.api.caja.cierres(10)
    ])

    if (resCaja.ok) {
      setCaja(resCaja.data)
      // El refresco de cada 15 s no puede pisar una base a medio escribir.
      const anterior = baseGuardada.current
      baseGuardada.current = resCaja.data.baseInicial
      setBase((b) => (anterior === null || b === anterior ? resCaja.data.baseInicial : b))
    } else {
      onAviso?.({ tipo: 'error', texto: 'No se pudo leer la caja', detalle: resCaja.error })
    }
    if (resCierres.ok) setCierres(resCierres.data)
  }, [onAviso, fecha])

  useEffect(() => {
    cargar()
    const id = setInterval(cargar, 15000)
    return () => clearInterval(id)
  }, [cargar])

  /** Cambia de jornada: lo que se estaba escribiendo era de la otra. */
  function verJornada(otra) {
    baseGuardada.current = null
    setCaja(null)
    setConteo('')
    setQueda('')
    setObservaciones('')
    setFecha(otra)
  }

  async function guardarBase(valor = Number(base) || 0) {
    setOcupado(true)
    const res = await window.api.caja.abrir({ baseInicial: valor, fecha: fecha ?? undefined })
    setOcupado(false)

    if (res.ok) {
      setCaja(res.data)
      baseGuardada.current = res.data.baseInicial
      setBase(res.data.baseInicial)
      onAviso?.({ tipo: 'ok', texto: `Base de caja en ${cop(res.data.baseInicial)}` })
    } else {
      onAviso?.({ tipo: 'error', texto: res.error })
    }
  }

  async function cerrar() {
    setOcupado(true)
    const res = await window.api.caja.cerrar({
      conteoFinal: Number(conteo) || 0,
      quedaEnCaja: queda === '' ? undefined : queda,
      observaciones,
      fecha: fecha ?? undefined
    })
    setOcupado(false)

    if (!res.ok) return onAviso?.({ tipo: 'error', texto: res.error })

    setCaja(res.data)
    setConteo('')
    setQueda('')
    setObservaciones('')
    cargar()
    onAviso?.({
      tipo: res.data.diferencia === 0 ? 'ok' : 'error',
      texto:
        res.data.diferencia === 0
          ? 'Caja cerrada y cuadrada'
          : `Caja cerrada con ${res.data.diferencia > 0 ? 'sobrante' : 'faltante'} de ${cop(
              Math.abs(res.data.diferencia)
            )}`,
      detalle: `Quedan ${cop(res.data.quedaEnCaja)} en el cajón para la próxima jornada`
    })
  }

  async function reabrir() {
    setOcupado(true)
    const res = await window.api.caja.reabrir(fecha ?? undefined)
    setOcupado(false)

    if (res.ok) {
      setCaja(res.data)
      cargar()
      onAviso?.({ tipo: 'ok', texto: 'Jornada reabierta' })
    } else {
      onAviso?.({ tipo: 'error', texto: res.error })
    }
  }

  if (!caja) return <p className="p-8 text-mini text-niebla">Cargando caja…</p>

  const esHoy = fecha === null
  const delDia = esHoy ? 'de hoy' : 'del día'
  const baseSucia = caja.baseInicial !== (Number(base) || 0)
  const conteoNum = conteo === '' ? null : Number(conteo) || 0
  const diferenciaViva = conteoNum === null ? null : conteoNum - caja.esperado
  const quedaNum = queda === '' ? conteoNum : queda
  const quedaInvalida = conteoNum !== null && quedaNum > conteoNum
  const retiro = conteoNum === null || quedaInvalida ? 0 : conteoNum - quedaNum
  const anterior = caja.anterior
  const heredado = anterior?.cerrada ? anterior.quedaEnCaja : null
  const hoySql = isoLocal()
  const otrosCierres = cierres.filter((c) => c.fecha !== caja.fecha)
  // Efectivo cobrado después de cerrar: está en el cajón, pero no en lo que se
  // anotó que quedaba, y la jornada siguiente abriría corta.
  const efectivoTrasCierre = caja.cerrada
    ? caja.movimientos
        .filter((m) => m.metodo_pago === 'efectivo' && m.fecha > caja.cerradaAt)
        .reduce((suma, m) => suma + m.monto, 0)
    : 0

  return (
    <div className="space-y-4">
      {!esHoy && (
        <div className="flex items-center justify-between gap-4 rounded-panel border border-azul-200 bg-azul-50 px-4 py-3">
          <p className="text-mini text-azul-700">
            Está viendo la jornada del {fmtFecha(caja.fecha)}
            {caja.cerrada
              ? '. Ya quedó cerrada: vuelva a hoy para tomar lo que quedó como base.'
              : ', que quedó sin cerrar. Cuente el cajón y ciérrela aquí.'}
          </p>
          <button type="button" onClick={() => verJornada(null)} className="btn-neutro py-1.5 shrink-0">
            <Icono nombre="izquierda" tam={14} />
            Volver a hoy
          </button>
        </div>
      )}

      {/* ---- Base de la jornada ---- */}
      <section className="panel overflow-hidden">
        <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-3 border-b border-linea">
          <div>
            <h3 className="panel-titulo">Jornada del {fmtFecha(caja.fecha)}</h3>
            <p className="text-micro text-niebla mt-0.5">
              {caja.cerrada
                ? `Cerrada a las ${hora(caja.cerradaAt)}`
                : `Abierta desde las ${hora(caja.abiertaAt)}`}
            </p>
          </div>
          <span className={caja.cerrada ? 'chip' : 'chip-activo'}>
            <Icono nombre="caja" tam={14} />
            {caja.cerrada ? 'Cerrada' : 'Abierta'}
          </span>
        </header>

        <div className="flex items-center justify-between gap-6 px-4 py-3.5">
          <div className="min-w-0">
            <div className="text-base font-medium">Base de dinero en caja</div>
            <p className="text-mini text-grafito mt-0.5">
              Con cuánto efectivo arranca el día, antes del primer cobro
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="w-40">
              <CampoPesos
                valor={base}
                disabled={caja.cerrada || ocupado}
                onChange={setBase}
                aria-label="Base de dinero en caja"
              />
            </div>
            <button
              type="button"
              onClick={() => guardarBase()}
              disabled={!baseSucia || caja.cerrada || ocupado}
              className="btn-neutro"
            >
              Guardar
            </button>
          </div>
        </div>

        {/* De dónde sale la base: el cierre anterior o, si no lo hubo, la
            base predeterminada de Configuración → Precios. */}
        {heredado !== null && caja.baseInicial === heredado && (
          <p className="flex items-center gap-2 px-4 py-2.5 border-t border-linea bg-lienzo text-mini text-grafito">
            <Icono nombre="visto" tam={15} className="text-azul-700" />
            Es lo que quedó en el cajón al cerrar la jornada del {fmtFecha(anterior.fecha)}.
          </p>
        )}

        {heredado !== null && caja.baseInicial !== heredado && !caja.cerrada && (
          <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-t border-linea bg-lienzo">
            <p className="text-mini text-grafito">
              Al cerrar la jornada del {fmtFecha(anterior.fecha)} quedaron{' '}
              <b className="font-medium text-tinta num">{cop(heredado)}</b> en el cajón.
            </p>
            <button
              type="button"
              onClick={() => guardarBase(heredado)}
              disabled={ocupado}
              className="btn-neutro py-1.5 shrink-0"
            >
              Usar ese valor
            </button>
          </div>
        )}

        {esHoy && anterior && !anterior.cerrada && (
          <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-t border-alerta/30 bg-alerta-50">
            <p className="flex items-start gap-2 text-mini text-alerta">
              <Icono nombre="alerta" tam={15} />
              La jornada del {fmtFecha(anterior.fecha)} quedó sin cerrar, así que hoy se abrió
              con la base predeterminada.
            </p>
            <button
              type="button"
              onClick={() => verJornada(anterior.fecha)}
              className="btn-alerta py-1.5 shrink-0"
            >
              Cerrar esa jornada
            </button>
          </div>
        )}
      </section>

      {/* ---- Arqueo ---- */}
      <section className="panel overflow-hidden">
        <h3 className="panel-titulo px-4 pt-3.5 pb-2">Cuadre de caja</h3>

        <Linea etiqueta="Base inicial" valor={caja.baseInicial} />
        <Linea
          etiqueta={`Cobros en efectivo ${delDia}`}
          ayuda={`${miles(caja.cobrosEfectivo)} de los ${miles(caja.operaciones)} cobros del día`}
          valor={caja.efectivo}
          signo="+ "
        />

        <div className="flex items-baseline justify-between gap-4 px-4 py-4 bg-lienzo border-y border-linea">
          <div>
            <div className="text-base font-medium">Debe haber en el cajón</div>
            <p className="text-micro text-grafito mt-0.5">Base inicial + cobros en efectivo</p>
          </div>
          <div className="text-dato font-semibold num tracking-tight">{cop(caja.esperado)}</div>
        </div>

        <Linea
          etiqueta={`Transferencias ${delDia}`}
          ayuda="Entraron a cuentas digitales: no se cuentan en el cajón"
          valor={caja.transferencia}
          atenuada
        />
        <Linea
          etiqueta="Ventas totales del día"
          ayuda="Efectivo + transferencias, tal como se ven en las métricas"
          valor={caja.totalVentas}
          atenuada
        />
      </section>

      {/* ---- Cierre ---- */}
      {caja.cerrada ? (
        <section className="panel overflow-hidden">
          <h3 className="panel-titulo px-4 pt-3.5 pb-2">Cierre del día</h3>
          {efectivoTrasCierre > 0 && (
            <div className="flex items-center justify-between gap-4 px-4 py-3 border-y border-alerta/30 bg-alerta-50">
              <p className="flex items-start gap-2 text-mini text-alerta">
                <Icono nombre="alerta" tam={15} />
                Después del cierre se cobraron {cop(efectivoTrasCierre)} en efectivo. Reabra la
                jornada y ciérrela otra vez para que la próxima abra con esa plata.
              </p>
              <button
                type="button"
                onClick={reabrir}
                disabled={ocupado}
                className="btn-alerta py-1.5 shrink-0"
              >
                Reabrir
              </button>
            </div>
          )}
          <Linea etiqueta="Dinero contado" valor={caja.conteoFinal} />
          {/* Lo que se esperaba al cerrar: `esperado` sigue sumando los cobros
              posteriores y la diferencia no, así que no se pueden poner juntos. */}
          <Linea etiqueta="Debía haber" valor={caja.conteoFinal - caja.diferencia} atenuada />

          <div
            className={`flex items-baseline justify-between gap-4 px-4 py-3.5 border-t border-linea
              ${caja.diferencia === 0 ? 'bg-azul-50' : 'bg-alerta-50'}`}
          >
            <span
              className={`text-base font-medium ${caja.diferencia === 0 ? 'text-azul-700' : 'text-alerta'}`}
            >
              {caja.diferencia === 0
                ? 'Cuadró exacto'
                : caja.diferencia > 0
                  ? 'Sobrante'
                  : 'Faltante'}
            </span>
            <span
              className={`num font-semibold ${caja.diferencia === 0 ? 'text-azul-700' : 'text-alerta'}`}
            >
              {cop(Math.abs(caja.diferencia))}
            </span>
          </div>

          <div className="border-t border-linea">
            <Linea
              etiqueta="Quedó en el cajón"
              ayuda="Con esto abre la próxima jornada"
              valor={caja.quedaEnCaja ?? caja.conteoFinal}
            />
            {caja.conteoFinal - (caja.quedaEnCaja ?? caja.conteoFinal) > 0 && (
              <Linea
                etiqueta="Se retiró"
                valor={caja.conteoFinal - (caja.quedaEnCaja ?? caja.conteoFinal)}
                atenuada
              />
            )}
          </div>

          {caja.observaciones && (
            <p className="px-4 py-3 text-mini text-grafito border-t border-linea">
              {caja.observaciones}
            </p>
          )}

          <div className="px-4 py-3 border-t border-linea">
            <button type="button" onClick={reabrir} disabled={ocupado} className="btn-fantasma">
              <Icono nombre="refrescar" tam={15} />
              Reabrir la jornada
            </button>
          </div>
        </section>
      ) : (
        <section className="panel overflow-hidden">
          <h3 className="panel-titulo px-4 pt-3.5 pb-2">Cerrar caja</h3>

          <div className="flex items-center justify-between gap-6 px-4 py-3.5 border-b border-linea">
            <div className="min-w-0">
              <div className="text-base font-medium">Dinero contado en el cajón</div>
              <p className="text-mini text-grafito mt-0.5">
                Cuente los billetes y monedas y escriba el total
              </p>
            </div>
            <div className="w-40 shrink-0">
              <CampoPesos
                valor={conteo}
                disabled={ocupado}
                onChange={setConteo}
                placeholder="0"
                aria-label="Dinero contado en el cajón"
              />
            </div>
          </div>

          {/* La diferencia se muestra mientras se escribe: el operario ve el
              descuadre antes de confirmar, no después. */}
          {diferenciaViva !== null && (
            <div
              className={`flex items-baseline justify-between gap-4 px-4 py-3 border-b border-linea
                ${diferenciaViva === 0 ? 'bg-azul-50' : 'bg-alerta-50'}`}
            >
              <span
                className={`text-base font-medium ${diferenciaViva === 0 ? 'text-azul-700' : 'text-alerta'}`}
              >
                {diferenciaViva === 0
                  ? 'Cuadra exacto con lo esperado'
                  : diferenciaViva > 0
                    ? 'Sobra'
                    : 'Falta'}
              </span>
              <span
                className={`num font-semibold ${diferenciaViva === 0 ? 'text-azul-700' : 'text-alerta'}`}
              >
                {cop(Math.abs(diferenciaViva))}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between gap-6 px-4 py-3.5">
            <div className="min-w-0">
              <div className="text-base font-medium">
                Queda en el cajón para {esHoy ? 'mañana' : 'el día siguiente'}
              </div>
              <p className="text-mini text-grafito mt-0.5">
                {quedaInvalida
                  ? 'No puede quedar más de lo que se contó'
                  : retiro > 0
                    ? `Se retiran ${cop(retiro)}. La próxima jornada abre con lo que quede.`
                    : 'Si no retira nada, queda todo lo contado: con eso abre la próxima jornada.'}
              </p>
            </div>
            <div className="w-40 shrink-0">
              <CampoPesos
                valor={queda}
                disabled={ocupado}
                onChange={setQueda}
                placeholder={conteoNum === null ? '0' : miles(conteoNum)}
                aria-label="Lo que queda en el cajón para mañana"
                className={quedaInvalida ? 'border-alerta' : ''}
              />
            </div>
          </div>

          <div className="px-4 py-3.5 border-t border-linea">
            <label className="etiqueta" htmlFor="caja-observaciones">
              Observaciones
            </label>
            <input
              id="caja-observaciones"
              value={observaciones}
              disabled={ocupado}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Ej.: se pagó el almuerzo con la caja"
              className="campo"
            />
          </div>

          <div className="px-4 py-3.5 bg-lienzo border-t border-linea">
            <button
              type="button"
              onClick={cerrar}
              disabled={conteo === '' || quedaInvalida || ocupado}
              className="btn-azul"
            >
              <Icono nombre="caja" tam={16} />
              {ocupado ? 'Cerrando…' : esHoy ? 'Cerrar caja del día' : `Cerrar la jornada del ${fmtFecha(caja.fecha)}`}
            </button>
          </div>
        </section>
      )}

      {/* ---- Historial: sin la jornada que se ve arriba. Una sin cerrar se
          puede abrir desde aquí para cerrarla. ---- */}
      {otrosCierres.length > 0 && (
        <section className="panel overflow-hidden">
          <h3 className="panel-titulo px-4 pt-3.5 pb-2">Otras jornadas</h3>
          {otrosCierres.map((c) => (
            <div key={c.fecha} className="fila px-4">
              <span className="text-base num flex-1">{fmtFecha(c.fecha)}</span>
              {c.cerrada_at ? (
                <>
                  <span className="text-mini text-grafito num">
                    contó {cop(c.conteo_final)} · quedó {cop(c.queda_en_caja ?? c.conteo_final)}
                  </span>
                  <span
                    className={`text-mini num w-24 text-right font-medium
                      ${c.diferencia === 0 ? 'text-grafito' : 'text-alerta'}`}
                  >
                    {c.diferencia === 0
                      ? 'cuadró'
                      : `${c.diferencia > 0 ? '+' : '−'}${cop(Math.abs(c.diferencia))}`}
                  </span>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => verJornada(c.fecha === hoySql ? null : c.fecha)}
                  className="text-mini font-medium text-alerta hover:underline underline-offset-2"
                >
                  {c.fecha === hoySql ? 'hoy, abierta' : 'sin cerrar · cerrarla'}
                </button>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
