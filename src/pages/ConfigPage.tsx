import { SelectorHorno } from '../components/SelectorHorno'

export function ConfigPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white p-6 pb-24">
      <div className="max-w-md mx-auto">
        <header className="mb-6">
          <p className="text-xs text-neutral-400 tracking-widest uppercase">ceramientas</p>
          <h1 className="text-2xl font-bold tracking-widest mt-1">AJUSTES</h1>
        </header>
        <SelectorHorno />
        <div className="text-center text-neutral-500 mt-12">
          Próximamente
        </div>
      </div>
    </div>
  )
}
