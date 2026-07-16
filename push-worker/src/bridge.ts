import type { DurableObjectState, KVNamespace } from '@cloudflare/workers-types'
import { sendPush, type WebPushSub, type PushPayload } from './push'

export interface Env {
  SUBS: KVNamespace
  VAPID_PRIVATE_KEY: string
  VAPID_PUBLIC_KEY: string
  VAPID_SUBJECT: string
  MQTT_USER: string
  MQTT_PASS: string
}

interface FirmwareNotif {
  tipo: string
  [key: string]: unknown
}

const BROKER = 'wss://e4aa6c1aae5f48b0a09026ebdcde979c.s1.eu.hivemq.cloud:8884/mqtt'
const KEEPALIVE_S = 60
const RECONNECT_DELAY_MS = 10_000

// --- Framing MQTT 3.1.1 binario ---

function mqttStr(s: string, enc: TextEncoder): Uint8Array {
  const b = enc.encode(s)
  const out = new Uint8Array(2 + b.length)
  out[0] = b.length >> 8; out[1] = b.length & 0xff
  out.set(b, 2)
  return out
}

function mqttVarLen(n: number): Uint8Array {
  const bytes: number[] = []
  do {
    let b = n % 128; n = Math.floor(n / 128)
    if (n > 0) b |= 0x80
    bytes.push(b)
  } while (n > 0)
  return new Uint8Array(bytes)
}

function encodeConnect(clientId: string, user: string, pass: string): Uint8Array {
  const enc = new TextEncoder()
  const protocol = new Uint8Array([0, 4, 77, 81, 84, 84, 4, 0xC2, 0, KEEPALIVE_S])
  const id = mqttStr(clientId, enc)
  const u = mqttStr(user, enc)
  const p = mqttStr(pass, enc)
  const payload = new Uint8Array(protocol.length + id.length + u.length + p.length)
  let i = 0
  for (const chunk of [protocol, id, u, p]) { payload.set(chunk, i); i += chunk.length }
  const varLen = mqttVarLen(payload.length)
  const out = new Uint8Array(1 + varLen.length + payload.length)
  out[0] = 0x10; out.set(varLen, 1); out.set(payload, 1 + varLen.length)
  return out
}

function encodeSubscribe(packetId: number, topic: string): Uint8Array {
  const enc = new TextEncoder()
  const topicBytes = mqttStr(topic, enc)
  const payload = new Uint8Array(2 + topicBytes.length + 1)
  payload[0] = packetId >> 8; payload[1] = packetId & 0xff
  payload.set(topicBytes, 2); payload[2 + topicBytes.length] = 0x00
  const varLen = mqttVarLen(payload.length)
  const out = new Uint8Array(1 + varLen.length + payload.length)
  out[0] = 0x82; out.set(varLen, 1); out.set(payload, 1 + varLen.length)
  return out
}

function parsePublish(data: Uint8Array): { topic: string; payload: string } | null {
  if ((data[0] & 0xF0) !== 0x30) return null
  let i = 1; let remaining = 0; let mult = 1
  do { remaining += (data[i] & 127) * mult; mult *= 128 } while (data[i++] & 128)
  const topicLen = (data[i] << 8) | data[i + 1]; i += 2
  const topic = new TextDecoder().decode(data.slice(i, i + topicLen)); i += topicLen
  const payload = new TextDecoder().decode(data.slice(i, i + remaining - 2 - topicLen))
  return { topic, payload }
}

// --- Textos de notificación ---

function notifText(tipo: string, notif: FirmwareNotif, hornoNombre: string): PushPayload {
  const n = hornoNombre
  switch (tipo) {
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

// --- Durable Object ---

export class MqttPushBridge {
  private state: DurableObjectState
  private env: Env
  private ws: WebSocket | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private watchedHornos = new Set<string>()

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<string[]>('hornos')
      if (stored?.length) {
        for (const id of stored) this.watchedHornos.add(id)
        this.connect()
      }
    })
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)

    if (url.pathname === '/watch' && req.method === 'POST') {
      const { hornoId } = await req.json<{ hornoId: string }>()
      this.watchedHornos.add(hornoId)
      await this.state.storage.put('hornos', [...this.watchedHornos])
      if (!this.ws || this.ws.readyState !== 1 /* OPEN */) this.connect()
      else this.subscribe(hornoId)
      return new Response('ok')
    }

    if (url.pathname === '/unwatch' && req.method === 'POST') {
      const { hornoId } = await req.json<{ hornoId: string }>()
      this.watchedHornos.delete(hornoId)
      await this.state.storage.put('hornos', [...this.watchedHornos])
      return new Response('ok')
    }

    return new Response('not found', { status: 404 })
  }

  private connect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    try {
      this.ws = new WebSocket(BROKER, ['mqtt'])
    } catch {
      this.scheduleReconnect(); return
    }

    this.ws.addEventListener('open', () => {
      const clientId = `cf-bridge-${Math.random().toString(36).slice(2)}`
      this.ws!.send(encodeConnect(clientId, this.env.MQTT_USER, this.env.MQTT_PASS))
    })

    this.ws.addEventListener('message', async (ev: MessageEvent) => {
      let data: Uint8Array
      if (ev.data instanceof ArrayBuffer) {
        data = new Uint8Array(ev.data)
      } else if (ev.data instanceof Blob) {
        data = new Uint8Array(await ev.data.arrayBuffer())
      } else {
        return
      }
      // CONNACK exitoso
      if (data[0] === 0x20 && data[3] === 0x00) {
        for (const id of this.watchedHornos) this.subscribe(id)
        this.pingTimer = setInterval(() => {
          if (this.ws?.readyState === 1) this.ws.send(new Uint8Array([0xC0, 0x00]))
        }, (KEEPALIVE_S / 2) * 1000)
        return
      }
      const pub = parsePublish(data)
      if (pub) this.handlePublish(pub.topic, pub.payload).catch(() => undefined)
    })

    this.ws.addEventListener('close', () => {
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null }
      this.scheduleReconnect()
    })

    this.ws.addEventListener('error', () => { this.ws?.close() })
  }

  private subscribe(hornoId: string) {
    if (this.ws?.readyState !== 1) return
    this.ws.send(encodeSubscribe(1, `ceramientas/${hornoId}/notif`))
  }

  private scheduleReconnect() {
    this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS)
  }

  private async handlePublish(topic: string, payloadStr: string) {
    const match = topic.match(/^ceramientas\/(.+)\/notif$/)
    if (!match) return
    const hornoId = match[1]

    let notif: FirmwareNotif
    try { notif = JSON.parse(payloadStr) as FirmwareNotif } catch { return }

    const pushPayload = notifText(notif.tipo ?? '', notif, String(notif.nombre ?? hornoId))

    const { keys } = await this.env.SUBS.list({ prefix: `sub:${hornoId}:` })
    await Promise.allSettled(
      keys.map(async ({ name }) => {
        const raw = await this.env.SUBS.get(name)
        if (!raw) return
        try {
          await sendPush(
            JSON.parse(raw) as WebPushSub,
            pushPayload,
            this.env.VAPID_PRIVATE_KEY,
            this.env.VAPID_PUBLIC_KEY,
            this.env.VAPID_SUBJECT,
          )
        } catch (e) {
          if ((e as { status?: number }).status === 410) await this.env.SUBS.delete(name)
        }
      })
    )
  }
}
