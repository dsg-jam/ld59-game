// Tiny WebAudio bleeps for SIGNAL
export const Audio = (() => {
  let ctx = null;
  let muted = false;

  function ensure() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function blip(freq = 660, dur = 0.06, type = 'square', vol = 0.06) {
    if (muted) return;
    try {
      const c = ensure();
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, c.currentTime);
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(vol, c.currentTime + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(g); g.connect(c.destination);
      o.start();
      o.stop(c.currentTime + dur + 0.02);
    } catch (e) { void e; }
  }

  function chord(freqs, dur = 0.18, type = 'sine', vol = 0.05) {
    freqs.forEach((f, i) => setTimeout(() => blip(f, dur, type, vol), i * 70));
  }

  function noise(dur = 0.1, vol = 0.04) {
    if (muted) return;
    try {
      const c = ensure();
      const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      g.gain.value = vol;
      src.connect(g); g.connect(c.destination);
      src.start();
    } catch (e) { void e; }
  }

  return {
    place: () => blip(440, 0.04, 'square', 0.05),
    remove: () => blip(220, 0.05, 'square', 0.05),
    click: () => blip(880, 0.02, 'square', 0.04),
    tick: () => blip(900, 0.015, 'sine', 0.025),
    pulse: (v) => blip(420 + (v||0)*40, 0.03, 'triangle', 0.04),
    hit: () => blip(160, 0.08, 'sawtooth', 0.05),
    bad: () => { blip(120, 0.18, 'sawtooth', 0.07); noise(0.2, 0.03); },
    win: () => chord([523, 659, 784, 1046], 0.22, 'sine', 0.06),
    boot: () => chord([220, 330, 440], 0.12, 'square', 0.04),
    set muted(v: boolean) { muted = v; },
    get muted() { return muted; }
  };
})();
