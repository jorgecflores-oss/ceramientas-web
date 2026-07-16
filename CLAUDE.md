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
- [x] Web Push VAPID — webapp + Service Worker
- [x] Cloudflare Worker intermediario — Durable Object MQTT→push
- [ ] Deploy Worker + completar PUSH_WORKER_URL en constants.ts

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
- Fix (2026-07-14): inputs vacios en modal edición (valor || '' con placeholder)
- Fix (2026-07-14): validación temp custom 30–1300°C en guardarPasos
- Fix (2026-07-14): re-POST pasos antes de ejecutar + STORAGE_KEYS.ULTIMO_PROG
- Fix (2026-07-14): MQTT silencioso — propagar errores firmware tras mqttRequest
- Fix (2026-07-14): curva programas custom — idx exacto sin mezclar predefinidos + refetch ProgramasPage
- Feat (2026-07-15): descubrimiento IP local — firmware publica IP en GET /info, webapp lo cachea al abrir HornoPage
- Fix (2026-07-15): negativo-cache del probe AP (elimina 500ms de overhead por request en LAN)
- Fix (2026-07-15): refreshIPCache() en HornoPage — cachea IP sin necesidad de re-vincular tras actualizar firmware
- Feat (2026-07-15): Web Push — push-worker/ (Cloudflare Worker + Durable Object MQTT→push), src/sw.ts, pushService.ts, botón campana HornoPage
- Feat (2026-07-15): Notificaciones ntfy.sh — firmware HTTP POST a ntfy.sh en paralelo a MQTT; botón campana abre ntfy.sh/ceramientas-{hornoId} para suscribirse sin servidor
- Fix (2026-07-15): UX notificaciones — elimina botón campana; modal ntfy se muestra automáticamente la primera vez por hornoId (flag localStorage); instrucciones paso a paso para descargar y configurar la app ntfy

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
- Tras guardar exitoso: actualiza Zustand store + localStorage (PROGRAMAS_CACHE) sin refetch.
- ProgramasPage refetchea siempre al montar (sin guard `programas.length > 0`) para evitar estado local obsoleto.
- Antes de ejecutar un custom (idx ≥ 4): re-POST los pasos vía `postPrograma` para garantizar que la EEPROM tiene los datos actuales. El error se traga si falla (se asume que el usuario ya guardó antes por HTTP).
- `STORAGE_KEYS.ULTIMO_PROG(hornoId)` guarda el idx del último programa ejecutado desde la webapp.

### Limitación conocida: edición custom por MQTT
**El firmware tiene un bug en `extractStr`** (parsea body MQTT hasta el primer `"` literal, y el body es JSON anidado con `\"` escapados → extrae basura → devuelve 400 "nombre requerido, max 19 chars").
- **Consecuencia**: POST /programas/{idx} con body `{ nombre, pasos }` SIEMPRE falla vía MQTT, sin importar el nombre real.
- **Fix webapp**: propagar ese error al usuario con mensaje claro ("necesitás estar conectado a la misma red Wi-Fi").
- **Fix firmware requerido**: cambiar `extractStr` para manejar secuencias `\"` o cambiar el formato del payload MQTT.
- **Workaround**: editar programas custom SOLO desde LAN o AP (conexión HTTP directa). Vía internet remoto (solo MQTT), la edición siempre fallará.

### Curva teórica — programas custom (HornoPage)
- `STORAGE_KEYS.ULTIMO_PROG` se usa en `calcularYGuardarCurva` para identificar si el programa activo es custom (idx ≥ 4).
- Si es custom: busca SOLO `programas[idxExacto]` para el match (evita falso positivo con predefinido de igual cantidad de pasos y misma tempObj).
- Si el local no coincide con `tempObj` del firmware (estado obsoleto): hace GET /programas al firmware y usa `progs[idxExacto]` de la EEPROM.
- Si es predefinido (idx < 4 o sin ULTIMO_PROG): lógica original — busca en todos los locales, fallback a fetch si no hay match.

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

### Descubrimiento IP local (resuelto 2026-07-15)

El browser no puede recibir UDP (puerto 5005 que usa el Android). Solución en dos partes:

**Firmware** (`helperGetInfo`): agrega `"ip":"192.168.x.x"` al response de `GET /info` cuando el ESP32 está conectado a WiFi. Si solo está en modo AP, el campo no aparece.

