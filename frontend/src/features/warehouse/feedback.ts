/**
 * Aviso al operario en cada lectura: un pitido corto y agudo si está bien, dos graves si
 * no, y vibración distinta (en bodega la pantalla no siempre se mira).
 */
let audio: AudioContext | null = null;

function tone(ctx: AudioContext, frequency: number, start: number, duration: number) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'square';
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.08, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(ctx.currentTime + start);
  oscillator.stop(ctx.currentTime + start + duration);
}

export function signal(ok: boolean): void {
  try {
    audio ??= new AudioContext();
    void audio.resume();
    if (ok) {
      tone(audio, 1_320, 0, 0.09);
    } else {
      tone(audio, 220, 0, 0.22);
      tone(audio, 180, 0.28, 0.3);
    }
  } catch {
    // Sin audio: queda la vibración y el aviso en pantalla.
  }
  navigator.vibrate?.(ok ? 40 : [220, 90, 220]);
}
