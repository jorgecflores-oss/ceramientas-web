import { useState } from 'react'
import { useHornoStore } from '../store/hornoStore'

export function SelectorHorno() {
  const hornos = useHornoStore(s => s.hornos)
  const hornoActivo = useHornoStore(s => s.hornoActivo)
  const setHornoActivo = useHornoStore(s => s.setHornoActivo)
  const [abierto, setAbierto] = useState(false)

  if (!hornoActivo) return null

  if (hornos.length <= 1) {
    return null
  }

  return (
    <div className="relative mb-4">
      <button
        onClick={() => setAbierto(!abierto)}
        className="w-full flex justify-between items-center px-4 py-2 bg-neutral-900 border border-neutral-800 rounded-lg"
      >
        <span className="text-sm text-neutral-400">Horno activo:</span>
        <span className="text-sm text-white font-semibold flex items-center gap-2">
          {hornoActivo.nombre}
          <span className="text-neutral-500">▾</span>
        </span>
      </button>
      {abierto && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden z-40">
          {hornos.map(h => (
            <button
              key={h.hornoId}
              onClick={() => {
                setHornoActivo(h.hornoId)
                setAbierto(false)
              }}
              className={`w-full text-left px-4 py-3 hover:bg-neutral-800 transition ${
                h.hornoId === hornoActivo.hornoId ? 'bg-neutral-800' : ''
              }`}
            >
              <p className="text-white text-sm">{h.nombre}</p>
              <p className="text-xs text-neutral-500">{h.hornoId.slice(-6)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
