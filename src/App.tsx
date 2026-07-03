import { useEffect, useState } from 'react'
import { useHornoStore } from './store/hornoStore'
import { iniciarMQTT, estaConectado } from './services/mqttService'
import { LoginPage } from './pages/LoginPage'
import { HornoPage } from './pages/HornoPage'
import { ProgramasPage } from './pages/ProgramasPage'
import { HistorialPage } from './pages/HistorialPage'
import { ConfigPage } from './pages/ConfigPage'
import { BottomNav } from './components/BottomNav'
import type { Page } from './types/horno'

function App() {
  const horno = useHornoStore(s => s.hornoActivo)
  const loadFromStorage = useHornoStore(s => s.loadFromStorage)
  const setMqttConectado = useHornoStore(s => s.setMqttConectado)
  const [page, setPage] = useState<Page>('horno')

  useEffect(() => {
    loadFromStorage()
    iniciarMQTT()
    const interval = setInterval(() => {
      setMqttConectado(estaConectado())
    }, 2000)
    return () => clearInterval(interval)
  }, [loadFromStorage, setMqttConectado])

  if (!horno) return <LoginPage />

  return (
    <>
      {page === 'horno' && <HornoPage />}
      {page === 'programas' && <ProgramasPage />}
      {page === 'historial' && <HistorialPage />}
      {page === 'config' && <ConfigPage />}
      <BottomNav active={page} onChange={setPage} />
    </>
  )
}

export default App