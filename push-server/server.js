import express from 'express'
import mqtt from 'mqtt'
import webpush from 'web-push'

const {
  VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
  MQTT_USER, MQTT_PASS, PORT = '8080',
} = process.env

if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !MQTT_USER || !MQTT_PASS) {
  console.error('Faltan variables de entorno. Revisá VAPID_* y MQTT_*')
  process.exit(1)
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

// Suscripciones en memoria: hornoId → Map<endpoint, subscription>
const subs = new Map()

// --- HTTP server ---

const app = express()
app.use(express.json())
app.use((_, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  next()
})
app.options('*', (_, res) => res.sendStatus(204))

app.get('/vapid-public-key', (_, res) => {
  res.json({ key: VAPID_PUBLIC_KEY })
})

app.post('/subscribe', (req, res) => {
  const { hornoId, subscription } = req.body
  if (!hornoId || !subscription?.endpoint) return res.status(400).json('bad request')
  if (!subs.has(hornoId)) subs.set(hornoId, new Map())
  subs.get(hornoId).set(subscription.endpoint, subscription)
  console.log(`[sub] ${hornoId} — ${subs.get(hornoId).size} suscriptores`)
  res.json('ok')
})

app.delete('/subscribe', (req, res) => {
  const { hornoId, endpoint } = req.body
  if (!hornoId || !endpoint) return res.status(400).json('bad request')
  subs.get(hornoId)?.delete(endpoint)
  res.json('ok')
})

app.listen(PORT, () => console.log(`push-server escuchando en :${PORT}`))

// --- MQTT client ---

const mqttClient = mqtt.connect(
  'mqtts://e4aa6c1aae5f48b0a09026ebdcde979c.s1.eu.hivemq.cloud:8883',
  { username: MQTT_USER, password: MQTT_PASS, reconnectPeriod: 5000 }
)

mqttClient.on('connect', () => {
  console.log('[mqtt] conectado')
  mqttClient.subscribe('ceramientas/+/notif', (err) => {
    if (err) console.error('[mqtt] error suscripción', err)
    else console.log('[mqtt] suscripto a ceramientas/+/notif')
  })
})

mqttClient.on('reconnect', () => console.log('[mqtt] reconectando...'))
mqttClient.on('error', (e) => console.error('[mqtt] error', e.message))

mqttClient.on('message', async (topic, payload) => {
  const match = topic.match(/^ceramientas\/(.+)\/notif$/)
  if (!match) return
  const hornoId = match[1]

  let notif
  try { notif = JSON.parse(payload.toString()) } catch { return }

  const pushPayload = notifText(notif, hornoId)
  const subscribers = subs.get(hornoId)
  if (!subscribers?.size) return

  console.log(`[push] enviando "${pushPayload.title}" a ${subscribers.size} suscriptores de ${hornoId}`)

  for (const [endpoint, sub] of subscribers) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(pushPayload))
    } catch (e) {
      if (e.statusCode === 410) {
        subscribers.delete(endpoint)
        console.log(`[push] suscripción expirada eliminada: ${endpoint.slice(-20)}`)
      } else {
        console.error(`[push] error enviando a ${endpoint.slice(-20)}:`, e.message)
      }
    }
  }
})

function notifText(notif, hornoId) {
  const n = notif.nombre ?? hornoId
  switch (notif.tipo) {
    case 'fin':            return { title: '✅ Cocción terminada', body: `${n} finalizó el programa.`, data: notif }
    case 'etapa':          return { title: '🔥 Nueva etapa', body: `${n}: etapa ${notif.etapa ?? ''} iniciada.`, data: notif }
    case 'meseta':         return { title: '🌡️ Meseta alcanzada', body: `${n} mantiene temperatura.`, data: notif }
    case 'corte_luz':      return { title: '⚡ Corte de luz', body: `${n} detectó un corte de luz.`, data: notif }
    case 'rampa_rapida':   return { title: '⚠️ Rampa rápida', body: `${n}: temperatura sube demasiado rápido.`, data: notif }
    case 'rampa_lenta':    return { title: '⚠️ Rampa lenta', body: `${n}: temperatura sube más lento de lo esperado.`, data: notif }
    case 'alarma_critica': return { title: '🚨 Alarma crítica', body: `${n}: alarma crítica de temperatura.`, data: notif }
    case 'alarma_exceso':  return { title: '🚨 Exceso de temperatura', body: `${n}: temperatura por encima del límite.`, data: notif }
    default:               return { title: `Ceramientas — ${n}`, body: 'Notificación del horno.', data: notif }
  }
}
