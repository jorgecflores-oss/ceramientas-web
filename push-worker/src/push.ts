// Web Push nativo — RFC 8291 (payload) + RFC 8188 (aes128gcm) + VAPID

export interface WebPushSub {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface PushPayload {
  title: string
  body: string
  data?: Record<string, unknown>
}

// --- helpers base64url ---

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (s.length % 4)) % 4)
  const chars = atob(padded)
  const buf = new ArrayBuffer(chars.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < chars.length; i++) view[i] = chars.charCodeAt(i)
  return view
}

function b64urlEncode(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// --- HKDF primitivas (RFC 5869) ---

type UA = Uint8Array<ArrayBufferLike>

async function hmac(key: UA, data: UA): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data) as ArrayBuffer)
}

async function hkdfExtract(salt: UA, ikm: UA): Promise<Uint8Array<ArrayBuffer>> {
  return hmac(salt, ikm)
}

async function hkdfExpand(prk: UA, info: UA, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Uint8Array(new ArrayBuffer(length))
  let T: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0))
  let offset = 0
  for (let i = 1; offset < length; i++) {
    const input = new Uint8Array(new ArrayBuffer(T.length + info.length + 1))
    input.set(T as UA); input.set(info, T.length); input[T.length + info.length] = i
    T = await hmac(prk, input)
    const take = Math.min(T.length, length - offset)
    out.set(T.subarray(0, take) as UA, offset)
    offset += take
  }
  return out
}

// --- VAPID JWT (ES256) ---

async function importVapidPrivKey(privB64: string, pubB64: string): Promise<CryptoKey> {
  const priv = b64urlDecode(privB64)
  const pub = b64urlDecode(pubB64)   // 65 bytes: 0x04 || x (32) || y (32)
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256', ext: true,
    d: b64urlEncode(priv),
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

async function vapidJwt(subject: string, audience: string, sigKey: CryptoKey): Promise<string> {
  const enc = new TextEncoder()
  const hdr = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const now = Math.floor(Date.now() / 1000)
  const pay = b64urlEncode(enc.encode(JSON.stringify({ aud: audience, exp: now + 43200, sub: subject })))
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, sigKey, enc.encode(`${hdr}.${pay}`))
  return `${hdr}.${pay}.${b64urlEncode(sig)}`
}

// --- Cifrado payload (RFC 8291 + RFC 8188 aes128gcm) ---

async function encryptPayload(
  payload: string,
  p256dhB64: string,
  authB64: string,
): Promise<Uint8Array> {
  const enc = new TextEncoder()

  // Clave pública del suscriptor (user agent)
  const uaPubRaw = b64urlDecode(p256dhB64)
  const uaPubKey = await crypto.subtle.importKey(
    'raw', uaPubRaw, { name: 'ECDH', namedCurve: 'P-256' }, true, []
  )

  // Par efímero del servidor
  const asKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  ) as CryptoKeyPair
  const asPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey) as ArrayBuffer)

  // Secreto ECDH
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', $public: uaPubKey }, asKeyPair.privateKey, 256) as ArrayBuffer
  )

  // Derivación de clave (RFC 8291 §3.3)
  const authSecret = b64urlDecode(authB64)
  const prkKey = await hkdfExtract(authSecret, ecdhSecret)

  const keyInfoPrefix = enc.encode('WebPush: info\x00')
  const keyInfo = new Uint8Array(keyInfoPrefix.length + uaPubRaw.length + asPubRaw.length)
  keyInfo.set(keyInfoPrefix)
  keyInfo.set(uaPubRaw, keyInfoPrefix.length)
  keyInfo.set(asPubRaw, keyInfoPrefix.length + uaPubRaw.length)
  const ikm = await hkdfExpand(prkKey, keyInfo, 32)

  // aes128gcm (RFC 8188)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const prk = await hkdfExtract(salt, ikm)
  const cekBytes = await hkdfExpand(prk, enc.encode('Content-Encoding: aes128gcm\x00'), 16)
  const nonce = await hkdfExpand(prk, enc.encode('Content-Encoding: nonce\x00'), 12)

  const cekKey = await crypto.subtle.importKey('raw', cekBytes, 'AES-GCM', false, ['encrypt'])
  const plaintext = enc.encode(payload)
  const padded = new Uint8Array(plaintext.length + 1)
  padded.set(plaintext); padded[plaintext.length] = 0x02 // delimitador single-record

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, padded)
  )

  // Header RFC 8188 §2.1: salt (16) | rs (4, BE) | idlen (1) | keyid (asPubRaw)
  const header = new Uint8Array(21 + asPubRaw.length)
  header.set(salt)
  new DataView(header.buffer).setUint32(16, 4096, false)
  header[20] = asPubRaw.length
  header.set(asPubRaw, 21)

  const body = new Uint8Array(header.length + ciphertext.length)
  body.set(header); body.set(ciphertext, header.length)
  return body
}

// --- API pública ---

export async function sendPush(
  sub: WebPushSub,
  payload: PushPayload,
  vapidPrivKey: string,
  vapidPubKey: string,
  vapidSubject: string,
): Promise<void> {
  const audience = new URL(sub.endpoint).origin
  const sigKey = await importVapidPrivKey(vapidPrivKey, vapidPubKey)
  const jwt = await vapidJwt(vapidSubject, audience, sigKey)
  const body = await encryptPayload(JSON.stringify(payload), sub.keys.p256dh, sub.keys.auth)

  const resp = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
      'Authorization': `vapid t=${jwt},k=${vapidPubKey}`,
    },
    body,
  })

  if (!resp.ok && resp.status !== 201) {
    const err = Object.assign(new Error(`Push failed ${resp.status}`), { status: resp.status })
    throw err
  }
}
