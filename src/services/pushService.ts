import { VAPID_PUBLIC_KEY, PUSH_WORKER_URL } from '../utils/constants'

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padded = base64String.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (base64String.length % 4)) % 4)
  const chars = atob(padded)
  const buf = new ArrayBuffer(chars.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < chars.length; i++) view[i] = chars.charCodeAt(i)
  return view
}

export async function requestPushPermission(): Promise<boolean> {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false
  }
  const permission = await Notification.requestPermission()
  return permission === 'granted'
}

export async function suscribirPush(hornoId: string): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })

    await fetch(`${PUSH_WORKER_URL}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hornoId, subscription: sub.toJSON() }),
    })

    return true
  } catch (e) {
    console.error('[push] suscripción fallida', e)
    return false
  }
}

export async function desuscribirPush(hornoId: string): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return

    await fetch(`${PUSH_WORKER_URL}/subscribe`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hornoId, endpoint: sub.endpoint }),
    })

    await sub.unsubscribe()
  } catch (e) {
    console.error('[push] desuscripción fallida', e)
  }
}

export async function pushSuscripto(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  return sub !== null
}

// Re-registra la suscripción existente en el servidor (por si el servidor se reinició)
export async function refreshPushSubscription(hornoId: string): Promise<void> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    await fetch(`${PUSH_WORKER_URL}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hornoId, subscription: sub.toJSON() }),
    })
  } catch {
    // silencioso — no es crítico
  }
}
