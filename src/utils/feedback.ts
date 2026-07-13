let _ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  try {
    if (!_ctx) _ctx = new AudioContext()
    if (_ctx.state === 'suspended') _ctx.resume()
    return _ctx
  } catch {
    return null
  }
}

/**
 * Chasquido corto tipo teclado Android: barrido 1200→80Hz en 18ms.
 * Vibra 30ms en Android; iOS ignora la vibración silenciosamente.
 */
export function feedbackBoton() {
  try { navigator.vibrate?.(30) } catch {}

  const ctx = getCtx()
  if (!ctx) return
  try {
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    const t = ctx.currentTime
    osc.frequency.setValueAtTime(1200, t)
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.018)
    gain.gain.setValueAtTime(0.25, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.018)
    osc.start(t)
    osc.stop(t + 0.018)
  } catch {}
}
