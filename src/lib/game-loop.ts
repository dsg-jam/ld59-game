const MAX_FRAME_TIME_VISIBLE = 0.05;
const MAX_FRAME_TIME_HIDDEN = 1;
const FRAME_MS = 16;

export interface GameLoop {
  start: () => void;
  stop: () => void;
}

export function createGameLoop(tick: (dt: number) => void): GameLoop {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let last = 0;

  const frame = (): void => {
    if (!running) {
      return;
    }
    const ts = performance.now();
    const maxFrameTime = document.hidden ? MAX_FRAME_TIME_HIDDEN : MAX_FRAME_TIME_VISIBLE;
    const dt = Math.min(maxFrameTime, (ts - last) / 1000);
    last = ts;
    tick(dt);
    timer = setTimeout(frame, FRAME_MS);
  };

  return {
    start(): void {
      if (running) {
        return;
      }
      running = true;
      last = performance.now();
      timer = setTimeout(frame, FRAME_MS);
    },
    stop(): void {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
