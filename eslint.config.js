import js from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "node_modules/",
      ".svelte-kit/",
      "src/routes/games/**/*.ts",
      "src/routes/games/**/*.js",
      "svelte.config.js",
      "vite.config.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs["flat/recommended"],
  {
    files: ["src/lib/**/*.ts", "src/routes/**/*.svelte"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      eqeqeq: "error",
      "no-var": "error",
      "prefer-const": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": "error",
      "no-console": "warn",
      "svelte/no-at-html-tags": "off",
    },
  },
  {
    files: ["src/lib/**/*.ts"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "error",
    },
  }
);