**Webapp** (`hornoService.ts`):
- `resolverIP`: negativo-cachea el fallo del probe AP 60s (elimina 500ms de overhead por request en LAN).
- `verificarHornoMQTT`: si el response de `/info` incluye `ip`, lo cachea en localStorage.
- `hornoRequest`: auto-cachea el IP tras cualquier request HTTP exitoso.
- `refreshIPCache()`: exportada, llama GET /info vía MQTT y cachea el IP sin re-vincular.

**HornoPage**: llama `refreshIPCache()` al montar, en paralelo con `getConfig`. El flujo de uso garantiza que el IP esté cacheado antes de que el usuario llegue a editar programas.

## Pendientes

### Funcionalidad

- **Deploy servidor push** (opcional, futuro) — Para integrar push nativo en la webapp, deployar `push-server/` en Fly.io o activar `push-worker/` en Cloudflare Workers Paid ($5/mes). Por ahora las notificaciones funcionan vía ntfy.sh (gratis, sin servidor).
- **Firmware: texto notificación corte_luz** — El mensaje que manda `enviarNotifNtfy()` para `corte_luz` debería indicarle al usuario que abra la app para decidir si continuar o detener el programa. El modal de continuar/detener solo aparece cuando la app está abierta; si está cerrada, la notificación ntfy llega pero no dice qué hacer.

### Técnico

- **Bundle size** — Recharts + MQTT.js son las causas principales. Solución: dynamic import de Recharts (`React.lazy`) para code-split. No es bloqueante pero afecta TTI en conexiones lentas.
- **Deploy** — actualmente manual (`git push` → GitHub Actions). El workflow ya está en `.github/workflows/deploy.yml`. URL: `https://jorgecflores-oss.github.io/ceramientas-web/`.

## Arquitectura Web Push (implementado 2026-07-15)

### Flujo

```
Firmware ESP32
    └── MQTT topic ceramientas/{id}/notif
            └── Cloudflare Durable Object (WebSocket MQTT persistente)
                    └── Web Push API → Service Worker → notificación OS
```

### push-worker/ (Cloudflare Worker)

Ruta: `C:\Users\Jorge\ceramientas-web\push-worker\`

- `src/index.ts` — HTTP handler: `GET /vapid-public-key`, `POST /subscribe`, `DELETE /subscribe`
- `src/bridge.ts` — `MqttPushBridge` Durable Object: mantiene WebSocket MQTT persistente, detecta `/notif`, dispara push a todos los suscriptores del hornoId
- `src/push.ts` — implementación nativa RFC 8291 + RFC 8188 (VAPID JWT + cifrado aes128gcm) sin dependencias npm

**KV namespace**: `SUBS` — keys: `sub:{hornoId}:{endpoint[-32:]}`, TTL 90 días, se renueva al reabrir la app.

**Secrets requeridos** (cargar con `wrangler secret put`):
- `VAPID_PRIVATE_KEY` → `Ge9Vd8P8diA0u_ICZCTPH86kcqC5Vl5--cnuKkQyayg`
- `VAPID_PUBLIC_KEY` → `BGUC52Lo3tmFLwjQYhTRVSBOuF6YS6JqXCLtpZo_EOxYMlrtrX-pPZutglY_VAly6pg3sOmdVhZ_1BHVnMjQn4k`
- `VAPID_SUBJECT` → `mailto:floresdiener@gmail.com`
- `MQTT_USER` → `ceramientas`
- `MQTT_PASS` → `8264Tomy`

### Deploy Worker (estado al 2026-07-15)

KV namespace `SUBS` ya creado (id `59bdf61299cf4e0ca5bd9f1603b583c2`). Secrets ya cargados en Cloudflare. Falta activar plan Workers Paid ($5/mes) para poder deployar (Durable Objects requieren plan pago).

```powershell
# Cuando se active el plan Paid, desde push-worker/:
wrangler deploy
# → copiar la URL a PUSH_WORKER_URL en src/utils/constants.ts
```

### push-server/ (alternativa Node.js para Fly.io o VPS)

Ruta: `C:\Users\Jorge\ceramientas-web\push-server\`

Alternativa al Cloudflare Worker, sin Durable Objects. Requiere proceso persistente (Fly.io con crédito gratuito, VPS, etc.).

- `server.js` — Express + mqtt.js + web-push. Suscripciones en memoria (se re-registran al abrir la app vía `refreshPushSubscription`). Conecta a HiveMQ via `mqtts://` port 8883. Escucha `ceramientas/+/notif` y dispara push.
- `Dockerfile` — node:20-alpine
- `fly.toml` — región `gru` (São Paulo), `auto_stop_machines = false`, `min_machines_running = 1`

