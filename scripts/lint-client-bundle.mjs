#!/usr/bin/env node
/**
 * No secrets in the client bundle.
 *
 * Everything under `.next/static` is served to every visitor. A key that
 * reaches it is disclosed the moment the page loads — not "at risk", not
 * "exposed if exploited". Disclosed. `NEXT_PUBLIC_` is the only prefix Next
 * inlines, which makes this a narrow mistake to make and a total one to
 * suffer, so it gets its own gate rather than a line in a checklist.
 *
 * ── WHY THE PATTERNS ARE SHAPED THE WAY THEY ARE ──────────────────────
 *
 * The first version of this file was `grep -r sb_secret_ .next/static`,
 * and it FAILED on a clean bundle. `@supabase/supabase-js` ships
 *
 *     e.startsWith("sb_publishable_") || e.startsWith("sb_secret_")
 *
 * — a prefix test the library uses to classify a key it was handed. The
 * literal is library code doing the right thing, and a detector that
 * cannot tell it apart from a key is a detector that gets switched off
 * the first week.
 *
 * r13 hit the same class from the other side: the image-secret gate
 * greps for a decoy value, `.gitleaks.toml` allowlists that value so the
 * scanner ignores the plant, `COPY . .` carried the allowlist into the
 * image, and the gate found its own configuration and failed on a clean
 * image. Both are the same mistake — a check that matches the NAME of a
 * secret rather than the SHAPE of one.
 *
 * So every pattern below requires actual key material. `sb_secret_`
 * followed by a quote is a prefix test; `sb_secret_` followed by twenty
 * key characters is a key. JWTs are not matched by the string
 * "service_role" at all — they are decoded, and the payload's own `role`
 * claim is read.
 *
 * Usage: node scripts/lint-client-bundle.mjs [buildDir]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(import.meta.url);
const root = resolve(dirname(here), "..");
const buildDir = resolve(root, process.argv[2] ?? "apps/web/.next");

/**
 * What is scanned, and what is deliberately not.
 *
 * `static/` is the client bundle — the thing a browser downloads.
 * `server/` is NOT scanned: it runs on the server and legitimately holds
 * server-only configuration, so scanning it would flag the correct
 * arrangement of the application.
 */
const SCAN_ROOTS = ["static"];

const PATTERNS = [
  {
    id: "supabase-secret-key",
    // The `{20,}` is the whole point — see the header. A bare prefix is a
    // library's classifier; a prefix plus key material is a key.
    regex: /sb_secret_[A-Za-z0-9_-]{20,}/g,
    why: "A Supabase secret key bypasses row-level security completely.",
  },
  {
    id: "supabase-publishable-misuse",
    regex: /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'`][^"'`]{20,}["'`]/g,
    why: "The service-role key was inlined under its own name.",
  },
  {
    id: "telegram-bot-token",
    regex: /[0-9]{8,10}:AA[A-Za-z0-9_-]{33}/g,
    why: "Full control of the alert bot: read every linked chat, send as it, repoint the webhook.",
  },
  {
    id: "resend-api-key",
    regex: /\bre_[A-Za-z0-9]{24,}/g,
    why: "Send mail as this project's domain.",
  },
  {
    id: "21st-dev-key",
    regex: /21st_sk_[A-Za-z0-9]{32,}/g,
    why: "A vendor key that has no business in a browser.",
  },
  {
    id: "postgres-url-with-password",
    regex: /postgres(?:ql)?:\/\/[^\s:"'`]+:[^\s@"'`]+@[^\s"'`]+/g,
    why: "A database URL carrying credentials.",
  },
  {
    id: "private-key-block",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    why: "A private key.",
  },
];

/** base64url → utf8, or null when it is not decodable. */
function decodeSegment(segment) {
  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
}

/**
 * JWTs, judged by their CLAIMS rather than by any string near them.
 *
 * The anon key is a JWT too, it is `NEXT_PUBLIC_` by design, and it is
 * SUPPOSED to be in the bundle — row-level security is what protects the
 * data behind it. So the token alone means nothing and the payload is the
 * only thing worth reading. `role: service_role` is the one that bypasses
 * RLS; `role: anon` is the shipped, correct arrangement.
 */
function serviceRoleTokens(text) {
  const found = [];
  const jwt = /eyJ[A-Za-z0-9_-]{8,}\.([A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;
  for (const match of text.matchAll(jwt)) {
    const payload = decodeSegment(match[1]);
    if (!payload) continue;
    let claims;
    try {
      claims = JSON.parse(payload);
    } catch {
      continue;
    }
    if (typeof claims?.role === "string" && claims.role !== "anon") {
      found.push({ role: claims.role, ref: claims.ref ?? claims.iss ?? "unknown" });
    }
  }
  return found;
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|mjs|cjs|json|css|map|txt|html)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// The scanner must not be scannable. r13's lesson, made mechanical: if the
// build ever started emitting this file, every pattern in it would match
// itself and the gate would fail forever on a clean bundle.
if (!relative(buildDir, here).startsWith("..")) {
  console.error("client bundle: this script is inside the scan root, which cannot be right");
  process.exit(1);
}

let files;
try {
  statSync(buildDir);
  files = SCAN_ROOTS.flatMap((sub) => walk(join(buildDir, sub)));
} catch {
  console.error(
    `client bundle: no build at ${relative(root, buildDir)} — run \`pnpm --filter @insiderflow/web build\` first.\n` +
      "Refusing to report a clean scan of a directory that does not exist.",
  );
  process.exit(1);
}

if (files.length === 0) {
  console.error(
    `client bundle: ${relative(root, buildDir)} has no client assets — nothing scanned.`,
  );
  process.exit(1);
}

const findings = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const name = relative(root, file).split(String.fromCharCode(92)).join("/");
  for (const { id, regex, why } of PATTERNS) {
    for (const match of text.matchAll(regex)) {
      findings.push({ file: name, id, why, redacted: `${match[0].slice(0, 6)}…[redacted]` });
    }
  }
  for (const { role, ref } of serviceRoleTokens(text)) {
    findings.push({
      file: name,
      id: "supabase-non-anon-jwt",
      why: `A JWT whose role claim is "${role}" (project ${ref}). Only role=anon belongs in a browser.`,
      redacted: "[redacted]",
    });
  }
}

if (findings.length > 0) {
  console.error(
    `client bundle: ${findings.length} secret(s) found in what every visitor downloads\n`,
  );
  for (const f of findings) {
    console.error(`  ${f.file}\n    ${f.id}: ${f.redacted}\n    ${f.why}`);
  }
  console.error(
    "\nROTATE IT FIRST. The bundle has been served; removing the value from source does not\n" +
      "un-serve it. Only NEXT_PUBLIC_-prefixed variables are inlined by Next, so the fix is\n" +
      "almost always a server-only value read in a client component.",
  );
  process.exit(1);
}

console.log(
  `client bundle ok — ${files.length} client assets scanned, ${PATTERNS.length} key shapes + JWT role claims, no secrets found`,
);
