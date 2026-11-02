import { useEffect, useRef, useState } from 'react'
import CampoPesos, { CampoEntero } from '../components/CampoPesos.jsx'
import Icono from '../components/Icono.jsx'
import PanelCaja from '../components/PanelCaja.jsx'
import PanelVentas from '../components/PanelVentas.jsx'
import SimulacionCobro from '../components/SimulacionCobro.jsx'
import TiposLavada from '../components/TiposLavada.jsx'
import TramosHora from '../components/TramosHora.jsx'
import { cop } from '../lib/format.js'

/*
 * Métricas y configuración: la vista del administrador. Reúne lo que el
 * operario no necesita durante el turno — cuánto se ha vendido, cómo está la
 * caja y cuánto se cobra — y por eso el dinero salió del panel de operación.
 *
 * Ventas, Caja del día y Tipos de lavada no se guardan con la barra inferior:
 * leen y escriben por su cuenta (`window.api.metricas`, `window.api.caja` y
 * `window.api.lavadero`).
 */
const SECCIONES = [
  { id: 'ventas', etiqueta: 'Ventas', grupo: 'Métricas' },
  { id: 'caja', etiqueta: 'Caja del día', grupo: 'Métricas' },
  { id: 'tarifas', etiqueta: 'Precios', grupo: 'Configuración' },
  { id: 'lavadas', etiqueta: 'Tipos de lavada', grupo: 'Configuración' },
  { id: 'reglas', etiqueta: 'Reglas de cobro', grupo: 'Configuración' },
  { id: 'negocio', etiqueta: 'Negocio', grupo: 'Configuración' },
  { id: 'capacidad', etiqueta: 'Capacidad', grupo: 'Configuración' },
  { id: 'impresora', etiqueta: 'Impresora', grupo: 'Configuración' },
  { id: 'tiquete', etiqueta: 'Tiquete', grupo: 'Configuración' },
  { id: 'telegram', etiqueta: 'Telegram', grupo: 'Configuración' },
  { id: 'escaner', etiqueta: 'Escáner', grupo: 'Configuración' }
]

// Las métricas ocupan tres columnas; los ajustes se leen mejor angostos.
const ANCHOS = { ventas: 'max-w-4xl', caja: 'max-w-3xl' }

// Opción del selector de impresora que abre el campo para escribir a mano.
const OTRA_IMPRESORA = '__otra__'

// Lo único que guarda "Imprimir página de prueba": lo demás espera al botón.
const CAMPOS_IMPRESORA = [
  'impresora_interface',
  'impresora_tipo',
  'impresora_ancho',
  'imprimir_automatico',
  'impresora_sin_tildes'
]

/**
 * La configuración vuelve a llegar cada vez que se guarda algo (y antes, con
 * cada refresco del panel): se toma la nueva sin perder lo que el
 * administrador está escribiendo y todavía no guardó. Antes el formulario se
 * reiniciaba cada 5 s y el precio recién escrito volvía al guardado.
 */
function conservarEdiciones(form, anterior, nueva) {
  if (!anterior) return { ...nueva }
  const resultado = { ...nueva }
  for (const campo of Object.keys(form)) {
    if (String(form[campo]) !== String(anterior[campo])) resultado[campo] = form[campo]
  }
  return resultado
}

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

