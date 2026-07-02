import { useEffect } from 'react'
import { useHornoStore } from './store/hornoStore'
import { iniciarMQTT, estaConectado } from './services/mqttService'
import { LoginPage } from './pages/LoginPage'
import { HornoPage } from './pages/HornoPage'

function App() {
  const horno = useHornoStore((s) => s.hornoActivo)
  const loadFromStorage = useHornoStore((s) => s.loadFromStorage)
  const setMqttConectado = useHornoStore((s) => s.setMqttConectado)

  useEffect(() => {
    loadFromStorage()
    iniciarMQTT()
    const interval = setInterval(() => {
      setMqttConectado(estaConectado())
    }, 2000)
    return () => clearInterval(interval)
  }, [loadFromStorage, setMqttConectado])

  return horno ? <HornoPage /> : <LoginPage />
}

export default App