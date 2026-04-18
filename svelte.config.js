import adapter from "@sveltejs/adapter-static";

const base = process.env.VITE_BASE_PATH ?? "";

/** @type {import('@sveltejs/kit').Config} */
const config = {
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
