import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "out/**", "next-env.d.ts", "playwright-report/**", "test-results/**"],
  },
  {
    rules: {
      // `_name` means "deliberately discarded", and this codebase already
      // uses it: `const { limit: _limit, offset: _offset, ...filters }` is
      // how a request's paging keys are dropped before the rest becomes an
      // alert's filter set. Without the pattern, six such bindings were the
      // ENTIRE output of `pnpm lint` — which is how a team learns that lint
      // warnings are noise and stops reading them. Nothing is weakened: an
      // unused binding that is not opted out BY NAME is still reported.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          // `supabase.auth.getSession()` returns whatever is in the cookie,
          // WITHOUT validating the JWT against the Auth server. Deriving a
          // user id from it means trusting a value the client can edit.
          // `getUser()` verifies. There is no case in this codebase where the
          // faster one is the right one.
          selector: "MemberExpression[property.name='getSession'][object.property.name='auth']",
          message:
            "Use supabase.auth.getUser() — getSession() reads unverified cookie claims and must never be the source of an identity. See docs/security.md.",
        },
      ],
    },
  },
];

export default eslintConfig;
