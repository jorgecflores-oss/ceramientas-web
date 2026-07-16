/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & typeof globalThis & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('push', (event: PushEvent) => {
  const data = event.data?.json() as {
    title?: string; body?: string; data?: Record<string, unknown>
  } | undefined

  const title = data?.title ?? 'Ceramientas'
  const hornoId = String((data?.data as { hornoId?: string } | undefined)?.hornoId ?? 'ceramientas')
  const options: NotificationOptions = {
    body: data?.body ?? '',
    icon: '/ceramientas-web/pwa-192.png',
    badge: '/ceramientas-web/pwa-192.png',
    data: data?.data,
    tag: hornoId,
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find((c: WindowClient) => c.url.includes('/ceramientas-web/'))
      if (existing) return existing.focus()
      return self.clients.openWindow('/ceramientas-web/')
    })
  )
})
