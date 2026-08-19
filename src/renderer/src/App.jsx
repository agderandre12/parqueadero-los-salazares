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
import Configuracion from './views/Configuracion.jsx'
import { celda as fmtCelda, cop, normalizarPlaca } from './lib/format.js'

const TITULOS = {
  panel: 'Panel',
  entrada: 'Nueva entrada',
  salida: 'Registrar salida',
  vehiculos: 'Vehículos',
  ajustes: 'Configuración'
}

export default function App() {
  const { stats, celdas, sinCelda, ultimos, settings, error, refrescar } = useDashboard(5000)
  const { impresora } = useImpresora(30000)
  const ahora = useReloj()

  const [vista, setVista] = useState('panel')
  const [placaEnFoco, setPlacaEnFoco] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [ajustes, setAjustes] = useState(null)

  const cerrarAviso = useCallback(() => setAviso(null), [])

  useEffect(() => {
    if (settings) setAjustes(settings)
  }, [settings])

  /** Navega a una vista; `placa` la precarga cuando la vista la acepta. */
  const ir = useCallback((destino, placa = null) => {
    setPlacaEnFoco(placa)
    setVista(destino)
  }, [])

  const abrirSalida = useCallback((placa) => ir('salida', placa), [ir])

  /*
   * Lectura del escáner. Decide a dónde llevar al operario:
   * si la moto está adentro, a cobrarle; si no, a su ficha.
   */
  const alEscanear = useCallback(
    async (codigo) => {
      const placa = normalizarPlaca(codigo)
      if (placa.length < 3) return

      const res = await window.api.vehiculos.buscar(placa)
      const adentro = res.ok && res.data.some((v) => v.placa === placa)

      if (adentro) ir('salida', placa)
      else {
        ir('vehiculos', placa)
        setAviso({ tipo: 'ok', texto: `${placa} no está adentro`, detalle: 'Se abrió su ficha' })
      }
    },
    [ir]
  )

  const { leyendo } = useEscaner({ activo: true, onLectura: alEscanear })

  // Atajos de teclado: F1-F4 navegan, F8 configuración.
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
              onRegistrado={({ vehicle, impresion }) => {
                setAviso({
                  tipo: 'ok',
                  texto: `${vehicle.placa} entró${vehicle.celda ? ` a la celda ${fmtCelda(vehicle.celda)}` : ''}`,
                  detalle: impresion?.ok ? 'Tiquete impreso' : null
                })
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
              onLiquidado={({ vehicle, cobro }) => {
                setAviso({
                  tipo: 'ok',
                  texto: `${vehicle.placa} salió · ${cop(cobro.total)}`
                })
                refrescar()
              }}
            />
          )}

          {vista === 'vehiculos' && (
            <Vehiculos
              ahora={ahora}
              placaInicial={placaEnFoco}
              onSalida={abrirSalida}
              onAviso={setAviso}
            />
          )}

          {vista === 'ajustes' && (
            <Configuracion
              settings={ajustes}
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
