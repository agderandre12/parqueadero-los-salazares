import { useCallback, useEffect, useState } from 'react'
import { useDashboard, useImpresora, useReloj } from './hooks/useDashboard.js'
import { useEscaner } from './hooks/useEscaner.js'
import Rail, { VISTAS } from './components/Rail.jsx'
import Toast from './components/Toast.jsx'
import Icono from './components/Icono.jsx'
import Panel from './views/Panel.jsx'
import NuevaEntrada from './views/NuevaEntrada.jsx'
import Salida from './views/Salida.jsx'
import Vehiculos from './views/Vehiculos.jsx'
import Lavadero from './views/Lavadero.jsx'
import Configuracion from './views/Configuracion.jsx'
import { celda as fmtCelda, cop, idDeCodigoLavado, normalizarPlaca } from './lib/format.js'

const TITULOS = {
  panel: 'Panel',
  entrada: 'Nueva entrada',
  salida: 'Registrar salida',
  vehiculos: 'Vehículos',
  lavadero: 'Lavadero',
  metricas: 'Métricas y caja',
  ajustes: 'Configuración'
}

/** Misma configuración campo por campo (el panel trae un objeto nuevo en cada refresco). */
const mismosAjustes = (a, b) => Boolean(a) && Object.keys(b).every((k) => a[k] === b[k])

