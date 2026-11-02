import { useState } from 'react'
import CampoPesos from './CampoPesos.jsx'
import Icono from './Icono.jsx'
import { cop } from '../lib/format.js'

/**
 * El total, con un lápiz para cambiarlo cuando se acuerda otro valor con el
 * cliente al momento de pagar (casi siempre un descuento). Lo acordado es lo
 * que se cobra y lo que suma a las ventas.
 *
 * `acordado` es null mientras se cobra lo calculado. Enter y Esc dentro del
 * campo no llegan a la vista: ahí Enter cobra y Esc la despeja. Mientras se
 * edita, `onEditando(true)`: la vista no debe cobrar con un valor sin aplicar.
 */
export default function TotalEditable({
  calculado,
  acordado = null,
  onAcordar,
  onEditando,
  editable = true,
  etiqueta = 'Total a cobrar'
}) {
  const [editando, setEditandoLocal] = useState(false)
  const [borrador, setBorrador] = useState('')

  const hayAcuerdo = acordado !== null && acordado !== undefined
  const total = hayAcuerdo ? acordado : calculado
  const diferencia = total - calculado

  function setEditando(valor) {
    setEditandoLocal(valor)
    onEditando?.(valor)
  }

  function abrir() {
    setBorrador(total)
    setEditando(true)
  }

  function aplicar() {
    // Vacío es arrepentirse; volver a lo calculado es quitar el acuerdo.
    if (borrador !== '') onAcordar?.(borrador === calculado ? null : borrador)
    setEditando(false)
  }

  return (
    <div className="pt-3.5">
      <div className="flex items-center justify-between gap-2 min-h-6">
        <span className="text-micro font-medium text-grafito">{etiqueta}</span>
        {editable && !editando && (
          <button
            type="button"
            onClick={abrir}
            title="Cambiar el valor a cobrar"
            aria-label="Cambiar el valor a cobrar"
            className="rounded-md p-1 text-niebla transition-colors duration-rapido
                       hover:bg-lienzo hover:text-azul-700"
          >
            <Icono nombre="editar" tam={16} />
          </button>
        )}
      </div>

      {editando ? (
        <div className="mt-1.5">
          <CampoPesos
            grande
            autoFocus
            valor={borrador}
            onChange={setBorrador}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== 'Escape') return
              e.preventDefault()
              e.stopPropagation()
              if (e.key === 'Enter') aplicar()
              else setEditando(false)
            }}
            aria-label="Valor acordado con el cliente"
          />
          <div className="mt-2 flex gap-1.5">
            <button type="button" onClick={aplicar} className="btn-neutro flex-1 py-1.5 text-mini">
              Aplicar
            </button>
            <button
              type="button"
              onClick={() => setEditando(false)}
              className="btn-fantasma flex-1 py-1.5 text-mini"
            >
              Cancelar
            </button>
          </div>
          <p className="mt-1.5 text-micro text-niebla num">
            Calculado: {cop(calculado)} · Enter aplica, Esc cancela
          </p>
        </div>
      ) : (
        <>
          <div className="text-total font-semibold num tracking-tight mt-1">{cop(total)}</div>
          {hayAcuerdo && (
            <div className="mt-1.5 text-micro num">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-azul-700">
                  {diferencia < 0
                    ? `Descuento de ${cop(-diferencia)}`
                    : diferencia > 0
                      ? `${cop(diferencia)} más de lo calculado`
                      : 'Valor acordado'}
                </span>
                {editable && (
                  <button
                    type="button"
                    onClick={() => onAcordar?.(null)}
                    title="Volver a cobrar lo calculado"
                    className="font-medium text-grafito underline-offset-2 hover:text-tinta hover:underline"
                  >
                    Quitar
                  </button>
                )}
              </div>
              <div className="mt-0.5 text-niebla">Calculado: {cop(calculado)}</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
