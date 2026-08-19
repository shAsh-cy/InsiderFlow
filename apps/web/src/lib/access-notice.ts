/**
 * The access-banner dismissal cookie name, in a module with no directive.
 *
 * NOT exported from `components/access/access-banner.tsx`, and the reason is
 * worth the file. That module is `"use client"`. When a Server Component
 * imports from a client module, the bundler replaces the import with a
 * CLIENT REFERENCE — which is the right thing for a component, and silently
 * wrong for a plain constant: the server gets a reference stub rather than
 * the string.
 *
 * The failure is quiet. `cookieStore.has(stub)` does not throw; it looks up
 * a name that is not there and returns false, so the banner renders for a
 * reader who dismissed it and the layout shift it was moved to fix comes
 * straight back. Caught by `e2e/auth.spec.ts` — "dismissal sticks across a
 * reload" — which failed on exactly this and on nothing else.
 *
 * A constant shared across the boundary belongs in a module that belongs to
 * neither side.
 */
export const ACCESS_NOTICE_COOKIE = "if-access-notice";
