let audioCtx: AudioContext | null = null;

function ac(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function beep(f: number, d = 0.08, type: OscillatorType = "square", v = 0.06): void {
  try {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, c.currentTime);
    g.gain.setValueAtTime(v, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + d);
    o.connect(g);
    g.connect(c.destination);
    o.start();
    o.stop(c.currentTime + d);
  } catch {
    /* ignore */
  }
}

export const sfx = {
  ring: (): void => {
    beep(880, 0.12);
    setTimeout(() => beep(880, 0.12), 180);
  },
  select: (): void => {
    beep(660, 0.05);
  },
  connect: (): void => {
    beep(523, 0.06);
    setTimeout(() => beep(784, 0.1), 70);
  },
  chaos: (): void => {
    beep(300, 0.08);
    setTimeout(() => beep(450, 0.08), 70);
    setTimeout(() => beep(250, 0.14, "sawtooth"), 140);
  },
  penalty: (): void => {
    beep(180, 0.18, "sawtooth", 0.08);
    setTimeout(() => beep(130, 0.24, "sawtooth", 0.07), 160);
  },
  hangup: (): void => {
    beep(440, 0.05);
    setTimeout(() => beep(330, 0.09), 60);
  },
  line: (): void => {
    beep(720 + Math.random() * 250, 0.02, "square", 0.025);
  },
  tick: (): void => {
    beep(1200, 0.02, "square", 0.03);
  },
  denied: (): void => {
    beep(160, 0.15, "triangle", 0.05);
  },
  stamp: (): void => {
    beep(200, 0.04, "square", 0.08);
    setTimeout(() => beep(90, 0.12, "sawtooth", 0.07), 50);
  },
  agency: (): void => {
    beep(140, 0.22, "triangle", 0.09);
    setTimeout(() => beep(180, 0.22, "triangle", 0.08), 240);
    setTimeout(() => beep(110, 0.3, "sawtooth", 0.07), 500);
  },
};

export function unlockAudio(): void {
  try {
    const c = ac();
    if (c.state === "suspended") void c.resume();
    beep(1, 0.001, "sine", 0.0001);
  } catch {
    /* ignore */
  }
}
