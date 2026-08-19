/*
 * Set de iconos propio. Todos comparten rejilla de 24, trazo de 1.5, remates
 * redondos y ningún relleno: así ninguno pesa visualmente más que otro.
 * Se dibujan aquí en vez de traer una librería porque la app va empaquetada
 * y offline, y porque el trazo consistente es parte del diseño.
 */

const TRAZOS = {
  panel: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  entrada: (
    <>
      <path d="M12 3v11" />
      <path d="m8 10.5 4 4 4-4" />
      <path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />
    </>
  ),
  salida: (
    <>
      <path d="M12 21V10" />
      <path d="m8 13.5 4-4 4 4" />
      <path d="M4 7V4.5A1.5 1.5 0 0 1 5.5 3h13A1.5 1.5 0 0 1 20 4.5V7" />
    </>
  ),
  vehiculos: (
    <>
      <path d="M3 6h11M3 12h6M3 18h5" />
      <circle cx="16.5" cy="15.5" r="4" />
      <path d="m19.5 18.5 2 2" />
    </>
  ),
  lavadero: (
    <path d="M12 3.5c3.5 4 6 6.9 6 9.8a6 6 0 0 1-12 0c0-2.9 2.5-5.8 6-9.8Z" />
  ),
  ajustes: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  mas: <path d="M12 5v14M5 12h14" />,
  buscar: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m16.2 16.2 4 4" />
    </>
  ),
  impresora: (
    <>
      <path d="M7 9V4h10v5" />
      <path d="M7 18H5.5A1.5 1.5 0 0 1 4 16.5v-5A1.5 1.5 0 0 1 5.5 10h13a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H17" />
      <rect x="7" y="15" width="10" height="6" rx="1" />
    </>
  ),
  escaner: (
    <>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M8 9v6M11 9v6M14 9v6M17 9v6" />
    </>
  ),
  visto: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  cerrar: <path d="M6 6l12 12M18 6 6 18" />,
  moto: (
    <>
      <circle cx="5.5" cy="16.5" r="3.5" />
      <circle cx="18.5" cy="16.5" r="3.5" />
      <path d="M5.5 16.5h5l4-7h-3" />
      <path d="M14 6h3l1.5 10.5" />
    </>
  ),
  casco: (
    <>
      <path d="M3.5 15a8.5 8.5 0 0 1 17 0v1.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z" />
      <path d="M9.5 18v-3.5h11" />
    </>
  ),
  reloj: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.2l3.2 2" />
    </>
  ),
  alerta: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5M12 16h.01" />
    </>
  ),
  calendario: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </>
  ),
  derecha: <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  izquierda: <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />,
  refrescar: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4.5h-4.5" />
    </>
  ),
  moneda: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.5 9.2a3 3 0 1 0 0 5.6M12 6.5v11" />
    </>
  )
}

/**
 * @param {{nombre: keyof typeof TRAZOS, tam?: number, className?: string}} props
 */
export default function Icono({ nombre, tam = 18, className = '' }) {
  const trazo = TRAZOS[nombre]
  if (!trazo) return null

  return (
    <svg
      viewBox="0 0 24 24"
      width={tam}
      height={tam}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      {trazo}
    </svg>
  )
}
