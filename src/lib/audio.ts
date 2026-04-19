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

// ── SEMAPHORIA SOUNDS ─────────────────────────────────────────────────────────

/**
 * Play a signal flash tone.
 * "dot" → short high-pitched blip; "dash" → longer lower tone.
 * Colour-coded pitches reinforce the visual signal.
 */
export function signalFlash(
  type: "dot" | "dash",
  color: "white" | "red" | "green" | "yellow"
): void {
  const dur = type === "dot" ? 0.18 : 0.55;
  const pitchMap: Record<string, number> = {
    white: 880,
    green: 660,
    red: 550,
    yellow: 740,
  };
  const freq = pitchMap[color] ?? 660;
  blip(freq, dur, "sine", 0.07);
}

/** Low foghorn blast — played when the Keeper opens a channel. */
export function foghorn(vol = 0.09): void {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(90, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(75, ctx.currentTime + 0.4);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(vol, ctx.currentTime + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.85);
  } catch {
    // ignore
  }
}

/** Ship bell ding — played on game start / success. */
export function shipBell(): void {
  blip(1320, 0.6, "sine", 0.08);
  setTimeout(() => blip(1760, 0.5, "sine", 0.05), 180);
}

/**
 * Collision crunch — played when the ship hits a reef.
 * Layered noise burst with a low thud.
 */
export function collisionCrunch(): void {
  try {
    const ctx = getAudioContext();
    const bufSize = ctx.sampleRate * 0.25;
    const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    }
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(800, ctx.currentTime);
    src.buffer = buffer;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  } catch {
    // ignore
  }
}

/**
 * Reef proximity rumble — a low-frequency tremor that grows louder as the
 * ship gets closer to rocks.  `intensity` ranges from 0 (silent) to 1 (max).
 */
export function proximityRumble(intensity: number): void {
  if (intensity <= 0) return;
  try {
    getAudioContext();
    const freq = 40 + intensity * 20;
    const vol = intensity * 0.04;
    blip(freq, 0.06, "sawtooth", vol);
  } catch {
    // ignore
  }
}

/** Victory fanfare — three rising beeps followed by a sustained tone. */
export function successFanfare(): void {
  const notes = [523, 659, 784, 1047];
  notes.forEach((freq, i) => {
    setTimeout(() => blip(freq, i === notes.length - 1 ? 0.8 : 0.15, "sine", 0.08), i * 180);
  });
}

/** Failure stinger — descending sad tones. */
export function failureStinger(): void {
  const notes = [392, 349, 311, 261];
  notes.forEach((freq, i) => {
    setTimeout(() => blip(freq, 0.3, "sine", 0.07), i * 200);
  });
}

/**
 * Start a looping ocean ambient background.
 * Returns a stop function that fades out and disconnects the nodes.
 */
export function startOceanAmbient(): () => void {
  try {
    const ctx = getAudioContext();
    const bufSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const lpf = ctx.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.frequency.setValueAtTime(300, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 2);

    src.connect(lpf);
    lpf.connect(gain);
    gain.connect(ctx.destination);
    src.start();

    return () => {
      try {
        gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
        setTimeout(() => {
          try {
            src.stop();
          } catch {
            // already stopped
          }
        }, 1600);
      } catch {
        // ignore
      }
    };
  } catch {
    return () => {
      /* nothing to stop */
    };
  }
}
