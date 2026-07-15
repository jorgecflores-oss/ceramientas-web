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

## Sesión 2026-07-14 (parte 2) — investigación pendiente

### Problema abierto: HTTP nunca funciona en LAN

**Hallazgo crítico**: `cacheIP()` está exportada en hornoService pero **nunca se llama desde ningún componente**. `resolverIP()` solo resuelve:
1. AP mode (192.168.4.1) — cuando el horno funciona como hotspot
2. Lo que haya en `localStorage` via `getCachedIP` — que siempre es null porque nadie llama `cacheIP`

**Consecuencia**: En escenario LAN (misma red WiFi), el app SIEMPRE cae a MQTT para todo. Nunca usa HTTP. El LED "Local" nunca se activa en LAN.

**Lo que estaba pasando**: Antes del fix MQTT, los POSTs fallaban con 400 via MQTT pero el error se tragaba silenciosamente y `actualizarLocal` se llamaba igual — el usuario veía las ediciones "guardadas" en la UI pero la EEPROM nunca se actualizaba.

**Lo que dice el usuario**: "La app Android lo hacía automáticamente" — el Android descubría el IP de LAN sin que el usuario tuviera que hacer nada. **Investigar cómo**.

### Cambios UNCOMMITTED de esta sesión (no commitear hasta resolver)

| Archivo | Cambio |
|---------|--------|
| `hornoService.ts` | `cacheIP(hornoId, ip)` en el path HTTP exitoso (auto-cache) |
| `ConfigPage.tsx` | Campo "IP local" manual en sección Horno |
| `ProgramasPage.tsx` | Mensajes de error mejorados con instrucciones |

Estos cambios están en el working tree pero **sin commit**. Pueden descartarse con `git restore src/`.

### Qué investigar antes de continuar

1. **¿Cómo descubría el IP la app Android?** — Opciones posibles:
   - El firmware publica su IP en un topic MQTT al conectarse a WiFi (ej: `ceramientas/{id}/info`)
   - El firmware tiene mDNS/Bonjour y la app Android lo resuelve (el browser no puede)
   - La app Android escanea la subnet (el browser no puede)
   - El firmware incluye su IP en la respuesta de algún endpoint MQTT (GET /info, GET /estado)
   - **Revisar la app Android y el firmware para entender el mecanismo**

2. **¿Es posible replicar ese mecanismo en el browser?** — Si el firmware publica su IP via MQTT, el webapp puede suscribirse y cachearlo. Si es mDNS, no se puede desde browser.

3. **Evaluar si el fix MQTT (propagación de errores) debe mantenerse** — Expone fallas reales pero rompió la UX de edición que "funcionaba" (aunque fuera falso). Alternativa: restaurar silent-fail para ediciones hasta tener HTTP funcionando, pero eso es peligroso (safety issue de temperatura).

### Sesión 2026-07-14 — cambios y cómo revertir

### Cambios aplicados (todos en main, pusheados)

| Commit | Archivo | Qué hace |
|--------|---------|----------|
| `f0e87f0` | ProgramasPage | inputs vacíos en modal (valor \|\| '') |
| `7dda3fe` | ProgramasPage | validación 30–1300°C + re-POST antes de ejecutar |
| `9053b92` | ProgramasPage | temp mínima 30°C (bajada de 100°C) |
| `936fdc3` | hornoService + HornoPage | fix MQTT silencioso + revert curva a lógica base |
| `84be13f` | HornoPage + ProgramasPage | curva idx exacto custom + refetch + error WiFi |

### Si la curva sigue fallando → revertir solo `84be13f`

El commit `84be13f` toca `calcularYGuardarCurva` en HornoPage y el useEffect de carga en ProgramasPage.
```
git revert 84be13f --no-edit
```
Esto vuelve a la lógica base (busca en todos los programas, fallback a fetch si no hay match). El problema de falso positivo con predefinidos puede reaparecer en casos específicos.

### Si el fix MQTT rompe algo → revertir `936fdc3`

```
git revert 936fdc3 --no-edit
```
Vuelve al MQTT sin check de status (errores firmware silenciosos). El "nombre requerido" vuelve a tragarse pero `actualizarLocal` se llama igual. **No recomendado** porque el bug de seguridad (firmware ignorando edición) vuelve.

### Si los cambios de ProgramasPage rompen la lista → revertir `7dda3fe` y `f0e87f0`

```
git revert 7dda3fe --no-edit
git revert f0e87f0 --no-edit
```

### Estado esperado tras todos los cambios
- Editar custom **en LAN/AP**: guarda en EEPROM, curva dibuja correcta ✓
- Editar custom **solo MQTT**: falla con mensaje claro "necesitás estar en la misma red Wi-Fi" ✓
- Curva custom: siempre usa el idx exacto del último programa ejecutado ✓
- Lista de programas: se refresca del firmware cada vez que se abre ProgramasPage ✓

## Pendientes

### Funcionalidad

- **Web Push VAPID** (Fase 3) — notificaciones push reales al cerrar la app.
- **Cloudflare Worker** (Fase 3) — intermediario para push.

### Técnico

- **Bundle size** — Recharts + MQTT.js son las causas principales. Solución: dynamic import de Recharts (`React.lazy`) para code-split. No es bloqueante pero afecta TTI en conexiones lentas.
- **Deploy** — actualmente manual (`git push` → GitHub Actions). El workflow ya está en `.github/workflows/deploy.yml`. URL: `https://jorgecflores-oss.github.io/ceramientas-web/`.

## Repo

`jorgecflores-oss/ceramientas-web` (main branch).
