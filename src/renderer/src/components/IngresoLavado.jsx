import { useEffect, useRef, useState } from 'react'
import CampoMarca from './CampoMarca.jsx'
import CampoPesos from './CampoPesos.jsx'
import CascoCustodia from './CascoCustodia.jsx'
import Icono from './Icono.jsx'
import { cop, miles, normalizarPlaca } from '../lib/format.js'

const INICIAL = {
  placa: '',
  marca: '',
  color: '',
  casco: false,
  locker: '',
  tipoLavadaId: null,
  pactar: false,
  valorPactado: ''
}

/**
 * Ingreso de una moto al lavadero. Placa y tipo de lavada son obligatorios;
 * el valor pactado reemplaza el precio del tipo cuando se negoció con el
 * cliente. Sólo guarda: si se imprime el tiquete lo pregunta la vista después.
 *
 * `bloqueado` es true mientras esa pregunta está abierta: el campo de placa no
 * debe robarle el foco.
 */
export default function IngresoLavado({ tipos, bloqueado, onIngresado, onError, onCrearTipos }) {
  const [form, setForm] = useState(INICIAL)
  const [guardando, setGuardando] = useState(false)
  const placaRef = useRef(null)

  useEffect(() => {
    if (!bloqueado) placaRef.current?.focus()
  }, [bloqueado])

  const set = (campo) => (e) =>
    setForm((f) => ({
      ...f,
      [campo]: campo === 'placa' ? normalizarPlaca(e.target.value) : e.target.value
    }))

  const tipo = tipos?.find((t) => t.id === form.tipoLavadaId) ?? null
  const precio = form.pactar && form.valorPactado !== '' ? form.valorPactado : tipo?.precio

  async function enviar(e) {
    e.preventDefault()

    if (form.placa.length < 3) {
      onError?.('La placa necesita al menos 3 caracteres')
      placaRef.current?.focus()
      return
    }
    if (!tipo) {
      onError?.('Escoja el tipo de lavada')
      return
    }
    if (form.pactar && form.valorPactado === '') {
      onError?.('Escriba el valor pactado con el cliente')
      return
    }

    setGuardando(true)
    const res = await window.api.lavadero.ingresar({
      placa: form.placa,
      marca: form.marca,
      color: form.color,
      casco: form.casco,
      locker: form.locker,
      tipoLavadaId: tipo.id,
      valorPactado: form.pactar ? form.valorPactado : null
    })
    setGuardando(false)

    if (!res.ok) {
      onError?.(res.error)
      placaRef.current?.select()
      return
    }

    setForm(INICIAL)
    onIngresado?.(res.data)
  }

  return (
    <form onSubmit={enviar} className="mx-auto w-full max-w-lg">
      <div className="panel p-6">
        <label className="etiqueta" htmlFor="lavado-placa">
          Placa
        </label>
        <input
          id="lavado-placa"
          ref={placaRef}
          data-escaner="local"
          value={form.placa}
          onChange={set('placa')}
          placeholder="ABC12D"
          autoComplete="off"
          spellCheck={false}
          className="campo-placa"
        />

        <fieldset className="mt-6">
          <legend className="etiqueta">Tipo de lavada</legend>

          {tipos === null ? (
            <p className="text-mini text-niebla">Cargando lavadas…</p>
          ) : tipos.length === 0 ? (
            <div className="rounded-campo border border-dashed border-linea-fuerte px-4 py-5 text-center">
              <p className="text-base text-grafito">Todavía no hay tipos de lavada.</p>
              <p className="text-mini text-niebla mt-0.5">
                El administrador los crea con su precio en Configuración.
              </p>
              <button type="button" onClick={onCrearTipos} className="btn-neutro mt-3">
                <Icono nombre="ajustes" tam={16} />
                Crear tipos de lavada
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {tipos.map((t) => {
                const activa = form.tipoLavadaId === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={activa}
                    onClick={() => setForm((f) => ({ ...f, tipoLavadaId: t.id }))}
                    className={`flex flex-col items-start gap-0.5 rounded-campo border px-3 py-2.5 text-left
                      transition-colors duration-rapido ease-salida
                      ${
                        activa
                          ? 'border-azul bg-azul-50'
                          : 'border-linea-fuerte hover:border-niebla hover:bg-lienzo'
                      }`}
                  >
                    <span
                      className={`text-base font-medium ${activa ? 'text-azul-700' : 'text-tinta'}`}
                    >
                      {t.nombre}
                    </span>
                    <span className="text-mini text-grafito num">{cop(t.precio)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </fieldset>

        <div
          className={`mt-4 rounded-campo border transition-colors duration-rapido
            ${form.pactar ? 'border-linea-fuerte' : 'border-linea hover:border-linea-fuerte'}`}
        >
          <label className="flex items-center justify-between gap-3 px-3 py-3 cursor-pointer">
            <span className="text-base font-medium">Otro valor, pactado con el cliente</span>
            <input
              type="checkbox"
              checked={form.pactar}
              onChange={(e) => setForm((f) => ({ ...f, pactar: e.target.checked }))}
              className="w-4 h-4 rounded"
            />
          </label>
          {form.pactar && (
            <div className="flex items-center justify-between gap-3 border-t border-linea px-3 py-2.5">
              <label htmlFor="lavado-valor" className="text-mini text-grafito">
                Valor a cobrar
                {tipo && (
                  <span className="text-niebla num"> · precio de lista {cop(tipo.precio)}</span>
                )}
              </label>
              <div className="w-36">
                <CampoPesos
                  id="lavado-valor"
                  valor={form.valorPactado}
                  onChange={(valorPactado) => setForm((f) => ({ ...f, valorPactado }))}
                  placeholder={tipo ? miles(tipo.precio) : '0'}
                  className="py-1.5"
                />
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <div>
            <label className="etiqueta" htmlFor="lavado-marca">
              Marca <span className="text-niebla font-normal">opcional</span>
            </label>
            <CampoMarca
              id="lavado-marca"
              valor={form.marca}
              disabled={guardando}
              onChange={(marca) => setForm((f) => ({ ...f, marca }))}
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="lavado-color">
              Color <span className="text-niebla font-normal">opcional</span>
            </label>
            <input
              id="lavado-color"
              value={form.color}
              onChange={set('color')}
              placeholder="Negro"
              autoComplete="off"
              className="campo"
            />
          </div>
        </div>

        <CascoCustodia
          id="lavado-locker"
          casco={form.casco}
          locker={form.locker}
          disabled={guardando}
          onCambio={(cambio) => setForm((f) => ({ ...f, ...cambio }))}
        />

        <button
          type="submit"
          disabled={guardando || !tipos?.length}
          className="btn-azul w-full py-3.5 mt-6"
        >
          <Icono nombre="lavadero" tam={17} />
          {guardando
            ? 'Ingresando…'
            : tipo
              ? `Ingresar al lavadero · ${cop(precio)}`
              : 'Ingresar al lavadero'}
        </button>
        <p className="mt-2.5 text-center text-micro text-niebla">
          Enter para guardar · se cobra al entregar la moto
        </p>
      </div>
    </form>
  )
}
