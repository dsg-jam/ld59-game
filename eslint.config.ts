import js from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", ".svelte-kit/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...svelte.configs["flat/recommended"],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  }
);
