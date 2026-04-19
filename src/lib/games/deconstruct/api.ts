/**
 * Typed module API for the Deconstruct game.
 *
 * Rather than assigning callbacks to `window`, the game engine populates this
 * registry after it loads, and the Svelte page component reads from it.  The
 * registry is a plain mutable object so that:
 *   - all keys are strongly typed,
 *   - neither side imports the other (no circular dependency), and
 *   - the optional-chaining call pattern keeps the same "not-yet-loaded" safety
 *     that the previous `window as GameWindow` approach relied on.
 */
export type DeconstructAPI = {
  soloGame: () => void;
  hostGame: () => void;
  joinGame: () => void;
  hostStartNow: () => void;
  onPickCard: () => void;
  onClear: () => void;
  onPass: () => void;
};

/** Populated by the game engine module once it finishes loading. */
export const deconstructApi: Partial<DeconstructAPI> = {};
