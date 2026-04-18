import { resolve } from "node:path";
import { defineConfig } from "vite";

const base = process.env.VITE_BASE_PATH ?? "/";

export default defineConfig({
  base,
  root: "src",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/index.html"),
        deconstruct: resolve(__dirname, "src/games/DECONSTRUCT/index.html"),
        deconstruct_siku2: resolve(__dirname, "src/games/DECONSTRUCT_SIKU2/index.html"),
        signal1: resolve(__dirname, "src/games/SIGNAL_1/index.html"),
        signal2: resolve(__dirname, "src/games/SIGNAL_2/index.html"),
        signal_weave: resolve(__dirname, "src/games/SIGNAL_WEAVE/index.html"),
      },
    },
  },
});
