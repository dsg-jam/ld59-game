import { blip as sharedBlip, getAudioContext } from "$lib/audio";

// Tiny WebAudio bleeps for SIGNAL
export const Audio = (() => {
  let ctx: AudioContext | null = null;
  let muted = false;

  function isValidOscillatorType(type: unknown): type is OscillatorType {
    return type === "sine" || type === "square" || type === "sawtooth" || type === "triangle";
  }

  function ensure() {
    if (!ctx) ctx = getAudioContext();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function blip(freq = 660, dur = 0.06, type = "square", vol = 0.06) {
    if (muted) return;
    const oscType: OscillatorType = isValidOscillatorType(type) ? type : "square";
    sharedBlip(freq, dur, oscType, vol);
  }

  function chord(freqs: number[], dur = 0.18, type = "sine", vol = 0.05) {
    freqs.forEach((f, i) => setTimeout(() => blip(f, dur, type, vol), i * 70));
  }

  function noise(dur = 0.1, vol = 0.04) {
    if (muted) return;
    try {
      const c = ensure();
      const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++)
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      g.gain.value = vol;
      src.connect(g);
      g.connect(c.destination);
      src.start();
    } catch (e) {
      void e;
    }
  }

  return {
    place: () => blip(440, 0.04, "square", 0.05),
    remove: () => blip(220, 0.05, "square", 0.05),
    click: () => blip(880, 0.02, "square", 0.04),
    tick: () => blip(900, 0.015, "sine", 0.025),
    pulse: (v: number) => blip(420 + (v || 0) * 40, 0.03, "triangle", 0.04),
    hit: () => blip(160, 0.08, "sawtooth", 0.05),
    bad: () => {
      blip(120, 0.18, "sawtooth", 0.07);
      noise(0.2, 0.03);
    },
    win: () => chord([523, 659, 784, 1046], 0.22, "sine", 0.06),
    boot: () => chord([220, 330, 440], 0.12, "square", 0.04),
    set muted(v: boolean) {
      muted = v;
    },
    get muted() {
      return muted;
    },
  };
})();
