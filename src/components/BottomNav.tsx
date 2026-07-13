import type { Page } from '../types/horno'
import { feedbackBoton } from '../utils/feedback'

interface Props {
  active: Page
  onChange: (p: Page) => void
}

const tabs: { id: Page; icon: string; label: string }[] = [
  { id: 'horno', icon: '🔥', label: 'Horno' },
  { id: 'programas', icon: '📋', label: 'Programas' },
  { id: 'historial', icon: '📊', label: 'Historial' },
  { id: 'config', icon: '⚙️', label: 'Ajustes' },
]

export function BottomNav({ active, onChange }: Props) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-neutral-950 border-t border-neutral-800 z-50">
      <div className="max-w-md mx-auto flex justify-around">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => { feedbackBoton(); onChange(tab.id) }}
            className={`flex flex-col items-center gap-1 py-3 flex-1 transition active:scale-95 duration-75 ${
              active === tab.id ? 'text-orange-500' : 'text-neutral-500'
            }`}
          >
            <span className="text-2xl">{tab.icon}</span>
            <span className="text-xs">{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
