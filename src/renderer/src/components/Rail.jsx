import Icono from './Icono.jsx'
import logo from '../assets/logo.jpeg'

/*
 * Rail de navegación. Es la única superficie oscura permanente de la aplicación:
 * separa "dónde estoy" del contenido sin necesitar una línea divisoria fuerte,
 * y recoge el navy del emblema.
 */

export const VISTAS = [
  { id: 'panel', etiqueta: 'Panel', icono: 'panel', tecla: 'F1' },
  { id: 'entrada', etiqueta: 'Nueva entrada', icono: 'entrada', tecla: 'F2' },
  { id: 'salida', etiqueta: 'Registrar salida', icono: 'salida', tecla: 'F3' },
  { id: 'vehiculos', etiqueta: 'Vehículos', icono: 'vehiculos', tecla: 'F4' },
  { id: 'metricas', etiqueta: 'Métricas y caja', icono: 'grafica', tecla: 'F5' }
]

function Boton({ vista, activa, onIr }) {
  return (
    <button
      type="button"
      onClick={() => onIr(vista.id)}
      aria-current={activa ? 'page' : undefined}
      title={`${vista.etiqueta} · ${vista.tecla}`}
      className={`group relative w-11 h-11 rounded-campo flex items-center justify-center
        transition-colors duration-rapido ease-salida
        ${activa ? 'bg-tinta-800 text-blanco' : 'text-humo hover:text-blanco hover:bg-tinta-800/70'}`}
    >
      {activa && (
        <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r bg-azul" />
      )}
      <Icono nombre={vista.icono} tam={20} />

      {/* Etiqueta emergente: el rail es angosto y los iconos solos se olvidan. */}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-md
                   bg-tinta px-2 py-1 text-mini font-medium text-blanco opacity-0
                   shadow-lg transition-opacity duration-rapido group-hover:opacity-100 z-50"
      >
        {vista.etiqueta}
        <span className="ml-1.5 text-humo">{vista.tecla}</span>
      </span>
    </button>
  )
}

export default function Rail({ vista, onIr, escaneando, impresora }) {
  return (
    <nav
      aria-label="Navegación principal"
      className="oscuro w-16 shrink-0 bg-tinta flex flex-col items-center py-3 gap-1"
    >
      <img
        src={logo}
        alt="Parqueadero y Lavadero los salazares"
        className="w-10 h-10 rounded-full object-cover ring-1 ring-tinta-700 mb-3"
      />

      {VISTAS.map((v) => (
        <Boton key={v.id} vista={v} activa={vista === v.id} onIr={onIr} />
      ))}

      {/* Lavadero: la navegación ya le guarda el puesto. */}
      <span
        title="Lavadero — próximamente"
        className="w-11 h-11 rounded-campo flex items-center justify-center text-humo/45"
      >
        <Icono nombre="lavadero" tam={20} />
      </span>

      <div className="flex-1" />

      {/* Estado del hardware, siempre a la vista y siempre en el mismo sitio. */}
      <div className="flex flex-col items-center gap-2 mb-2">
        <span
          title={escaneando ? 'Escáner leyendo…' : 'Escáner activo, esperando código'}
          className={`w-9 h-9 rounded-campo flex items-center justify-center transition-colors duration-rapido
            ${escaneando ? 'bg-azul text-blanco' : 'text-humo'}`}
        >
          <Icono nombre="escaner" tam={18} />
        </span>
        <span
          title={
            impresora?.conectada
              ? 'Impresora conectada'
              : `Impresora: ${impresora?.motivo || 'sin conexión'}`
          }
          className={`w-9 h-9 rounded-campo flex items-center justify-center
            ${impresora?.conectada ? 'text-blanco' : 'text-humo/45'}`}
        >
          <Icono nombre="impresora" tam={18} />
        </span>
      </div>

      <button
        type="button"
        onClick={() => onIr('ajustes')}
        title="Configuración · F8"
        aria-current={vista === 'ajustes' ? 'page' : undefined}
        className={`relative w-11 h-11 rounded-campo flex items-center justify-center
          transition-colors duration-rapido ease-salida
          ${vista === 'ajustes' ? 'bg-tinta-800 text-blanco' : 'text-humo hover:text-blanco hover:bg-tinta-800/70'}`}
      >
        {vista === 'ajustes' && (
          <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r bg-azul" />
        )}
        <Icono nombre="ajustes" tam={20} />
      </button>
    </nav>
  )
}
