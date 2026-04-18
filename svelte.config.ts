import adapter from "@sveltejs/adapter-static";
import type { Config } from "@sveltejs/kit";

const base = process.env.VITE_BASE_PATH ?? "";

const config: Config = {
  kit: {
    adapter: adapter({
      pages: "dist",
      assets: "dist",
      fallback: "404.html",
    }),
    paths: {
      base,
    },
  },
};

export default config;
