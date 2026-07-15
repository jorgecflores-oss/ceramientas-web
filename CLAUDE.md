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
- Fix (2026-07-14): inputs vacios en modal edición (valor || '' con placeholder)
- Fix (2026-07-14): validación temp custom 30–1300°C en guardarPasos
- Fix (2026-07-14): re-POST pasos antes de ejecutar + STORAGE_KEYS.ULTIMO_PROG
- Fix (2026-07-14): MQTT silencioso — propagar errores firmware tras mqttRequest
- Fix (2026-07-14): curva programas custom — idx exacto sin mezclar predefinidos + refetch ProgramasPage
- Feat (2026-07-15): descubrimiento IP local — firmware publica IP en GET /info, webapp lo cachea al abrir HornoPage
- Fix (2026-07-15): negativo-cache del probe AP (elimina 500ms de overhead por request en LAN)
- Fix (2026-07-15): refreshIPCache() en HornoPage — cachea IP sin necesidad de re-vincular tras actualizar firmware

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

- **Web Push VAPID** (Fase 3) — notificaciones push cuando la app está cerrada o en background. Ver sección de arquitectura abajo.

### Técnico

- **Bundle size** — Recharts + MQTT.js son las causas principales. Solución: dynamic import de Recharts (`React.lazy`) para code-split. No es bloqueante pero afecta TTI en conexiones lentas.
- **Deploy** — actualmente manual (`git push` → GitHub Actions). El workflow ya está en `.github/workflows/deploy.yml`. URL: `https://jorgecflores-oss.github.io/ceramientas-web/`.

## Arquitectura Web Push (Fase 3)

### Qué notifica la app Android (referencia)

Todas disparadas por estado MQTT o topic `/notif`, con deduplicación via cooldown:

| Tipo | Trigger | Cooldown | Mensaje |
|------|---------|----------|---------|
| `etapa` | nueva etapa iniciada (edge) | 30s | "Etapa N de M iniciada" |
| `meseta` | nuevo estado meseta (edge por etapa) | 30s | "Meseta etapa N: temperatura estable" |
| `fin` | idle/finalizado tras proceso (edge) | 30s | "Horneado finalizado" |
| `alarma_critica` | estado alarma_critica (edge) | 30s | "¡ALARMA! Temperatura máxima superada" |
| `alarma_exceso` | estado alarma_exceso (edge) | 30s | "Exceso de temperatura final" |
| `rampa_lenta` | flag `rl=true` (level, cooldown Inf) | ∞ | "E{n} calienta lento: {t}°C de {obj}°C" |
| `rampa_rapida` | flag `rr=true` (level, cooldown Inf) | ∞ | "⚡ PELIGRO E{n}: rampa acelerada" |
| `corte_luz` | flag `cl=true` o topic `/notif` | 30s | "⚡ Corte de luz detectado" |
| `detenido` | idle tras proceso, gap < 10s (edge) | 30s | "Proceso detenido manualmente" |

### Arquitectura propuesta

```
Firmware ESP32
    └── MQTT topic ceramientas/{id}/notif + estado
            └── Cloudflare Worker (suscripto al broker HiveMQ)
                    └── Web Push API → browser del usuario
```

**Cloudflare Worker** (worker independiente, no en la webapp):
- Se suscribe al broker MQTT HiveMQ via WebSocket.
- Escucha `ceramientas/+/estado` y `ceramientas/+/notif`.
- Detecta los eventos listados arriba (misma lógica de deduplicación que HornoScreen.js).
- Guarda subscripciones push en KV: `{hornoId} → [PushSubscription]`.
- Dispara `webpush.sendNotification()` a cada subscripción registrada.

**Webapp** (cliente):
- Registra Service Worker con `pushManager.subscribe()`.
- Envía la `PushSubscription` al Worker via HTTP POST `/api/subscribe`.
- El Service Worker recibe el push y muestra la notificación nativa del OS.

### Endpoint del Worker

```
POST /api/subscribe   { hornoId, subscription: PushSubscription }  → 200
DELETE /api/subscribe { hornoId, endpoint }                        → 200
```

### VAPID keys

Generar una vez con `npx web-push generate-vapid-keys`, guardar en secrets de Cloudflare.
La clave pública va hardcodeada en la webapp (constante en `constants.ts`).

## Repo

`jorgecflores-oss/ceramientas-web` (main branch).
