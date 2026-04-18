let context: AudioContext | null = null;

export type WaveType = OscillatorType;

export function getAudioContext(): AudioContext {
  if (!context) {
    context = new AudioContext();
  }
  if (context.state === "suspended") {
    void context.resume();
  }
  return context;
}

export function blip(freq = 660, dur = 0.06, type: WaveType = "square", vol = 0.06): void {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  } catch {
    // ignore audio init failures
  }
}

export function beep(freq = 440, dur = 0.08): void {
  blip(freq, dur, "sine", 0.05);
}
