import { blip as sharedBlip, getAudioContext } from "$lib/audio";

// Procedural SFX for Signal Weave.  Mirrors the small-module pattern used by
// `signal-grid/audio.ts` and `signal-cross/audio.ts`: shared WebAudio context,
// tiny envelope-based tones, no binary assets, and a single mute toggle.
export const Audio = (() => {
  let ctx: AudioContext | null = null;
  let muted = false;

  function ensure(): AudioContext | null {
    try {
      if (!ctx) ctx = getAudioContext();
      if (ctx.state === "suspended") void ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  }

  function blip(freq = 660, dur = 0.06, type: OscillatorType = "square", vol = 0.05): void {
    if (muted) return;
    sharedBlip(freq, dur, type, vol);
  }

  function chord(freqs: number[], dur = 0.18, type: OscillatorType = "sine", vol = 0.05): void {
    if (muted) return;
    freqs.forEach((f, i) => setTimeout(() => blip(f, dur, type, vol), i * 70));
  }

  function noiseBurst(dur = 0.2, vol = 0.04, lpf = 1200): void {
    if (muted) return;
    const c = ensure();
    if (!c) return;
    try {
      const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      }
      const src = c.createBufferSource();
      src.buffer = buf;
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(lpf, c.currentTime);
      const g = c.createGain();
      g.gain.setValueAtTime(vol, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      src.connect(filter);
      filter.connect(g);
      g.connect(c.destination);
      src.start();
    } catch {
      // ignore
    }
  }

  function sweep(
    fromFreq: number,
    toFreq: number,
    dur = 0.25,
    type: OscillatorType = "sine",
    vol = 0.06
  ): void {
    if (muted) return;
    const c = ensure();
    if (!c) return;
    try {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(fromFreq, c.currentTime);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, toFreq), c.currentTime + dur);
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(vol, c.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(g);
      g.connect(c.destination);
      o.start();
      o.stop(c.currentTime + dur + 0.02);
    } catch {
      // ignore
    }
  }

  // ── Lobby / roster ─────────────────────────────────────────────────────────
  function operatorJoin(): void {
    // Rising two-note chirp
    blip(520, 0.06, "triangle", 0.05);
    setTimeout(() => blip(780, 0.08, "triangle", 0.05), 60);
  }

  function operatorLeave(): void {
    // Falling two-note chirp
    blip(520, 0.06, "triangle", 0.05);
    setTimeout(() => blip(320, 0.1, "triangle", 0.05), 70);
  }

  // ── Pulses ─────────────────────────────────────────────────────────────────
  // A short transmit blip when the local operator fires a pulse.  Frequency
  // subtly varies with the phase offset so repeated pulses feel tactile.
  function pulseSend(offsetRaw = 0): void {
    const base = 520 + (offsetRaw % 120) * 1.2;
    blip(base, 0.04, "triangle", 0.04);
  }

  // Tier-graded success tones. Bigger sync → more voices & more sparkle.
  function pulsePair(): void {
    // "spark" tier — two-note pair
    chord([660, 880], 0.12, "sine", 0.05);
  }

  function pulseTeam(): void {
    // "team" tier — three-note ascending arpeggio
    chord([523, 784, 1046], 0.14, "sine", 0.06);
  }

  function pulseConstellation(): void {
    // "constellation" tier — full major-7th arpeggio plus a shimmer sweep
    chord([523, 659, 784, 1046, 1318], 0.18, "sine", 0.06);
    setTimeout(() => sweep(1200, 2400, 0.35, "sine", 0.04), 120);
  }

  function pulseBad(): void {
    // Out-of-phase buzz with a low thud
    blip(180, 0.18, "sawtooth", 0.06);
    noiseBurst(0.18, 0.03, 800);
  }

  // ── Round lifecycle ────────────────────────────────────────────────────────
  function roundStart(): void {
    // Three-note "carrier lock" fanfare
    chord([440, 660, 990], 0.14, "square", 0.05);
  }

  function milestone(): void {
    // Bright bell-like ping
    blip(1320, 0.2, "sine", 0.06);
    setTimeout(() => blip(1760, 0.18, "sine", 0.04), 80);
  }

  function modeChange(): void {
    // Sweeping whoosh to signal the movement rotation
    sweep(300, 900, 0.35, "triangle", 0.05);
  }

  function win(): void {
    // Rising fanfare — four notes + sustained top
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      setTimeout(() => blip(f, i === notes.length - 1 ? 0.6 : 0.16, "sine", 0.07), i * 160);
    });
  }

  function lose(): void {
    // Descending stinger
    const notes = [392, 349, 311, 261];
    notes.forEach((f, i) => setTimeout(() => blip(f, 0.25, "sine", 0.06), i * 180));
  }

  return {
    operatorJoin,
    operatorLeave,
    pulseSend,
    pulsePair,
    pulseTeam,
    pulseConstellation,
    pulseBad,
    roundStart,
    milestone,
    modeChange,
    win,
    lose,
    set muted(v: boolean) {
      muted = v;
    },
    get muted() {
      return muted;
    },
  };
})();
