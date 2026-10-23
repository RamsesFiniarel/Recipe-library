import js from "@eslint/js";
import globals from "globals";

// Recommended rules everywhere: browser in src/, Node for the server and
// scripts, both for shared/.
export default [
  { ignores: ["dist/", "public/ocr/", "node_modules/"] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: "module" },
    rules: {
      // A leading underscore marks a positional-only parameter; a property
      // destructured beside ...rest is left out on purpose.
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }],
    },
  },
  { files: ["src/**/*.js"], languageOptions: { globals: globals.browser } },
  { files: ["server/**/*.js", "scripts/**/*.mjs", "tests/**/*.js", "*.config.js"], languageOptions: { globals: globals.node } },
  { files: ["shared/**/*.js"], languageOptions: { globals: { ...globals.browser, ...globals.node } } },
];
