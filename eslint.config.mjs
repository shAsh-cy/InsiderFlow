// Root ESLint flat config for packages/*, ingestion/* and the gate scripts.
// apps/web has its own config (eslint-config-next) in apps/web/eslint.config.mjs.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.wrangler/**",
      "**/drizzle/**",
      "apps/web/**",
      "**/.next/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    /*
     * Plain-JS scripts run on Node, and until this block existed ESLint did
     * not know that. `no-undef` — which is off for TypeScript, because the
     * compiler already does it better — was therefore firing on `console`,
     * `process` and `fetch` in every .mjs file.
     *
     * That mattered more than it sounds. `measure-edgar-latency.mjs` shipped
     * with a reference to `endToEndSeconds`, a variable renamed during a
     * rewrite and missed in the FAIL branch. Linting the file reported it —
     * as one line among fifteen, fourteen of which were noise about Node
     * globals. A gate whose output is mostly false is a gate nobody reads.
     *
     * The bug also survived because that branch had never run: it only
     * executes when detection latency EXCEEDS the ceiling, and every
     * measurement so far has been under it or unmeasurable. Failure paths
     * are exactly where a static check earns its keep, because tests reach
     * them last.
     */
    files: ["**/*.mjs", "**/*.cjs", "**/*.js"],
    languageOptions: { globals: globals.node },
  },
);
