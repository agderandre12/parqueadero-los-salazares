import { useEffect, useRef, useState } from 'react'
import Icono from '../components/Icono.jsx'
import { celda as fmtCelda, cop, normalizarPlaca, ETIQUETA_TARIFA } from '../lib/format.js'

const INICIAL = {
  placa: '',
  marca: '',
  color: '',
  casco: false,
  tipo_tarifa: 'hora',
  tarifa_personalizada: ''
}

/**
 * Registro de entrada. La placa domina la pantalla porque es el único dato
 * obligatorio: todo lo demás se puede dejar en blanco y el ingreso sirve igual.
 */
export default function NuevaEntrada({ settings, celdaSugerida, hayCupo, onRegistrado, onError }) {
  const [form, setForm] = useState(INICIAL)
  const [guardando, setGuardando] = useState(false)
  const placaRef = useRef(null)

  useEffect(() => {
    placaRef.current?.focus()
  }, [])

  const set = (campo) => (e) => {
    const valor = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setForm((f) => ({ ...f, [campo]: campo === 'placa' ? normalizarPlaca(valor) : valor }))
  }

  const tarifaMostrada = {
    hora: `${cop(settings?.tarifa_hora)} por hora`,
    amanecida: `${cop(settings?.tarifa_amanecida)} por amanecida`,
    mensualidad: `${cop(settings?.tarifa_mensualidad)} al mes, ya pagos`,
    personalizada: form.tarifa_personalizada
      ? `${cop(form.tarifa_personalizada)} pactados`
      : 'Escriba el valor pactado'
  }[form.tipo_tarifa]

  async function enviar(e) {
    e.preventDefault()

    if (form.placa.length < 3) {
      onError?.('La placa necesita al menos 3 caracteres')
      placaRef.current?.focus()
      return
    }
    if (form.tipo_tarifa === 'personalizada' && !Number(form.tarifa_personalizada)) {
      onError?.('Escriba el valor pactado para la tarifa personalizada')
      return
    }

    setGuardando(true)
    const res = await window.api.vehiculos.crear({
      ...form,
      tarifa_personalizada: Number(form.tarifa_personalizada) || 0
    })
    setGuardando(false)

    if (!res.ok) {
      onError?.(res.error)
      placaRef.current?.select()
      return
    }

    setForm(INICIAL)
    placaRef.current?.focus()
    onRegistrado?.(res.data)
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <form onSubmit={enviar} className="mx-auto w-full max-w-lg">
        <div className="panel p-6">
          <label className="etiqueta" htmlFor="placa">
            Placa
          </label>
          <input
            id="placa"
            ref={placaRef}
            data-escaner="local"
            value={form.placa}
            onChange={set('placa')}
            placeholder="ABC12D"
            autoComplete="off"
            spellCheck={false}
            className="campo-placa"
          />
          <p className="mt-2 flex items-center justify-center gap-1.5 text-mini text-niebla">
            <Icono nombre="escaner" tam={14} />
            Escanee el código o digite la placa
          </p>

          <div className="grid grid-cols-2 gap-3 mt-6">
            <div>
              <span className="etiqueta">Tipo</span>
              <div className="campo flex items-center gap-2 border-linea text-grafito">
                <Icono nombre="moto" tam={18} className="text-azul" />
                Moto
              </div>
            </div>
            <div>
              <span className="etiqueta">Celda</span>
              <div className="campo flex items-baseline gap-2 border-linea">
                {hayCupo ? (
                  <>
                    <span className="num">{fmtCelda(celdaSugerida)}</span>
                    <span className="text-mini font-normal text-niebla">primera libre</span>
                  </>
                ) : (
                  <span className="text-alerta text-mini font-medium">
                    Sin celdas — entra sin asignar
                  </span>
                )}
              </div>
            </div>
          </div>

          <fieldset className="mt-4">
            <legend className="etiqueta">Tarifa</legend>
            <div className="grid grid-cols-4 gap-1.5">
              {Object.keys(ETIQUETA_TARIFA).map((tipo) => {
                const activa = form.tipo_tarifa === tipo
                return (
                  <button
                    key={tipo}
                    type="button"
                    aria-pressed={activa}
                    onClick={() => setForm((f) => ({ ...f, tipo_tarifa: tipo }))}
                    className={`rounded-campo border px-2 py-2.5 text-mini font-medium
                      transition-colors duration-rapido ease-salida
                      ${
                        activa
                          ? 'border-azul bg-azul-50 text-azul-700'
                          : 'border-linea-fuerte text-grafito hover:border-niebla hover:text-tinta'
                      }`}
                  >
                    {ETIQUETA_TARIFA[tipo]}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-mini text-grafito num">{tarifaMostrada}</p>
          </fieldset>

          {form.tipo_tarifa === 'personalizada' && (
            <div className="mt-4">
              <label className="etiqueta" htmlFor="valor">
                Valor pactado
              </label>
              <input
                id="valor"
                type="number"
                min="0"
                step="500"
                value={form.tarifa_personalizada}
                onChange={set('tarifa_personalizada')}
                placeholder="5000"
                className="campo num"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mt-4">
            <div>
              <label className="etiqueta" htmlFor="marca">
                Marca <span className="text-niebla font-normal">opcional</span>
              </label>
              <input
                id="marca"
                value={form.marca}
                onChange={set('marca')}
                placeholder="Bajaj"
                autoComplete="off"
                className="campo"
              />
            </div>
            <div>
              <label className="etiqueta" htmlFor="color">
                Color <span className="text-niebla font-normal">opcional</span>
              </label>
              <input
                id="color"
                value={form.color}
                onChange={set('color')}
                placeholder="Negro"
                autoComplete="off"
                className="campo"
              />
            </div>
          </div>

          <label
            className="mt-4 flex items-center justify-between gap-3 rounded-campo
                       border border-linea px-3 py-3 cursor-pointer
                       transition-colors duration-rapido hover:border-linea-fuerte"
          >
            <span className="flex items-center gap-2.5 text-base font-medium">
              <Icono nombre="casco" tam={18} className="text-grafito" />
              Deja el casco en custodia
            </span>
            <input
              type="checkbox"
              checked={form.casco}
              onChange={set('casco')}
              className="w-4 h-4 rounded"
            />
          </label>

          <button type="submit" disabled={guardando} className="btn-azul w-full py-3.5 mt-6">
            <Icono nombre="visto" tam={17} />
            {guardando ? 'Registrando…' : 'Registrar entrada'}
          </button>

          <p className="mt-2.5 text-center text-micro text-niebla">
            Enter para guardar · el tiquete con código de barras se imprime solo
          </p>
        </div>
      </form>
    </div>
  )
}