export default function Configuracion({ settings, seccionInicial = 'tarifas', onGuardado, onAviso }) {
  const [seccion, setSeccion] = useState(seccionInicial)
  const [form, setForm] = useState(settings || {})
  const [guardando, setGuardando] = useState(false)
  const [probando, setProbando] = useState(false)
  const [instaladas, setInstaladas] = useState(null)
  const [conexionManual, setConexionManual] = useState(false)
  const [telegramOcupado, setTelegramOcupado] = useState(false)
  // La configuración sobre la que se empezó a editar: con ella se sabe qué
  // campos tocó el administrador cuando llega una nueva.
  const base = useRef(settings)

  useEffect(() => {
    if (!settings) return
    const anterior = base.current
    base.current = settings
    setForm((f) => conservarEdiciones(f, anterior, settings))
  }, [settings])

  // La lista se pide al entrar a la sección: así aparece una impresora que se
  // acaba de instalar sin reiniciar la aplicación.
  useEffect(() => {
    if (seccion !== 'impresora') return
    let vigente = true
    window.api.impresora.lista().then((res) => {
      if (vigente) setInstaladas(res.ok ? res.data : [])
    })
    return () => {
      vigente = false
    }
  }, [seccion])

  // El rail entra por "Métricas" y el engranaje por "Precios": la misma vista
  // se abre en la sección que pidió quien navegó.
  useEffect(() => {
    setSeccion(seccionInicial)
  }, [seccionInicial])

  const set = (campo) => (valor) => setForm((f) => ({ ...f, [campo]: valor }))

  const sucio =
    settings && Object.keys(form).some((k) => String(form[k]) !== String(settings[k]))

  async function guardar() {
    setGuardando(true)
    const res = await window.api.settings.update(form)
    setGuardando(false)

    if (res.ok) {
      // Lo guardado ya viene normalizado (las reglas ordenadas, los montos en
      // número): el formulario pasa a ser exactamente eso.
      base.current = res.data
      setForm(res.data)
      onGuardado?.(res.data)
      onAviso?.({ tipo: 'ok', texto: 'Configuración guardada' })
    } else {
      onAviso?.({ tipo: 'error', texto: res.error })
    }
  }

  async function probarImpresora() {
    setProbando(true)
    // Se guarda primero la impresora: la prueba usa la configuración de la
    // base de datos. Un precio a medio escribir en otra sección no se toca.
    const guardado = await window.api.settings.update(
      Object.fromEntries(CAMPOS_IMPRESORA.map((c) => [c, form[c]]))
    )
    if (guardado.ok) onGuardado?.(guardado.data)
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

  async function buscarChatTelegram() {
    setTelegramOcupado(true)
    const res = await window.api.telegram.buscarChat(form.telegram_token)
    setTelegramOcupado(false)

    if (res.ok) {
      set('telegram_chat_id')(res.data.id)
      onAviso?.({ tipo: 'ok', texto: `Chat encontrado: ${res.data.nombre || res.data.id}` })
    } else {
      onAviso?.({ tipo: 'error', texto: 'No se encontró el chat', detalle: res.error })
    }
  }

  async function probarTelegram() {
    setTelegramOcupado(true)
    const res = await window.api.telegram.probar({
      token: form.telegram_token,
      chatId: form.telegram_chat_id
    })
    setTelegramOcupado(false)

    onAviso?.(
      res.ok && res.data?.ok
        ? { tipo: 'ok', texto: 'Mensaje de prueba enviado' }
        : {
            tipo: 'error',
            texto: 'No se pudo enviar el mensaje',
            detalle: res.data?.motivo || res.error
          }
    )
  }

  if (!settings) {
    return <p className="p-8 text-mini text-niebla">Cargando configuración…</p>
  }

  const conexion = String(form.impresora_interface ?? '')
  const nombreConexion = conexion.replace(/^printer:/i, '').trim()
  const enLista = Boolean(instaladas?.some((p) => p.nombre === nombreConexion))
  const escribiendoConexion = conexionManual || (Boolean(conexion) && instaladas !== null && !enLista)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex gap-6 p-5 overflow-hidden">
        <nav className="w-40 shrink-0" aria-label="Secciones de métricas y configuración">
          {SECCIONES.map((s, i) => (
            <div key={s.id}>
              {SECCIONES[i - 1]?.grupo !== s.grupo && (
                <h2 className="panel-titulo px-3 pt-3 pb-1.5 first:pt-0">{s.grupo}</h2>
              )}
              <button
                type="button"
                aria-current={seccion === s.id ? 'true' : undefined}
                onClick={() => setSeccion(s.id)}
                className={`relative w-full rounded-campo px-3 py-2 mb-0.5 text-left text-base
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
            </div>
          ))}
        </nav>

        <div className={`flex-1 min-w-0 overflow-y-auto ${ANCHOS[seccion] || 'max-w-2xl'}`}>
          {seccion === 'ventas' && <PanelVentas onAviso={onAviso} />}

          {seccion === 'caja' && <PanelCaja onAviso={onAviso} />}

          {seccion === 'tarifas' && (
            <>
              <section className="panel overflow-hidden">
                <p className="px-4 py-3 bg-lienzo text-mini text-grafito border-b border-linea">
                  Los precios se aplican al guardar y rigen desde el siguiente cobro. Las salidas ya
                  liquidadas conservan el valor con el que se cobraron.
                </p>

                <Ajuste titulo="Hora iniciada" ayuda="Se cobra la hora completa apenas empieza">
                  <CampoPesos valor={form.tarifa_hora} onChange={set('tarifa_hora')} />
                </Ajuste>
                <Ajuste
                  titulo="Amanecida"
                  ayuda="También es el tope: por hora nunca se cobra más que esto en 24 h"
                >
                  <CampoPesos valor={form.tarifa_amanecida} onChange={set('tarifa_amanecida')} />
                </Ajuste>
                <Ajuste
                  titulo="Mensualidad"
                  ayuda="Se cobra al registrar la entrada, con su comprobante; a la salida no se cobra nada"
                >
                  <CampoPesos valor={form.tarifa_mensualidad} onChange={set('tarifa_mensualidad')} />
                </Ajuste>
                <Ajuste titulo="Tiquete perdido" ayuda="Recargo que se suma al total de la salida">
                  <CampoPesos
                    valor={form.cargo_ticket_perdido}
                    onChange={set('cargo_ticket_perdido')}
                  />
                </Ajuste>
                <Ajuste
                  titulo="Base de caja predeterminada"
                  ayuda="Con cuánto abre una jornada si la anterior no se cerró; si se cerró, abre con lo que quedó en el cajón"
                >
                  <CampoPesos
                    valor={form.caja_base_predeterminada}
                    onChange={set('caja_base_predeterminada')}
                  />
                </Ajuste>
              </section>

              <TramosHora valor={form.tramos_hora} onChange={set('tramos_hora')} />
              <SimulacionCobro form={form} sinGuardar={sucio} />
            </>
          )}

          {seccion === 'lavadas' && <TiposLavada onAviso={onAviso} />}

          {seccion === 'reglas' && (
            <>
              <section className="panel overflow-hidden">
                <Ajuste
                  titulo="Minutos de gracia"
                  ayuda="Si la moto sale antes de este tiempo, no se le cobra"
                  ancho="w-28"
                >
                  <CampoEntero valor={form.minutos_gracia} onChange={set('minutos_gracia')} />
                </Ajuste>
                <Ajuste
                  titulo="Horas por bloque"
                  ayuda="Cada cuántas horas se reinicia el tope de amanecida"
                  ancho="w-28"
                >
                  <CampoEntero
                    valor={form.horas_tope_dia}
                    onChange={set('horas_tope_dia')}
                    cifras={2}
                  />
                </Ajuste>

                <div className="flex items-center justify-between gap-4 px-4 py-3 bg-lienzo text-mini text-grafito">
                  <span>
                    Los valores fijos por tramo de horas (por ejemplo, de 5 a 12 h) se arman en
                    Precios, en Reglas por tiempo.
                  </span>
                  <button
                    type="button"
                    onClick={() => setSeccion('tarifas')}
                    className="btn-fantasma py-1.5 shrink-0"
                  >
                    Ir a Precios
                    <Icono nombre="derecha" tam={14} />
                  </button>
                </div>
              </section>

              <SimulacionCobro form={form} sinGuardar={sucio} />
            </>
          )}

          {seccion === 'negocio' && (
            <section className="panel overflow-hidden">
              <Ajuste
                titulo="Nombre"
                ayuda="Aparece en la barra superior, el tiquete y el recibo"
                ancho="w-64"
              >
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
              <Ajuste titulo="Dirección" ayuda="Sale en el tiquete y el recibo" ancho="w-64">
                <input
                  value={form.direccion ?? ''}
                  onChange={(e) => set('direccion')(e.target.value)}
                  placeholder="Calle 10 #4-32"
                  className="campo"
                />
              </Ajuste>
              <Ajuste titulo="Teléfono" ayuda="Sale en el tiquete y el recibo" ancho="w-64">
                <input
                  value={form.telefono ?? ''}
                  onChange={(e) => set('telefono')(e.target.value)}
                  placeholder="3226746848"
                  className="campo num"
                />
              </Ajuste>
              <Ajuste
                titulo="Horario de atención"
                ayuda="Sale en el tiquete y el recibo. Déjelo vacío para no imprimirlo."
                ancho="w-64"
              >
                <input
                  value={form.horario ?? ''}
                  onChange={(e) => set('horario')(e.target.value)}
                  placeholder="7:00 a. m. - 9:00 p. m."
                  className="campo"
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
                <CampoEntero valor={form.total_celdas} onChange={set('total_celdas')} />
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
                titulo="Impresora"
                ayuda="La térmica tal como aparece en Windows. Si no está en la lista, instale primero su driver."
                ancho="w-64"
              >
                <select
                  value={escribiendoConexion ? OTRA_IMPRESORA : enLista ? nombreConexion : ''}
                  onChange={(e) => {
                    const valor = e.target.value
                    if (valor === OTRA_IMPRESORA) {
                      setConexionManual(true)
                      return
                    }
                    setConexionManual(false)
                    set('impresora_interface')(valor)
                  }}
                  className="campo"
                >
                  <option value="">
                    {instaladas === null ? 'Buscando impresoras…' : '— Escoja la impresora —'}
                  </option>
                  {instaladas?.map((p) => (
                    <option key={p.nombre} value={p.nombre}>
                      {p.etiqueta}
                    </option>
                  ))}
                  <option value={OTRA_IMPRESORA}>Otra · por red (tcp://…)</option>
                </select>
                {escribiendoConexion && (
                  <input
                    value={conexion}
                    onChange={(e) => set('impresora_interface')(e.target.value)}
                    placeholder="tcp://192.168.1.50"
                    className="campo mt-2"
                    spellCheck={false}
                  />
                )}
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
              <Ajuste titulo="Ancho del papel" ancho="w-52">
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
                ayuda="El tiquete al registrar la entrada al parqueadero. Al cobrar decide el botón: «Cobrar e imprimir» o «Cobrar sin imprimir»"
                ancho="w-14"
              >
                <input
                  type="checkbox"
                  checked={Boolean(Number(form.imprimir_automatico))}
                  onChange={(e) => set('imprimir_automatico')(e.target.checked ? 1 : 0)}
                  className="w-4 h-4 rounded ml-auto block"
                />
              </Ajuste>
              <Ajuste
                titulo="Imprimir sin tildes"
                ayuda="Actívelo sólo si en la página de prueba las tildes y la ñ salen como símbolos raros"
                ancho="w-14"
              >
                <input
                  type="checkbox"
                  checked={Boolean(Number(form.impresora_sin_tildes))}
                  onChange={(e) => set('impresora_sin_tildes')(e.target.checked ? 1 : 0)}
                  className="w-4 h-4 rounded ml-auto block"
                />
              </Ajuste>

              <div className="px-4 py-3.5 bg-lienzo space-y-2.5">
                <button
                  type="button"
                  onClick={probarImpresora}
                  disabled={probando || !form.impresora_interface}
                  className="btn-neutro"
                >
                  <Icono nombre="impresora" tam={16} />
                  {probando ? 'Enviando…' : 'Imprimir página de prueba'}
                </button>
                <p className="text-mini text-grafito">
                  La página trae un código de barras del mismo tamaño que el del tiquete. Al
                  escanearlo, la aplicación debe avisar “PRUEBA no está adentro”: así se comprueba
                  la impresora y el lector a la vez.
                </p>
              </div>
            </section>
          )}

          {seccion === 'tiquete' && (
            <section className="panel overflow-hidden">
              <div className="px-4 py-3.5">
                <label className="text-base font-medium" htmlFor="politicas-tiquete">
                  Políticas
                </label>
                <p className="text-mini text-grafito mt-0.5">
                  Salen al pie del tiquete de entrada. Un párrafo por renglón; lo que va antes de
                  los dos puntos sale en negrilla. Donde escriba{' '}
                  <code className="num text-tinta">{'{ticket_perdido}'}</code> se imprime el
                  recargo configurado en Precios (hoy {cop(form.cargo_ticket_perdido)}).
                </p>
                <textarea
                  id="politicas-tiquete"
                  rows={10}
                  value={form.politicas_tiquete ?? ''}
                  onChange={(e) => set('politicas_tiquete')(e.target.value)}
                  className="campo font-normal leading-snug resize-y mt-3"
                />
              </div>
              <p className="px-4 py-3 bg-lienzo text-mini text-grafito border-t border-linea">
                Encima de las políticas, el tiquete lleva el nombre, la dirección, el horario y el
                teléfono de la sección Negocio, la placa en letra grande, su código de barras y la
                hora de entrada. Déjelas vacías para imprimir el tiquete sin políticas.
              </p>
            </section>
          )}

          {seccion === 'telegram' && (
            <section className="panel overflow-hidden">
              <Ajuste
                titulo="Avisar cada cierre de caja"
                ayuda="El administrador recibe las ventas del día, el cuadre y lo que quedó en el cajón. Si el equipo no tiene internet, el aviso sale cuando vuelva."
                ancho="w-14"
              >
                <input
                  type="checkbox"
                  aria-label="Avisar cada cierre de caja"
                  checked={Boolean(Number(form.telegram_activo))}
                  onChange={(e) => set('telegram_activo')(e.target.checked ? 1 : 0)}
                  className="w-4 h-4 rounded ml-auto block"
                />
              </Ajuste>
              <Ajuste titulo="Token del bot" ayuda="Lo entrega @BotFather al crear el bot" ancho="w-72">
                <input
                  type="password"
                  aria-label="Token del bot"
                  value={form.telegram_token ?? ''}
                  onChange={(e) => set('telegram_token')(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="campo num"
                />
              </Ajuste>
              <Ajuste
                titulo="Chat del administrador"
                ayuda="Después de escribirle al bot, toque Buscar y se llena solo"
                ancho="w-72"
              >
                <div className="flex gap-2">
                  <input
                    aria-label="Chat del administrador"
                    value={form.telegram_chat_id ?? ''}
                    onChange={(e) => set('telegram_chat_id')(e.target.value)}
                    spellCheck={false}
                    className="campo num min-w-0"
                  />
                  <button
                    type="button"
                    onClick={buscarChatTelegram}
                    disabled={telegramOcupado || !form.telegram_token}
                    className="btn-neutro shrink-0"
                  >
                    Buscar
                  </button>
                </div>
              </Ajuste>

              <div className="px-4 py-3.5 bg-lienzo space-y-2.5">
                <button
                  type="button"
                  onClick={probarTelegram}
                  disabled={telegramOcupado || !form.telegram_token || !form.telegram_chat_id}
                  className="btn-neutro"
                >
                  <Icono nombre="telegram" tam={16} />
                  {telegramOcupado ? 'Consultando…' : 'Enviar mensaje de prueba'}
                </button>
                <ol className="list-decimal pl-4 space-y-1 text-mini text-grafito">
                  <li>En Telegram, busque a @BotFather, escriba /newbot y copie el token aquí.</li>
                  <li>Desde el Telegram del administrador, abra el bot y escríbale cualquier cosa.</li>
                  <li>Toque Buscar y luego Enviar mensaje de prueba.</li>
                  <li>Si el mensaje llegó, active el aviso y guarde.</li>
                </ol>
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
