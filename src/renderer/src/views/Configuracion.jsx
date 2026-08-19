import { useEffect, useState } from 'react'
import Icono from '../components/Icono.jsx'
import { cop } from '../lib/format.js'

const SECCIONES = [
  { id: 'tarifas', etiqueta: 'Tarifas' },
  { id: 'reglas', etiqueta: 'Reglas de cobro' },
  { id: 'negocio', etiqueta: 'Negocio' },
  { id: 'capacidad', etiqueta: 'Capacidad' },
  { id: 'impresora', etiqueta: 'Impresora' },
  { id: 'escaner', etiqueta: 'Escáner' }
]

/** Fila de ajuste: nombre y explicación a la izquierda, control a la derecha. */
function Ajuste({ titulo, ayuda, children, ancho = 'w-40' }) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3.5 border-b border-linea last:border-b-0">
      <div className="min-w-0">
        <div className="text-base font-medium">{titulo}</div>
        {ayuda && <p className="text-mini text-grafito mt-0.5">{ayuda}</p>}
      </div>
      <div className={`${ancho} shrink-0`}>{children}</div>
    </div>
  )
}

function Pesos({ valor, onChange }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-niebla text-base">$</span>
      <input
        type="number"
        min="0"
        step="100"
        value={valor ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="campo num pl-7 text-right"
      />
    </div>
  )
}

