import { useCallback, useEffect, useState } from 'react'
import Icono from './Icono.jsx'
import { cop, fecha as fmtFecha, hora, miles } from '../lib/format.js'

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
  const [caja, setCaja] = useState(null)
  const [cierres, setCierres] = useState([])
  const [base, setBase] = useState('')
  const [conteo, setConteo] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    const [resCaja, resCierres] = await Promise.all([
      window.api.caja.resumen(),
      window.api.caja.cierres(10)
    ])

    if (resCaja.ok) {
      setCaja(resCaja.data)
      setBase(String(resCaja.data.baseInicial))
    } else {
      onAviso?.({ tipo: 'error', texto: 'No se pudo leer la caja', detalle: resCaja.error })
    }
    if (resCierres.ok) setCierres(resCierres.data)
  }, [onAviso])

  useEffect(() => {
    cargar()
    const id = setInterval(cargar, 15000)
    return () => clearInterval(id)
  }, [cargar])

  async function guardarBase() {
    setOcupado(true)
    const res = await window.api.caja.abrir({ baseInicial: Number(base) || 0 })
    setOcupado(false)

    if (res.ok) {
      setCaja(res.data)
      onAviso?.({ tipo: 'ok', texto: `Base de caja en ${cop(res.data.baseInicial)}` })
    } else {
      onAviso?.({ tipo: 'error', texto: res.error })
    }
  }

  async function cerrar() {
    setOcupado(true)
    const res = await window.api.caja.cerrar({
      conteoFinal: Number(conteo) || 0,
      observaciones
    })
    setOcupado(false)

    if (!res.ok) return onAviso?.({ tipo: 'error', texto: res.error })

    setCaja(res.data)
    setConteo('')
    setObservaciones('')
    cargar()
    onAviso?.({
      tipo: res.data.diferencia === 0 ? 'ok' : 'error',
      texto:
        res.data.diferencia === 0
          ? 'Caja cerrada y cuadrada'
          : `Caja cerrada con ${res.data.diferencia > 0 ? 'sobrante' : 'faltante'} de ${cop(
              Math.abs(res.data.diferencia)
            )}`
    })
  }

  async function reabrir() {
    setOcupado(true)
    const res = await window.api.caja.reabrir()
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

  const baseSucia = String(caja.baseInicial) !== String(Number(base) || 0)
  const conteoNum = conteo === '' ? null : Number(conteo) || 0
  const diferenciaViva = conteoNum === null ? null : conteoNum - caja.esperado

  return (
    <div className="space-y-4">
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
            <div className="relative w-40">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-niebla text-base">
                $
              </span>
              <input
                type="number"
                min="0"
                step="1000"
                value={base}
                disabled={caja.cerrada || ocupado}
                onChange={(e) => setBase(e.target.value)}
                className="campo num pl-7 text-right"
              />
            </div>
            <button
              type="button"
              onClick={guardarBase}
              disabled={!baseSucia || caja.cerrada || ocupado}
              className="btn-neutro"
            >
              Guardar
            </button>
          </div>
        </div>
      </section>

      {/* ---- Arqueo ---- */}
      <section className="panel overflow-hidden">
        <h3 className="panel-titulo px-4 pt-3.5 pb-2">Cuadre de caja</h3>

        <Linea etiqueta="Base inicial" valor={caja.baseInicial} />
        <Linea
          etiqueta="Cobros en efectivo de hoy"
          ayuda={`${miles(caja.operaciones)} cobros registrados en el día`}
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
          etiqueta="Transferencias de hoy"
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
          <Linea etiqueta="Dinero contado" valor={caja.conteoFinal} />
          <Linea etiqueta="Debía haber" valor={caja.esperado} atenuada />

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
            <div className="relative w-40 shrink-0">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-niebla text-base">
                $
              </span>
              <input
                type="number"
                min="0"
                step="1000"
                value={conteo}
                disabled={ocupado}
                onChange={(e) => setConteo(e.target.value)}
                placeholder="0"
                className="campo num pl-7 text-right"
              />
            </div>
          </div>

          {/* La diferencia se muestra mientras se escribe: el operario ve el
              descuadre antes de confirmar, no después. */}
          {diferenciaViva !== null && (
            <div
              className={`flex items-baseline justify-between gap-4 px-4 py-3
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
              disabled={conteo === '' || ocupado}
              className="btn-azul"
            >
              <Icono nombre="caja" tam={16} />
              {ocupado ? 'Cerrando…' : 'Cerrar caja del día'}
            </button>
          </div>
        </section>
      )}

      {/* ---- Historial ---- */}
      {cierres.length > 0 && (
        <section className="panel overflow-hidden">
          <h3 className="panel-titulo px-4 pt-3.5 pb-2">Cierres anteriores</h3>
          {cierres.map((c) => (
            <div key={c.fecha} className="fila">
              <span className="text-base num flex-1">{fmtFecha(c.fecha)}</span>
              {c.cerrada_at ? (
                <>
                  <span className="text-mini text-grafito num">{cop(c.conteo_final)}</span>
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
                <span className="text-mini text-niebla w-24 text-right">sin cerrar</span>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
