export const MQTT_BROKER = 'wss://e4aa6c1aae5f48b0a09026ebdcde979c.s1.eu.hivemq.cloud:8884/mqtt'
export const MQTT_USER = 'ceramientas'
export const MQTT_PASS = '8264Tomy'

export const HTTP_TIMEOUT = 5000
export const AP_IP = '192.168.4.1'
export const OTA_VERSION_URL = 'https://raw.githubusercontent.com/jorgecflores-oss/ceramientas-firmware/main/version.json'

export const STORAGE_KEYS = {
  HORNO_ID: '@ceramientas_horno_id',
  HORNOS_LISTA: '@ceramientas_hornos_lista',
  PASS: (id: string) => `@ceramientas_pass_${id}`,
  IP_CACHE: (id: string) => `@ceramientas_ip_${id}`,
  PROGRAMAS: (id: string) => `@ceramientas_programas_${id}`,
  INICIO: (id: string) => `@ceramientas_inicio_${id}`,
  PROGRAMAS_CACHE: (id: string) => `@ceramientas_programas_${id}`,
  CURVA: (id: string) => `@ceramientas_curva_${id}`,
  POTENCIA: (id: string) => `@ceramientas_potencia_${id}`,
  ULTIMO_YMAX: (id: string) => `@ceramientas_ymax_${id}`,
  SNAPSHOT: (id: string) => `@ceramientas_snapshot_${id}`,
  HISTORIAL_CACHE: (id: string) => `@ceramientas_historial_${id}`,
  HISTORIAL_BORRADOS: (id: string) => `@ceramientas_historial_borrados_${id}`,
} as const