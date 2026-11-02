import { useCallback, useEffect, useState } from 'react'
import CampoPesos from './CampoPesos.jsx'
import Icono from './Icono.jsx'
import { cop } from '../lib/format.js'

const NUEVO = { nombre: '', precio: '' }

/**
 * Catálogo de lavadas: cada una con su nombre y su precio. Como la caja, se
 * guarda por su cuenta, fila por fila, y no pasa por la barra de "Guardar
 * cambios" de la configuración.
 */
export default function TiposLavada({ onAviso }) {
  const [tipos, setTipos] = useState(null)
  const [nuevo, setNuevo] = useState(NUEVO)
  const [edicion, setEdicion] = useState(null) // { id, nombre, precio }
  const [porQuitar, setPorQuitar] = useState(null)
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    const res = await window.api.lavadero.tipos()
    if (res.ok) setTipos(res.data)
    else onAviso?.({ tipo: 'error', texto: 'No se pudieron leer las lavadas', detalle: res.error })
  }, [onAviso])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function guardar(datos) {
    setOcupado(true)
    const res = await window.api.lavadero.guardarTipo(datos)
    setOcupado(false)

    if (!res.ok) {
      onAviso?.({ tipo: 'error', texto: res.error })
      return false
    }
    onAviso?.({
      tipo: 'ok',
      texto: datos.id ? `${res.data.nombre} actualizada` : `${res.data.nombre} agregada`
    })
    cargar()
    return true
  }

  async function agregar(e) {
    e.preventDefault()
    if (await guardar(nuevo)) setNuevo(NUEVO)
  }

  async function quitar(tipo) {
    setOcupado(true)
    const res = await window.api.lavadero.retirarTipo(tipo.id)
    setOcupado(false)
    setPorQuitar(null)

    if (res.ok) {
      onAviso?.({ tipo: 'ok', texto: `${tipo.nombre} ya no se ofrece` })
      cargar()
    } else {
      onAviso?.({ tipo: 'error', texto: res.error })
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={agregar} className="panel overflow-hidden">
        <div className="px-4 pt-3.5 pb-1">
          <h3 className="text-base font-medium">Nueva lavada</h3>
          <p className="text-mini text-grafito mt-0.5">
            Aparece como opción al ingresar una moto al lavadero.
          </p>
        </div>
        <div className="flex items-end gap-2.5 px-4 pt-2 pb-4">
          <div className="flex-1 min-w-0">
            <label className="etiqueta" htmlFor="lavada-nombre">
              Nombre
            </label>
            <input
              id="lavada-nombre"
              value={nuevo.nombre}
              maxLength={40}
              disabled={ocupado}
              onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))}
              placeholder="Ej. Lavada con cera"
              autoComplete="off"
              className="campo"
            />
          </div>
          <div className="w-36 shrink-0">
            <label className="etiqueta" htmlFor="lavada-precio">
              Precio
            </label>
            <CampoPesos
              id="lavada-precio"
              valor={nuevo.precio}
              disabled={ocupado}
              onChange={(precio) => setNuevo((n) => ({ ...n, precio }))}
              placeholder="0"
            />
          </div>
          <button
            type="submit"
            disabled={ocupado || !nuevo.nombre.trim() || nuevo.precio === ''}
            className="btn-azul shrink-0"
          >
            <Icono nombre="mas" tam={16} />
            Agregar
          </button>
        </div>
      </form>

      <section className="panel overflow-hidden">
        <h3 className="panel-titulo px-4 pt-3.5 pb-2">
          Lavadas que se ofrecen{tipos?.length ? ` · ${tipos.length}` : ''}
        </h3>

        {tipos === null && <p className="px-4 pb-4 text-mini text-niebla">Cargando…</p>}

        {tipos?.length === 0 && (
          <p className="px-4 pb-5 text-mini text-niebla">
            Todavía no hay lavadas. Agregue la primera arriba: sin ellas el lavadero no puede
            ingresar motos.
          </p>
        )}

        {tipos?.map((t) =>
          edicion?.id === t.id ? (
            <form
              key={t.id}
              onSubmit={async (e) => {
                e.preventDefault()
                if (await guardar(edicion)) setEdicion(null)
              }}
              className="flex items-center gap-2.5 px-4 py-2.5 border-t border-linea bg-lienzo"
            >
              <input
                value={edicion.nombre}
                maxLength={40}
                autoFocus
                onChange={(e) => setEdicion((ed) => ({ ...ed, nombre: e.target.value }))}
                onKeyDown={(e) => e.key === 'Escape' && setEdicion(null)}
                aria-label="Nombre de la lavada"
                className="campo flex-1 min-w-0 py-1.5"
              />
              <div className="w-36 shrink-0">
                <CampoPesos
                  valor={edicion.precio}
                  onChange={(precio) => setEdicion((ed) => ({ ...ed, precio }))}
                  onKeyDown={(e) => e.key === 'Escape' && setEdicion(null)}
                  aria-label="Precio de la lavada"
                  className="py-1.5"
                />
              </div>
              <button type="submit" disabled={ocupado} className="btn-azul py-1.5 shrink-0">
                Guardar
              </button>
              <button
                type="button"
                onClick={() => setEdicion(null)}
                className="btn-fantasma py-1.5 shrink-0"
              >
                Cancelar
              </button>
            </form>
          ) : porQuitar === t.id ? (
            <div
              key={t.id}
              className="flex items-center gap-3 px-4 py-2.5 border-t border-linea bg-alerta-50"
            >
              <span className="flex-1 min-w-0 text-base text-alerta">
                ¿Dejar de ofrecer <b className="font-medium">{t.nombre}</b>? Las motos que ya
                la tienen la conservan.
              </span>
              <button
                type="button"
                onClick={() => quitar(t)}
                disabled={ocupado}
                className="btn-alerta py-1.5 shrink-0"
              >
                Quitar
              </button>
              <button
                type="button"
                onClick={() => setPorQuitar(null)}
                className="btn-fantasma py-1.5 shrink-0"
              >
                No
              </button>
            </div>
          ) : (
            <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-linea">
              <span className="flex-1 min-w-0 truncate text-base font-medium">{t.nombre}</span>
              <span className="text-base num">{cop(t.precio)}</span>
              <button
                type="button"
                onClick={() => {
                  setPorQuitar(null)
                  setEdicion({ id: t.id, nombre: t.nombre, precio: t.precio })
                }}
                title="Cambiar nombre o precio"
                aria-label={`Editar ${t.nombre}`}
                className="rounded-md p-1.5 text-niebla transition-colors duration-rapido
                           hover:bg-lienzo hover:text-azul-700"
              >
                <Icono nombre="editar" tam={16} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setEdicion(null)
                  setPorQuitar(t.id)
                }}
                title="Dejar de ofrecer"
                aria-label={`Quitar ${t.nombre}`}
                className="rounded-md p-1.5 text-niebla transition-colors duration-rapido
                           hover:bg-alerta-50 hover:text-alerta"
              >
                <Icono nombre="eliminar" tam={16} />
              </button>
            </div>
          )
        )}
      </section>

      <p className="text-micro text-niebla px-1">
        Un cambio de precio rige para las motos que entren después: las que ya están en el
        lavadero conservan el valor con el que entraron.
      </p>
    </div>
  )
}