export default function App() {
  const { stats, celdas, sinCelda, ultimos, settings, error, refrescar } = useDashboard(5000)
  const { impresora } = useImpresora(30000)
  const ahora = useReloj()

  const [vista, setVista] = useState('panel')
  const [placaEnFoco, setPlacaEnFoco] = useState(null)
  const [seccionAjustes, setSeccionAjustes] = useState('tarifas')
  const [aviso, setAviso] = useState(null)
  const [ajustes, setAjustes] = useState(null)

  const cerrarAviso = useCallback(() => setAviso(null), [])

  // Sólo se reemplaza si cambió algo: las vistas que la editan no deben
  // reiniciarse con cada refresco del panel.
  useEffect(() => {
    if (settings) setAjustes((previos) => (mismosAjustes(previos, settings) ? previos : settings))
  }, [settings])

  /**
   * Navega a una vista. `dato` es la placa que la vista precarga, o la sección
   * que abre la configuración.
   */
  const ir = useCallback((destino, dato = null) => {
    if (destino === 'ajustes') {
      setSeccionAjustes(dato || 'tarifas')
      setPlacaEnFoco(null)
    } else {
      setPlacaEnFoco(dato)
    }
    setVista(destino)
  }, [])

  const abrirSalida = useCallback((placa) => ir('salida', placa), [ir])

  /*
   * Lectura del escáner. Decide a dónde llevar al operario: un tiquete de
   * lavadero, a entregar esa lavada; una placa que está en el parqueadero, a
   * cobrarle; una que sólo está en el lavadero, a entregarla; si no, a su ficha.
   */
  const alEscanear = useCallback(
    async (codigo) => {
      const idLavado = idDeCodigoLavado(codigo)
      if (idLavado) {
        const res = await window.api.lavadero.obtener(idLavado)
        const lavado = res.ok ? res.data : null
        if (lavado?.estado === 'activo') ir('lavadero', lavado.placa)
        else
          setAviso({
            tipo: 'error',
            texto: lavado ? `La lavada de ${lavado.placa} ya se entregó` : 'Tiquete de lavadero desconocido'
          })
        return
      }

      const placa = normalizarPlaca(codigo)
      if (placa.length < 3) return

      const res = await window.api.vehiculos.buscar(placa)
      if (res.ok && res.data.some((v) => v.placa === placa)) return ir('salida', placa)

      const enLavadero = await window.api.lavadero.buscar(placa)
      if (enLavadero.ok && enLavadero.data.some((l) => l.placa === placa)) return ir('lavadero', placa)

      ir('vehiculos', placa)
      setAviso({ tipo: 'ok', texto: `${placa} no está adentro`, detalle: 'Se abrió su ficha' })
    },
    [ir]
  )

  const { leyendo } = useEscaner({ activo: true, onLectura: alEscanear })

  // Atajos de teclado: F1-F6 navegan (ver VISTAS en Rail.jsx), F8 configuración.
  useEffect(() => {
    const alTeclear = (e) => {
      const atajo = VISTAS.find((v) => v.tecla === e.key)
      if (atajo) {
        e.preventDefault()
        ir(atajo.id)
        return
      }
      if (e.key === 'F8') {
        e.preventDefault()
        ir('ajustes')
      }
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [ir])

  return (
    <div className="h-full flex bg-lienzo">
      <Rail vista={vista} onIr={ir} escaneando={leyendo} impresora={impresora} />

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="shrink-0 h-12 flex items-center justify-between gap-4 px-5 border-b border-linea bg-blanco">
          <div className="flex items-baseline gap-2.5 min-w-0">
            <h1 className="text-titulo font-medium truncate">{TITULOS[vista]}</h1>
            <span className="text-mini text-niebla truncate">
              {ajustes?.nombre_parqueadero || 'Parqueadero y Lavadero los salazares'}
            </span>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {stats.disponibles === 0 && stats.totalCeldas > 0 && (
              <span className="text-mini font-medium text-alerta">Parqueadero lleno</span>
            )}
            <span className="text-mini text-grafito num">
              {fmtCelda(stats.disponibles)} libres
            </span>
            <span className="text-mini text-grafito num tabular-nums">
              {ahora.toLocaleTimeString('es-CO', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
              })}
            </span>
          </div>
        </header>

        {error && (
          <div
            role="alert"
            className="shrink-0 flex items-center gap-2 border-b border-alerta/30 bg-alerta-50 px-5 py-2.5 text-base text-alerta"
          >
            <Icono nombre="alerta" tam={16} />
            No se pudo leer la base de datos: {error}
          </div>
        )}

        <main className="flex-1 min-h-0">
          {vista === 'panel' && (
            <Panel
              stats={stats}
              celdas={celdas}
              sinCelda={sinCelda}
              ultimos={ultimos}
              ahora={ahora}
              onIr={ir}
              onSalida={abrirSalida}
            />
          )}

          {vista === 'entrada' && (
            <NuevaEntrada
              settings={ajustes}
              celdaSugerida={celdas.find((c) => !c.ocupada)?.numero ?? null}
              hayCupo={stats.disponibles > 0}
              onRegistrado={({ vehicle, transaccion, impresion }) => {
                const lugar = vehicle.celda ? ` a la celda ${fmtCelda(vehicle.celda)}` : ''
                if (!transaccion) {
                  setAviso({
                    tipo: 'ok',
                    texto: `${vehicle.placa} entró${lugar}`,
                    detalle: impresion?.ok ? 'Tiquete impreso' : null
                  })
                } else if (impresion?.ok) {
                  setAviso({
                    tipo: 'ok',
                    texto: `${vehicle.placa} entró${lugar} · mensualidad ${cop(transaccion.monto)}`,
                    detalle: 'Comprobante de pago impreso'
                  })
                } else {
                  // El comprobante es obligatorio: si no salió, el operario
                  // tiene que saberlo para reimprimirlo desde Vehículos.
                  setAviso({
                    tipo: 'error',
                    texto: `Mensualidad de ${vehicle.placa} cobrada, pero el comprobante no se imprimió`,
                    detalle: `${impresion?.motivo || 'Impresora no disponible'}. Reimprímalo desde Vehículos.`
                  })
                }
                refrescar()
              }}
              onError={(texto) => setAviso({ tipo: 'error', texto })}
            />
          )}

          {vista === 'salida' && (
            <Salida
              placaInicial={placaEnFoco}
              ahora={ahora}
              onAviso={setAviso}
              onLiquidado={({ vehicle, transaccion }) => {
                setAviso({
                  tipo: 'ok',
                  texto: `${vehicle.placa} salió · ${
                    transaccion ? cop(transaccion.monto) : 'mensualidad'
                  }`
                })
                refrescar()
              }}
            />
          )}

          {vista === 'lavadero' && (
            <Lavadero placaInicial={placaEnFoco} ahora={ahora} onIr={ir} onAviso={setAviso} />
          )}

          {vista === 'vehiculos' && (
            <Vehiculos
              ahora={ahora}
              placaInicial={placaEnFoco}
              onSalida={abrirSalida}
              onAviso={setAviso}
            />
          )}

          {/* Una sola vista con dos puertas: el rail entra por las métricas y
              el engranaje por los precios. */}
          {(vista === 'metricas' || vista === 'ajustes') && (
            <Configuracion
              settings={ajustes}
              seccionInicial={vista === 'metricas' ? 'ventas' : seccionAjustes}
              onGuardado={(nuevo) => {
                setAjustes(nuevo)
                refrescar()
              }}
              onAviso={setAviso}
            />
          )}
        </main>
      </div>

      <Toast aviso={aviso} onCerrar={cerrarAviso} />
    </div>
  )
}