export default function Configuracion({ settings, onGuardado, onAviso }) {
  const [seccion, setSeccion] = useState('tarifas')
  const [form, setForm] = useState(settings || {})
  const [guardando, setGuardando] = useState(false)
  const [probando, setProbando] = useState(false)

  useEffect(() => {
    if (settings) setForm(settings)
  }, [settings])

  const set = (campo) => (valor) => setForm((f) => ({ ...f, [campo]: valor }))

  const sucio =
    settings && Object.keys(form).some((k) => String(form[k]) !== String(settings[k]))

  async function guardar() {
    setGuardando(true)
    const res = await window.api.settings.update(form)
    setGuardando(false)

    if (res.ok) {
      onGuardado?.(res.data)
      onAviso?.({ tipo: 'ok', texto: 'Configuración guardada' })
    } else {
      onAviso?.({ tipo: 'error', texto: res.error })
    }
  }

  async function probarImpresora() {
    setProbando(true)
    // Se guarda primero: la prueba usa la configuración de la base de datos.
    await window.api.settings.update(form)
    const res = await window.api.impresora.prueba()
    setProbando(false)

    onAviso?.(
      res.ok && res.data?.ok
        ? { tipo: 'ok', texto: 'Prueba enviada a la impresora' }
        : {
            tipo: 'error',
            texto: 'La impresora no respondió',
            detalle: res.data?.motivo || res.error
          }
    )
  }

  if (!settings) {
    return <p className="p-8 text-mini text-niebla">Cargando configuración…</p>
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex gap-6 p-5 overflow-hidden">
        <nav className="w-40 shrink-0 space-y-0.5" aria-label="Secciones de configuración">
          {SECCIONES.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={seccion === s.id ? 'true' : undefined}
              onClick={() => setSeccion(s.id)}
              className={`relative w-full rounded-campo px-3 py-2 text-left text-base
                transition-colors duration-rapido
                ${
                  seccion === s.id
                    ? 'bg-azul-50 text-azul-700 font-medium'
                    : 'text-grafito hover:bg-lienzo hover:text-tinta'
                }`}
            >
              {seccion === s.id && (
                <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-azul" />
              )}
              {s.etiqueta}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-w-0 max-w-2xl overflow-y-auto">
          {seccion === 'tarifas' && (
            <section className="panel overflow-hidden">
              <Ajuste titulo="Hora iniciada" ayuda="Se cobra la hora completa apenas empieza">
                <Pesos valor={form.tarifa_hora} onChange={set('tarifa_hora')} />
              </Ajuste>
              <Ajuste
                titulo="Amanecida"
                ayuda="También es el tope: por hora nunca se cobra más que esto en 24 h"
              >
                <Pesos valor={form.tarifa_amanecida} onChange={set('tarifa_amanecida')} />
              </Ajuste>
              <Ajuste titulo="Mensualidad" ayuda="Estos vehículos salen sin pagar nada">
                <Pesos valor={form.tarifa_mensualidad} onChange={set('tarifa_mensualidad')} />
              </Ajuste>
              <Ajuste titulo="Tiquete perdido" ayuda="Recargo que se suma al total de la salida">
                <Pesos valor={form.cargo_ticket_perdido} onChange={set('cargo_ticket_perdido')} />
              </Ajuste>
            </section>
          )}

          {seccion === 'reglas' && (
            <section className="panel overflow-hidden">
              <Ajuste
                titulo="Minutos de gracia"
                ayuda="Si la moto sale antes de este tiempo, no se le cobra"
                ancho="w-28"
              >
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={form.minutos_gracia ?? ''}
                  onChange={(e) => set('minutos_gracia')(e.target.value)}
                  className="campo num text-right"
                />
              </Ajuste>
              <Ajuste
                titulo="Horas por bloque"
                ayuda="Cada cuántas horas se reinicia el tope de amanecida"
                ancho="w-28"
              >
                <input
                  type="number"
                  min="1"
                  max="48"
                  value={form.horas_tope_dia ?? ''}
                  onChange={(e) => set('horas_tope_dia')(e.target.value)}
                  className="campo num text-right"
                />
              </Ajuste>

              <div className="px-4 py-3.5 bg-lienzo text-mini text-grafito">
                Con estos valores, una moto que se queda 10 horas paga{' '}
                <b className="text-tinta num font-medium">
                  {cop(
                    Math.min(
                      10 * Number(form.tarifa_hora || 0),
                      Number(form.tarifa_amanecida || 0)
                    )
                  )}
                </b>
                .
              </div>
            </section>
          )}

          {seccion === 'negocio' && (
            <section className="panel overflow-hidden">
              <Ajuste titulo="Nombre" ayuda="Aparece en la barra superior y en el recibo" ancho="w-64">
                <input
                  value={form.nombre_parqueadero ?? ''}
                  onChange={(e) => set('nombre_parqueadero')(e.target.value)}
                  className="campo"
                />
              </Ajuste>
              <Ajuste titulo="NIT" ancho="w-64">
                <input
                  value={form.nit ?? ''}
                  onChange={(e) => set('nit')(e.target.value)}
                  placeholder="900123456-7"
                  className="campo num"
                />
              </Ajuste>
              <Ajuste titulo="Dirección" ancho="w-64">
                <input
                  value={form.direccion ?? ''}
                  onChange={(e) => set('direccion')(e.target.value)}
                  placeholder="Calle 10 #4-32"
                  className="campo"
                />
              </Ajuste>
              <Ajuste titulo="Teléfono" ancho="w-64">
                <input
                  value={form.telefono ?? ''}
                  onChange={(e) => set('telefono')(e.target.value)}
                  placeholder="3226746848"
                  className="campo num"
                />
              </Ajuste>
              <Ajuste titulo="Mensaje del recibo" ayuda="Última línea del papel" ancho="w-64">
                <input
                  value={form.mensaje_recibo ?? ''}
                  onChange={(e) => set('mensaje_recibo')(e.target.value)}
                  placeholder="Gracias por preferirnos"
                  className="campo"
                />
              </Ajuste>
            </section>
          )}

          {seccion === 'capacidad' && (
            <section className="panel overflow-hidden">
              <Ajuste
                titulo="Total de celdas"
                ayuda="Cuántas motos caben. La cuadrícula del panel se ajusta sola."
                ancho="w-28"
              >
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={form.total_celdas ?? ''}
                  onChange={(e) => set('total_celdas')(e.target.value)}
                  className="campo num text-right"
                />
              </Ajuste>

              {Number(form.total_celdas) < Number(settings.total_celdas) && (
                <p className="px-4 py-3.5 bg-alerta-50 text-mini text-alerta flex items-start gap-2">
                  <Icono nombre="alerta" tam={16} />
                  Va a reducir la capacidad. Las motos que estén en celdas por encima del nuevo
                  total siguen adentro, pero aparecerán como “sin celda asignada”.
                </p>
              )}
            </section>
          )}

          {seccion === 'impresora' && (
            <section className="panel overflow-hidden">
              <Ajuste
                titulo="Conexión"
                ayuda="Nombre en Windows: printer:JAL58M — o por red: tcp://192.168.1.50"
                ancho="w-64"
              >
                <input
                  value={form.impresora_interface ?? ''}
                  onChange={(e) => set('impresora_interface')(e.target.value)}
                  placeholder="printer:JAL58M"
                  className="campo"
                  spellCheck={false}
                />
              </Ajuste>
              <Ajuste titulo="Perfil de comandos" ayuda="La JAL58M usa ESC/POS: deje EPSON" ancho="w-40">
                <select
                  value={form.impresora_tipo ?? 'EPSON'}
                  onChange={(e) => set('impresora_tipo')(e.target.value)}
                  className="campo"
                >
                  <option value="EPSON">EPSON (ESC/POS)</option>
                  <option value="STAR">STAR</option>
                </select>
              </Ajuste>
              <Ajuste titulo="Ancho del papel" ancho="w-40">
                <select
                  value={form.impresora_ancho ?? 32}
                  onChange={(e) => set('impresora_ancho')(e.target.value)}
                  className="campo"
                >
                  <option value="32">58 mm · 32 caracteres</option>
                  <option value="48">80 mm · 48 caracteres</option>
                </select>
              </Ajuste>
              <Ajuste
                titulo="Imprimir automáticamente"
                ayuda="Tiquete al entrar y recibo al salir, sin preguntar"
                ancho="w-14"
              >
                <input
                  type="checkbox"
                  checked={Boolean(Number(form.imprimir_automatico))}
                  onChange={(e) => set('imprimir_automatico')(e.target.checked ? 1 : 0)}
                  className="w-4 h-4 rounded ml-auto block"
                />
              </Ajuste>

              <div className="px-4 py-3.5 bg-lienzo">
                <button
                  type="button"
                  onClick={probarImpresora}
                  disabled={probando || !form.impresora_interface}
                  className="btn-neutro"
                >
                  <Icono nombre="impresora" tam={16} />
                  {probando ? 'Enviando…' : 'Imprimir página de prueba'}
                </button>
              </div>
            </section>
          )}

          {seccion === 'escaner' && (
            <section className="panel p-5 space-y-4 text-base">
              <p className="text-grafito">
                El lector <b className="text-tinta font-medium">Jaltech PLUS 1D/QR</b> no necesita
                configuración: Windows lo reconoce como teclado y la aplicación lo escucha todo el
                tiempo, en cualquier pantalla.
              </p>

              <ul className="space-y-2.5 text-grafito">
                <li className="flex gap-2.5">
                  <Icono nombre="visto" tam={17} className="text-azul-700 mt-0.5" />
                  <span>
                    Si el código corresponde a una moto que está adentro, se abre su salida con el
                    cobro ya calculado.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <Icono nombre="visto" tam={17} className="text-azul-700 mt-0.5" />
                  <span>
                    Si no está adentro, se abre la ficha del vehículo con su historial.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <Icono nombre="visto" tam={17} className="text-azul-700 mt-0.5" />
                  <span>
                    Estando dentro de un campo de placa, el código cae en el campo y no salta de
                    pantalla.
                  </span>
                </li>
              </ul>

              <p className="text-mini text-niebla pt-2 border-t border-linea">
                El indicador del rail se ilumina en azul mientras entra una lectura. Si nunca se
                ilumina, revise que el lector esté configurado en modo teclado (HID) y que termine
                cada código con Enter.
              </p>
            </section>
          )}
        </div>
      </div>

      {/* Barra de guardado: sólo aparece cuando hay algo que guardar. */}
      {sucio && (
        <div className="shrink-0 flex items-center justify-end gap-3 border-t border-linea bg-blanco px-5 py-3">
          <span className="text-mini text-grafito mr-auto">Hay cambios sin guardar</span>
          <button type="button" onClick={() => setForm(settings)} className="btn-fantasma">
            Descartar
          </button>
          <button type="button" onClick={guardar} disabled={guardando} className="btn-azul">
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      )}
    </div>
  )
}
