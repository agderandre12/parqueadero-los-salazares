import { useEffect } from 'react'
import Icono from './Icono.jsx'

/**
 * Confirmación flotante. Se cierra sola; el operario nunca tiene que
 * despacharla para seguir trabajando.
 */
export default function Toast({ aviso, onCerrar, duracion = 4000 }) {
  useEffect(() => {
    if (!aviso) return
    const id = setTimeout(() => onCerrar?.(), duracion)
    return () => clearTimeout(id)
  }, [aviso, onCerrar, duracion])

  if (!aviso) return null

  const esError = aviso.tipo === 'error'

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={onCerrar}
      className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-50 cursor-pointer
        flex items-center gap-2.5 rounded-campo border px-4 py-3 text-base font-medium
        shadow-lg max-w-xl
        ${esError ? 'bg-alerta-50 border-alerta/40 text-alerta' : 'bg-tinta border-tinta text-blanco'}`}
    >
      <Icono nombre={esError ? 'alerta' : 'visto'} tam={17} />
      <span>{aviso.texto}</span>
      {aviso.detalle && (
        <span className={esError ? 'text-alerta/75' : 'text-humo'}>{aviso.detalle}</span>
      )}
    </div>
  )
}