Deploy: `fly launch` + `fly secret set VAPID_* MQTT_*` + `fly deploy` desde `push-server/`.

### Webapp

- `src/sw.ts` — Service Worker personalizado (injectManifest): precaching + handler `push` + handler `notificationclick`
- `src/services/pushService.ts` — `requestPushPermission`, `suscribirPush`, `desuscribirPush`, `pushSuscripto`, `refreshPushSubscription` (re-registra en servidor al abrir la app, maneja reinicios)
- `src/pages/HornoPage.tsx` — modal ntfy automático al montar (primera vez por hornoId); sin botón campana. Cuando se active `PUSH_WORKER_URL`, agregar botón y lógica Web Push.
- `src/utils/constants.ts` — `VAPID_PUBLIC_KEY` (hardcodeada) + `PUSH_WORKER_URL` (vacío = modo ntfy.sh activo)
- `vite.config.ts` — cambiado de `generateSW` a `injectManifest` para soportar SW personalizado

### UX notificaciones (HornoPage)

**Actual (ntfy.sh, sin servidor):**
- Al montar HornoPage, si no existe `@ceramientas_ntfy_shown_{hornoId}` en localStorage → muestra modal automáticamente.
- Modal tiene 3 pasos: descargar app ntfy (gratis, sin cuenta) → copiar nombre del horno → abrir ntfy, tap "+", pegar nombre, suscribirse.
- Al cerrar con "Listo, lo configuro después" → graba la flag, no vuelve a aparecer para ese hornoId.
- Si el usuario vincula un horno nuevo, aparece de nuevo para ese nuevo hornoId.

**Futuro (Web Push nativo, cuando `PUSH_WORKER_URL !== ''`):**
- Agregar botón campana en header + lógica `togglePush` (requestPermission → pushManager.subscribe → POST al servidor).
- `pushActivo` refleja el estado real de la suscripción.

### Notificaciones actuales: ntfy.sh (gratis, sin servidor)

El firmware hace HTTP POST a `https://ntfy.sh/ceramientas-{HORNO_ID}` en paralelo a cada publish MQTT de `/notif`.
No requiere cuenta ni servidor. Límite free tier: 250 mensajes/día por topic (más que suficiente para cualquier horneada).

**Eventos notificados por el firmware** (no hay notificación de inicio — el usuario lo arrancó, ya lo sabe):
- `etapa` — cambio de etapa (rampa siguiente)
- `meseta` — meseta alcanzada
- `fin` — horneada finalizada
- `corte_luz` — corte de luz detectado, suministro reestablecido
- `rampa_lenta` — temperatura sube más despacio de lo programado
- `rampa_rapida` — temperatura sube más rápido de lo programado (alarma)
- `alarma_critica` — temperatura máxima superada
- `alarma_exceso` — exceso de temperatura final

Para recibir notificaciones: instalar app ntfy en el celular (gratis, sin cuenta) → suscribirse al topic `ceramientas-{hornoId}`. Las notificaciones llegan aunque la app ntfy esté cerrada y la pantalla apagada.

### Escalabilidad

Cloudflare Workers Free: 100K req/día gratis. Web Push API: gratuita en Apple/Google/Mozilla sin límite de usuarios.
HiveMQ Free: 100 conexiones concurrentes → al llegar a ~80 hornos vendidos, migrar a VPS propio (~$6/mes, Mosquitto + Node.js).

### Migración futura: push nativo integrado en la webapp

Cuando se quiera eliminar la dependencia de ntfy.sh y tener push integrado:
1. Deployar `push-server/` (Node.js) en Fly.io o similar, O activar `push-worker/` en Cloudflare Workers Paid
2. Completar `PUSH_WORKER_URL` en `src/utils/constants.ts`
3. Agregar botón campana en HornoPage con lógica Web Push (ver sección "UX notificaciones")

## Repo

`jorgecflores-oss/ceramientas-web` (main branch).
