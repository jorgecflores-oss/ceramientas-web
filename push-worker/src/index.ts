import type { DurableObjectNamespace } from '@cloudflare/workers-types'
import { MqttPushBridge, type Env as BridgeEnv } from './bridge'

interface Env extends BridgeEnv {
  BRIDGE: DurableObjectNamespace
}

export { MqttPushBridge }

// Fingerprint para key KV: últimos 32 chars del endpoint (suficientemente únicos)
function subKey(hornoId: string, endpoint: string): string {
  return `sub:${hornoId}:${endpoint.slice(-32)}`
}

// CORS para que la webapp pueda hacer fetch desde GitHub Pages
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function cors(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json', ...CORS } })
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)

    // Preflight CORS
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

    // GET /vapid-public-key — la webapp lo usa para suscribirse
    if (url.pathname === '/vapid-public-key' && req.method === 'GET') {
      return cors(JSON.stringify({ key: env.VAPID_PUBLIC_KEY }))
    }

    // POST /subscribe — registra suscripción push para un hornoId
    if (url.pathname === '/subscribe' && req.method === 'POST') {
      const { hornoId, subscription } = await req.json<{
        hornoId: string
        subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
      }>()
      if (!hornoId || !subscription?.endpoint) return cors('"bad request"', 400)

      // Guardar suscripción en KV
      await env.SUBS.put(subKey(hornoId, subscription.endpoint), JSON.stringify(subscription), {
        expirationTtl: 60 * 60 * 24 * 90, // 90 días, se renueva al re-abrir la app
      })

      // Avisar al Durable Object que escuche este hornoId
      const id = env.BRIDGE.idFromName('singleton')
      const stub = env.BRIDGE.get(id)
      await stub.fetch(new Request('http://do/watch', {
        method: 'POST',
        body: JSON.stringify({ hornoId }),
        headers: { 'Content-Type': 'application/json' },
      }))

      return cors('"ok"')
    }

    // DELETE /subscribe — desuscribe (usuario cierra sesión o desactiva notifs)
    if (url.pathname === '/subscribe' && req.method === 'DELETE') {
      const { hornoId, endpoint } = await req.json<{ hornoId: string; endpoint: string }>()
      if (!hornoId || !endpoint) return cors('"bad request"', 400)

      await env.SUBS.delete(subKey(hornoId, endpoint))
      return cors('"ok"')
    }

    return cors('"not found"', 404)
  },
}
