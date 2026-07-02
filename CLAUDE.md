# CLAUDE.md — PWA ceramientas-web

Ruta: `C:\\Users\\Jorge\\ceramientas-web\\`

## Contexto

PWA control remoto hornos cerámica Ceramientas. Reemplaza gradualmente app Android.

Conecta ESP32 firmware v3.4.0+ vía MQTT WSS + HTTP LAN/AP.

## Stack

- Vite 8 + React 19 + TypeScript
- Tailwind CSS v4 (@tailwindcss/vite)
- Zustand (estado global)
- MQTT.js (WSS 8884 HiveMQ)
- Recharts (curva temperatura)
- Oxlint

## Reglas absolutas

- Clauco solo edita. Jorge corre dev/build.
- NUNCA commit sin autorización.
- Español rioplatense código comentarios.
- Prompts Clauco terminan `NO COMPILAR NO EJECUTAR`.
- TypeScript estricto. Sin `any` salvo mapeo MQTT.
- Tailwind utility-first. No CSS files nuevos.
- Componentes funcionales + hooks. Sin clases.

## Estructura
src/
  services/
    mqttService.ts    ← singleton MQTT, mapeo estado
    hornoService.ts   ← HTTP endpoints firmware
  store/
    hornoStore.ts     ← Zustand: horno activo, estado, historial
  pages/
    LoginPage.tsx     ← IP + password
    HornoPage.tsx     ← temperatura, control, PARAR
  types/
    horno.ts          ← EstadoMQTT, Programa, InfoHorno
  utils/
    constants.ts      ← broker MQTT, storage keys
  App.tsx             ← router login/horno
  main.tsx
  index.css           ← @import "tailwindcss"

## Firmware endpoints v3.4.0

Ver documentación en workspace principal.
Base: público `/info`, `/wifi/scan`, `/estado` (GET sin auth), `/wifi` (GET/POST).
Con auth `X-Auth`: `/comando`, `/historial`, `/curva`, `/programas`, `/programas/{idx}`, `/config`, `/ota`, `/ota/status`.
Password = últimos 6 hex MAC.

## MQTT

- Broker: `wss://e4aa6c1aae5f48b0a09026ebdcde979c.s1.eu.hivemq.cloud:8884/mqtt`
- User: `ceramientas`
- Topics:
  - `ceramientas/{hornoId}/estado` (sub) — payload corto `t,to,e,ea,et,h,m,r,rl,rr,cl`
  - `ceramientas/{hornoId}/comando` (pub) — string comando
  - `ceramientas/{hornoId}/notif` (sub) — notificaciones tipadas

## Estado v3.4.0 firmware ejemplo

```json
{"t":16,"to":0,"e":"idle","ea":1,"et":1,"h":0,"m":16,"r":false,"rl":false,"rr":false,"cl":false}
```

## Fases desarrollo

Fase 1 (actual): paridad mínima
- [x] Login IP + password
- [x] HornoPage con temperatura real time
- [x] Botón PARAR
- [x] Cache IP localStorage
- [ ] Curva SVG (Recharts)
- [ ] Lista programas
- [ ] Historial últimos 30
- [ ] Config básica

Fase 2: interacción completa
- [ ] Editar programas
- [ ] Recuperación corte luz
- [ ] Multi-horno

Fase 3: push
- [ ] Web Push VAPID
- [ ] Cloudflare Worker intermediario

## Comandos dev

```powershell
npm run dev        # localhost:5173
npm run build      # dist/
npm run preview
```

Deploy futuro: GitHub Pages via gh-pages.

## Modos conexión

PWA debe funcionar 3 escenarios:
1. AP ESP32 hotspot (192.168.4.1) — solo HTTP
2. Misma LAN (IP DHCP) — HTTP + MQTT
3. Internet remoto — solo MQTT

`probeAP()` detecta escenario 1 timeout 800ms.
`cacheIP()` persiste última IP LAN conocida.

## Historial commits

- Init: Vite + React + TS + Tailwind + MQTT + Zustand + Recharts
- Feat: LoginPage + HornoPage + servicios + store

## Repo

`jorgecflores-oss/ceramientas-web` (main branch).
