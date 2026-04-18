const MAX_FRAME_TIME = 0.05;

export interface GameLoop {
  start: () => void;
  stop: () => void;
}

export function createGameLoop(tick: (dt: number) => void): GameLoop {
  let raf = 0;
  let running = false;
  let last = 0;

  const frame = (ts: number): void => {
    if (!running) {
      return;
    }
    const dt = Math.min(MAX_FRAME_TIME, (ts - last) / 1000);
    last = ts;
    tick(dt);
    raf = requestAnimationFrame(frame);
  };

  return {
    start(): void {
      if (running) {
        return;
      }
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop(): void {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}
