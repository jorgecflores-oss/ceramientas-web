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

Fase 1: paridad mínima ✅ COMPLETA
- [x] Login IP + password
- [x] HornoPage con temperatura real time
- [x] Botón PARAR
- [x] Cache IP localStorage
- [x] Curva SVG (Recharts) — real + teórica superpuesta
- [x] Lista programas + ejecutar
- [x] Historial últimos 30 + borrar individual/todo
- [x] Config básica (potencia, factura, consumo, nombre)

Fase 2: interacción completa (en curso)
- [x] OTA desde webapp (ConfigPage — polling real /ota/status)
- [x] Configurar WiFi (abre PAGINA_SETUP firmware en nueva pestaña)
- [x] Editar tempFinal de programas (inline, todos los slots)
- [x] Editar pasos de programas custom (idx ≥ 4, modal)
- [x] Borrar programas custom (idx ≥ 4, con confirmación)
- [x] Crear programas nuevos (modal nombre + pasos, slot libre idx 4-23)
- [x] Recuperación corte luz (UI) — banner + modal continuar/detener, cooldown 30s
- [x] Multi-horno — SelectorHorno + store completo; login page acepta onVolver; ConfigPage con botón "Agregar horno"

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
- Feat: ProgramasPage, HistorialPage, ConfigPage, BottomNav, CurvaGrafico
- Feat: curva teórica superpuesta, SelectorHorno, multi-horno store
- Feat: PWA installable con Service Worker (vite-plugin-pwa)
- Feat: iconos PWA
- Feat: LED tercer estado Local + descubrimiento MQTT + guard payload vacío
- Feat (2026-07-09): OTA desde webapp — postOTA, getOTAStatus, modal polling real
- Feat (2026-07-09): Configurar WiFi — detecta AP, abre PAGINA_SETUP en nueva pestaña
- Feat (2026-07-09): Editar tempFinal inline + editar pasos (modal) + borrar programas custom
- Feat (2026-07-09): Multi-horno — LoginPage acepta onVolver, ConfigPage con "Agregar horno", Page type incluye 'login'
- Fix (2026-07-09): CurvaGrafico — muestra curva teórica desde el arranque aunque historialTemp esté vacío

## Notas arquitectura relevantes

### OTA (ConfigPage)
- `postOTA()` en hornoService.ts: HTTP-only (no MQTT fallback), con retry 401.
- `getOTAStatus()`: usa `resolverCachedIP()` (sin probe AP) para no agregar 500ms por poll.
- Polling cada 2s. Si 4 polls sin `enProgreso=true` → no hay update. Si deja de responder tras `enProgreso=true` → reiniciando → done.

### Configurar WiFi (ConfigPage)
- SSID AP firmware: `CERAMIENTAS_` + últimos 4 chars de `hornoId`. Password: `ceramientas`.
- La PAGINA_SETUP está en `GET /` del firmware (no en `/wifi`).
- `GET /wifi` retorna JSON con estado de conexión.
- Flujo: probe AP 800ms → si responde abre `http://192.168.4.1/` → sino LAN IP cacheada → sino instrucciones manuales.

### Edición programas (ProgramasPage)
- Predefinidos (idx 0-3): solo editar tempFinal → POST /programas/{idx} con `{ tempFinal }`.
- Custom (idx 4-23): editar tempFinal + editar pasos + borrar → DELETE /programas/{idx}.
- Velocidad almacenada en firmware como °C/min × 10. UI muestra y edita en °C/min (float), convierte con `× 10` al guardar.
- Tras guardar: actualiza Zustand store + localStorage (PROGRAMAS_CACHE) sin refetch.

### CurvaGrafico (CurvaGrafico.tsx)
- Guard cambiado a `puntosEf.length === 0 && !hayTeoricoEf`: si hay curva teórica calculada pero aún no llegó ningún dato real (programa recién arrancado o app abierta mid-process), muestra el gráfico con solo la curva teórica en lugar de "Sin datos aún".
- `maxTempReal` protegido con `puntosEf.length > 0 ? ... : 0` para evitar `Math.max()` vacío.
- `CartelFijo` (tooltip) no se muestra cuando `puntosEf.length === 0` (evita "Real: 0°C").

### Notificaciones MQTT tipadas (HornoPage)
- `suscribirNotif` conectado al topic `ceramientas/{id}/notif`.
- `corte_luz` → modal continuar/detener con cooldown 30s.
- `rampa_rapida` → modal alerta con comando `cancelar_alarma`, cooldown Infinity.
- `etapa`, `meseta`, `fin`, `alarma_critica`, `alarma_exceso`, `rampa_lenta` → toasts tipados (5s).
- Corte de luz también se detecta por campo `cl` del estado MQTT (sin necesidad de notif).

## Pendientes

### Funcionalidad

- **Web Push VAPID** (Fase 3) — notificaciones push reales al cerrar la app.
- **Cloudflare Worker** (Fase 3) — intermediario para push.

### Técnico

- **Bundle size** — Recharts + MQTT.js son las causas principales. Solución: dynamic import de Recharts (`React.lazy`) para code-split. No es bloqueante pero afecta TTI en conexiones lentas.
- **Deploy** — actualmente manual (`git push` → GitHub Actions). El workflow ya está en `.github/workflows/deploy.yml`. URL: `https://jorgecflores-oss.github.io/ceramientas-web/`.

## Repo

`jorgecflores-oss/ceramientas-web` (main branch).
