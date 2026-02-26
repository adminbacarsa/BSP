/**
 * Reproduce un sonido tipo sirena cuando hay alertas NVR (mapa / operaciones).
 * Usa Web Audio API; en algunos navegadores puede requerir un gesto del usuario antes.
 */
let audioContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioContext) return audioContext;
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    audioContext = new Ctx();
    return audioContext;
  } catch {
    return null;
  }
}

export function playAlertSiren(): void {
  const ctx = getContext();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 0.12);
    osc.frequency.linearRampToValueAtTime(600, ctx.currentTime + 0.24);
    osc.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 0.36);
    osc.frequency.linearRampToValueAtTime(600, ctx.currentTime + 0.48);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.55);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.55);
  } catch (_) {
    // Silenciar si el navegador bloquea audio
  }
}
