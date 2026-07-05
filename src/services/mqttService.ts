import mqtt, { type MqttClient } from 'mqtt'
import { MQTT_BROKER, MQTT_USER, MQTT_PASS, STORAGE_KEYS } from '../utils/constants'
import type { EstadoMQTT } from '../types/horno'

type Pendiente = {
  resolve: (v: { status: number; data: unknown }) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const pendientes = new Map<string, Pendiente>()

let client: MqttClient | null = null
let conectado = false
const subs = new Map<string, (data: EstadoMQTT) => void>()

export function iniciarMQTT() {
  if (client) return
  client = mqtt.connect(MQTT_BROKER, {
    username: MQTT_USER,
    password: MQTT_PASS,
    keepalive: 30,
    reconnectPeriod: 2000,
    connectTimeout: 10000,
    clean: true,
  })

  client.on('connect', () => {
    conectado = true
    console.log('[MQTT] conectado')
    subs.forEach((_, topic) => client?.subscribe(topic))
    client?.subscribe('ceramientas/+/res', { qos: 1 })
  })

  client.on('close', () => {
    conectado = false
    console.log('[MQTT] cerrado')
  })

  client.on('error', (err) => {
    console.error('[MQTT] error', err)
  })

  client.on('message', (topic, payload) => {
    if (topic.endsWith('/res')) {
      try {
        const msg = JSON.parse(payload.toString())
        const pend = pendientes.get(msg.reqId)
        if (!pend) return
        clearTimeout(pend.timer)
        pendientes.delete(msg.reqId)
        pend.resolve({ status: msg.status, data: msg.data })
      } catch (e) {
        console.error('[MQTT] parse res error', e)
      }
      return
    }
    const cb = subs.get(topic)
    if (!cb) return
    try {
      const data = JSON.parse(payload.toString())
      cb(mapearEstado(data))
    } catch (e) {
      console.error('[MQTT] parse error', e)
    }
  })
}

export function suscribirEstado(hornoId: string, cb: (data: EstadoMQTT) => void) {
  const topic = `ceramientas/${hornoId}/estado`
  subs.set(topic, cb)
  if (client && conectado) client.subscribe(topic)
  return () => {
    subs.delete(topic)
    client?.unsubscribe(topic)
  }
}

export function publicarComando(hornoId: string, comando: string) {
  if (!client || !conectado) return false
  const topic = `ceramientas/${hornoId}/comando`
  client.publish(topic, comando)
  return true
}

export function estaConectado() {
  return conectado && client?.connected === true
}

export function detenerMQTT() {
  client?.end()
  client = null
  conectado = false
}

export function mqttRequest(
  hornoId: string,
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: string,
  timeoutMs: number = 10000
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    if (!estaConectado()) {
      reject(new Error('MQTT no conectado'))
      return
    }
    const auth = localStorage.getItem(STORAGE_KEYS.PASS(hornoId))
    if (!auth) {
      reject(new Error('Sin password guardada'))
      return
    }
    const reqId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const req: Record<string, string> = { reqId, auth, method, path }
    if (body) req.body = body
    const timer = setTimeout(() => {
      pendientes.delete(reqId)
      reject(new Error('Timeout MQTT request'))
    }, timeoutMs)
    pendientes.set(reqId, { resolve, reject, timer })
    const topic = `ceramientas/${hornoId}/req`
    client!.publish(topic, JSON.stringify(req), { qos: 1 })
  })
}

if (typeof window !== 'undefined') {
  (window as unknown as { mqttRequest: typeof mqttRequest }).mqttRequest = mqttRequest
}

function mapearEstado(d: any): EstadoMQTT {
  return {
    temperatura: d.t ?? d.temperatura ?? 0,
    tempObj: d.to ?? d.tempObj ?? 0,
    etapa: d.ea ?? d.etapa ?? 1,
    etapaTotal: d.et ?? d.etapaTotal ?? 1,
    horas: d.h ?? d.horas ?? 0,
    minutos: d.m ?? d.minutos ?? 0,
    rele: d.r ?? d.rele ?? false,
    rampaLenta: d.rl ?? d.rampaLenta ?? false,
    rampaRapida: d.rr ?? d.rampaRapida ?? false,
    corteLuz: d.cl ?? d.corteLuz ?? false,
    estado: d.e ?? d.estado ?? 'idle',
  }
}
