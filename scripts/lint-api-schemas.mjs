#!/usr/bin/env node
/**
 * API input-validation linter — the "if you read it, parse it" rule.
 *
 * ── WHAT THIS IS, HONESTLY ────────────────────────────────────────────
 *
 * It is a ratchet, not a repair. When the first version was written the
 * coverage it checks for was already broad: most exported handlers under
 * app/api pushed every value they read through lib/api/schemas.ts or a
 * local Zod object, and the rest read no untrusted input at all.
 *
 * It is still worth running, for a reason the healthy present state
 * hides. The schemas are SHARED and the handlers are NOT. Adding a route
 * is a one-file change that never opens schemas.ts, so validation does
 * not get skipped here by anyone deciding to skip it — it gets skipped by
 * a new handler reaching for `searchParams.get("x")` because that was the
 * shortest line that worked, in a file where no schema was already in
 * scope to make the alternative obvious. The handlers that do it right
 * are evidence that the habit is good, not that the next one inherits it.
 *
 * ── WHAT THE SHORTCUT COST, ONCE ──────────────────────────────────────
 *
 * Not theoretical. The first run of this file flagged six handlers; five
 * were argued into the allowlist and one was a real defect:
 *
 *   DELETE /api/me/watchlist read `kind` from the query string, checked
 *   only that it was non-empty, and handed it to `removeWatchlistItem`,
 *   which cast it (`kind as "company"`) into a comparison against a
 *   Postgres ENUM column. `?kind=bogus` made Postgres raise 22P02. The
 *   handler had no try/catch and was not wrapped in `handleApi`, so a
 *   malformed query parameter — a textbook 400 — was answered with a 500
 *   for any signed-in user who typed it. The same field was
 *   `z.enum(["company","insider"])` on POST, twenty lines above, in the
 *   same file.
 *
 * That handler now parses both query parameters with `deleteQuerySchema`
 * and answers 400, and its allowlist entry is gone. The shape is what to
 * remember: not a missing security control anybody argued about, but one
 * branch of one file where the value was used before it was narrowed,
 * while its sibling branch did it right.
 *
 * The per-read-site rule below then surfaced three more the handler-level
 * version could not see, all argued rather than fixed: the `preset` and
 * `screen` path segments, narrowed by the `isScreenerPreset` type guard
 * instead of a schema, and `url.search` echoed into an RSS self-link.
 * That is why the allowlist holds eight entries and not five.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────
 *
 * Per READ SITE, inside a per-handler analysis. Both halves matter, and
 * each was a hole in an earlier version of this file:
 *
 *   - per handler, not per file — a file whose POST parses and whose
 *     DELETE does not is exactly the bug above, and a file-level check
 *     would call it clean;
 *   - per read site, not per handler — a handler that parses ONE value
 *     and uses its sibling raw is the same bug at smaller scale, and a
 *     handler-level "does a schema appear anywhere in here" check would
 *     call THAT clean. It did: the version of this gate that shipped
 *     first would have missed the watchlist defect above had the handler
 *     happened to parse `refId` while leaving `kind` raw.
 *
 * A read site is one of:
 *
 *   query   `searchParams`, `searchParamsToObject(…)`, `URLSearchParams`,
 *           or `.search` — every spelling of "look at the query string";
 *   body    `.json() .text() .formData() .arrayBuffer() .blob() .bytes()`
 *           or `.body`, called on the handler's own request parameter, on
 *           an alias of it, or on the parameter a same-file helper
 *           received it through;
 *   path    a `[param]` segment in the route path that the handler
 *           actually references.
 *
 * A read site is NARROWED when it sits inside the argument list of a Zod
 * `.parse(`/`.safeParse(`, or when the name it is bound to appears inside
 * one. Everything else is a finding, or an ALLOWLIST entry with a written
 * reason.
 *
 * ── WHAT COUNTS AS ZOD, AND WHY IT IS NOT A NAME CHECK ────────────────
 *
 * A parse call counts only when the file imports `zod` (or a `…schemas`
 * module) AND the receiver of the call is the `z` namespace, an identifier
 * ending in `Schema`/`schema`/`schemas`, or a name this file binds to a
 * `z.…` expression — so `const q = z.object({…}); q.parse(x)` counts
 * without the gate dictating what schemas may be called. The earlier version
 * accepted any identifier ending in `Schema` even with no parse call at
 * all, and any `.parse(` that was not `JSON`/`Number`/`Date` — so
 * `const columnSchema = COLUMNS` (a database column map) and
 * `qs.parse(searchParams.toString())` (a querystring library) each
 * silenced a handler that validated nothing. Nothing in this tree ever
 * relied on the weak signal, which is why tightening it changed no
 * verdict here; it removes a bypass, not a behaviour.
 *
 * ── LIMITS, STATED RATHER THAN DISCOVERED LATER ───────────────────────
 *
 * This is a regex, not a type checker, and three things follow.
 *
 * It proves a read site reaches a Zod parse; it does not prove the SCHEMA
 * is the right one. `tradesQuerySchema.parse(searchParamsToObject(...))`
 * and `tradesQuerySchema.parse({})` are indistinguishable to it.
 *
 * It follows helpers declared in the SAME FILE and nothing further. A
 * handler that hands its request to an imported helper which reads the
 * body is invisible here.
 *
 * A value narrowed by something other than Zod — the `isScreenerPreset`
 * type guard on the two preset routes, `parseCursor` on the stream — is
 * a finding until somebody writes down why it is fine. That is the
 * design, not a false positive: a type guard can be stronger than a
 * schema, and the allowlist is where that claim gets made in public.
 *
 * Headers and cookies are deliberately out of scope. The two headers that
 * matter are read by code that already treats them as hostile (the
 * Telegram webhook secret, compared in constant time; the SSE
 * `last-event-id` cursor), and widening the rule to headers would flag
 * every `req.headers.get("…")` in the tree without finding anything the
 * three sources above miss. The summary below therefore says "no query,
 * body or path input", never "no input" — a handler that reads a session
 * cookie or a header reads plenty, and this gate did not look at it.
 *
 * ── THE GATE HAS ITS OWN TESTS ────────────────────────────────────────
 *
 * `SELF_TEST` at the bottom runs on every invocation, before the tree is
 * walked, and every case in it is a shape that got past an earlier
 * version of this file. A linter with no tests fails the way a bad test
 * does: it goes quiet and reports success. These cost about a
 * millisecond, so there is no version of this that runs without them.
 *
 * Usage: node scripts/lint-api-schemas.mjs [dir]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(root, process.argv[2] ?? "apps/web/src/app/api");

/**
 * THE ALLOWLIST. One entry per (file, handler) that reads input without
 * narrowing it through Zod, with the reason a schema would add nothing.
 * Writing the sentence is the point: it costs a minute and it turns "I
 * didn't parse it" into a claim a reviewer can refuse.
 *
 * `why` is ENFORCED, not decorative — see `validateAllowlist`. An entry
 * with a missing, empty or one-word reason fails the gate. Until that
 * check existed, `{ file, handler }` with no `why` at all silenced a
 * handler AND was counted in the summary line that claims every silenced
 * handler is "justified in ALLOWLIST", which made the gate assert
 * something nobody had written down.
 */
const ALLOWLIST = [
  {
    file: "apps/web/src/app/api/stream/route.ts",
    handler: "GET",
    why:
      "Both values are constrained tighter than a schema would constrain them. The cursor goes through " +
      "`parseCursor` (lib/api/stream-cursor.ts), a total function returning null unless the id matches " +
      "/^[0-9a-f-]{36}$/i and the timestamp is a representable Date; null falls back to 'now', so a " +
      "malformed cursor degrades instead of failing. `mode` is compared for equality against the single " +
      'literal "poll" — nothing is stricter than that. The bound on the timestamp is not incidental: this ' +
      "entry was first written while `Number.isFinite` was the only check, which accepts 1e30, and " +
      "`new Date(1e30).toISOString()` throws RangeError — a 500 any anonymous caller could produce on " +
      "?mode=poll. Fixed, with the property asserted in stream-cursor.test.ts.",
  },
  {
    file: "apps/web/src/app/api/alerts/unsubscribe/route.ts",
    handler: "GET",
    why:
      "The token IS the credential, and it is opaque. Its validity is decided by the row lookup in " +
      "`unsubscribeByToken` — parameterised, and scoped by the RLS capability policy to the single channel " +
      "row holding that token. A shape schema could assert length and charset, which changes nothing about " +
      "which rows match; the database is the validator and a wrong token is already a 404.",
  },
  {
    file: "apps/web/src/app/api/alerts/unsubscribe/route.ts",
    handler: "POST",
    why:
      "Same opaque token as the GET above, plus the RFC 8058 one-click body. The `req.text()` read is " +
      "handed straight to `URLSearchParams`, so the body is never trusted as structure — one field is " +
      "pulled out of it by name and everything else is discarded. Mail providers post this with no session " +
      "and no Origin; the token remains the whole credential.",
  },
  {
    file: "apps/web/src/app/api/alerts/telegram/route.ts",
    handler: "POST",
    why:
      "The body is cast rather than parsed, and the cast sits BELOW the authentication boundary: the " +
      "constant-time webhook-secret check returns 401 before req.json() is reached, so an unauthenticated " +
      "caller never gets a body read at all. Of the cast object exactly two fields are touched, both " +
      "narrowed at the point of use — `message.text` by /^\\/start\\s+(\\S+)$/, which IS the schema for the " +
      "only field that carries authority, and `message.chat.id`, which becomes a bind parameter in an " +
      "update whose RLS policy re-checks the link token against the row. Residual nit, stated not hidden: " +
      'String(chatId) on a non-primitive would store "[object Object]" as a destination, reachable only ' +
      "by a caller already holding TELEGRAM_WEBHOOK_SECRET.",
  },
  {
    file: "apps/web/src/app/api/me/channels/route.ts",
    handler: "POST",
    why:
      "One field is read from the body — `action` — and it is compared for equality against the literal " +
      '"link-telegram", with a 400 otherwise. That is a stricter constraint than a Zod enum of one member, ' +
      "not a looser one. The `as { action?: string }` is a type assertion for the reader; nothing in the " +
      "body reaches a query. The PATCH in the same file parses properly, which is the shape to copy when " +
      "this handler grows a second action.",
  },
  {
    file: "apps/web/src/app/api/screener/[preset]/route.ts",
    handler: "GET",
    why:
      "The `preset` path segment is narrowed by `isScreenerPreset`, a type guard over the keys of the " +
      "SCREENER_PRESETS record, and a miss is a 404 before the value is used for anything. That is " +
      "STRICTER than a Zod string schema and it cannot drift from the presets it guards, because it is " +
      "derived from them. The value never reaches a query: what reaches queryTrades is the preset OBJECT " +
      "this repo wrote, and the caller's own filters, which do go through tradesQuerySchema.parse. Flagged " +
      "only because the gate looks for Zod specifically; a reviewer, not the regex, established this.",
  },
  {
    file: "apps/web/src/app/api/rss/[screen]/route.ts",
    handler: "GET",
    why:
      "Identical shape to the screener route above — `screen` is narrowed by the same `isScreenerPreset` " +
      "type guard and 404s on a miss. It is echoed into the feed title, where `buildRssFeed` puts it " +
      "through `escapeXml`, so the one place the raw string reaches output is escaped at the point of use.",
  },
  {
    file: "apps/web/src/app/api/rss/politicians/route.ts",
    handler: "GET",
    why:
      "Every query value that SELECTS rows goes through politiciansQuerySchema.parse. The unnarrowed read " +
      'is `url.search`, appended verbatim to the feed\'s <atom:link rel="self"> href so the self-link ' +
      "matches the URL the reader subscribed to — a schema cannot help there, because the point is to " +
      "reproduce the caller's string rather than a normalised one. It reaches output through " +
      "`escapeXml(selfUrl)` in buildPoliticianRssFeed, and it reaches nothing else.",
  },
];

/** Next.js recognises exactly these as route handlers. */
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/**
 * Every filename Next.js will route, not just the one this tree happens
 * to use. The walker used to compare `entry === "route.ts"`, so a
 * `route.tsx` reading an unvalidated query parameter was not "unparsed"
 * — it was never opened, counted nowhere, and both the empty-directory
 * guard and the zero-handler guard stayed silent about a file the
 * framework was serving.
 */
const ROUTE_FILE = /^route\.(?:m|c)?[jt]sx?$/;

/**
 * A Zod parse only counts when the file actually imports Zod (or a
 * module named `…schemas`, which is how the shared schemas arrive
 * without `z` itself being in scope). Matched against the RAW source
 * because `maskLiterals` blanks string contents, and the module
 * specifier is a string.
 */
const ZOD_IMPORT = /\bfrom\s*["'](?:zod|[^"']*schemas?)["']/i;

/**
 * Blank out comment and string-literal CONTENT, preserving every offset so
 * line numbers survive.
 *
 * This is not fussiness. Brace counting is how handler bodies get
 * delimited, and app/api is full of braces that are not code: the SSE
 * route sends `data: {"reconnect":true}` inside a template, the
 * unsubscribe route builds an HTML page out of nested `${ok ? … : …}`
 * substitutions, and half the schemas hold regex quantifiers like `{36}`.
 * Counting raw braces walks straight off the end of the first handler and
 * swallows the rest of the file — which fails SILENTLY, as a pass.
 *
 * Template substitutions are deliberately left as code: the expression
 * inside `${…}` is real code that can itself call `.parse()`, and its
 * braces balance, so counting is unaffected either way.
 */
function maskLiterals(source) {
  const out = Array.from(source);
  const n = source.length;
  const stack = [{ mode: "code", depth: 0, subst: false }];
  const blank = (k) => {
    if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
  };
  // The previous significant character, which is the only way to tell a
  // regex literal from a division: `/` after `(`, `,` or `=` opens a regex,
  // `/` after an identifier or `)` divides.
  let prev = "";
  let i = 0;

  while (i < n) {
    const top = stack[stack.length - 1];
    const c = source[i];
    const d = source[i + 1];

    if (top.mode === "code") {
      if (c === "/" && d === "/") {
        while (i < n && source[i] !== "\n") blank(i++);
        continue;
      }
      if (c === "/" && d === "*") {
        const end = source.indexOf("*/", i + 2);
        const stop = end < 0 ? n : end + 2;
        while (i < stop) blank(i++);
        continue;
      }
      if (c === '"' || c === "'") {
        stack.push({ mode: "string", quote: c });
        i++;
        continue;
      }
      if (c === "`") {
        stack.push({ mode: "template" });
        i++;
        continue;
      }
      if (c === "/" && (prev === "" || /[(,=:[!&|?{};+\-*%~^<>]/.test(prev))) {
        stack.push({ mode: "regex", charClass: false });
        i++;
        continue;
      }
      if (c === "{") top.depth++;
      else if (c === "}") {
        // Depth 0 inside a `${ … }` substitution means this brace closes it.
        if (top.depth === 0 && top.subst) {
          stack.pop();
          prev = "}";
          i++;
          continue;
        }
        top.depth--;
      }
      if (!/\s/.test(c)) prev = c;
      i++;
      continue;
    }

    if (top.mode === "string") {
      if (c === "\\") {
        blank(i);
        blank(i + 1);
        i += 2;
        continue;
      }
      if (c === top.quote) {
        stack.pop();
        prev = c;
        i++;
        continue;
      }
      blank(i);
      i++;
      continue;
    }

    if (top.mode === "template") {
      if (c === "\\") {
        blank(i);
        blank(i + 1);
        i += 2;
        continue;
      }
      if (c === "`") {
        stack.pop();
        prev = c;
        i++;
        continue;
      }
      if (c === "$" && d === "{") {
        stack.push({ mode: "code", depth: 0, subst: true });
        prev = "{";
        i += 2;
        continue;
      }
      blank(i);
      i++;
      continue;
    }

    // regex
    if (c === "\\") {
      blank(i);
      blank(i + 1);
      i += 2;
      continue;
    }
    if (c === "\n") {
      // Unterminated: it was a division after all. Bail out rather than
      // eat the rest of the file.
      stack.pop();
      i++;
      continue;
    }
    if (c === "[") top.charClass = true;
    else if (c === "]") top.charClass = false;
    else if (c === "/" && !top.charClass) {
      stack.pop();
      blank(i);
      prev = "/";
      i++;
      continue;
    }
    blank(i);
    i++;
  }
  return out.join("");
}

/** Index of the delimiter matching the one at `start`, or -1. */
function matchDelimiter(masked, start, open, close) {
  let depth = 0;
  for (let i = start; i < masked.length; i++) {
    if (masked[i] === open) depth++;
    else if (masked[i] === close && --depth === 0) return i;
  }
  return -1;
}

/**
 * The body of a function, given the index just past its parameter list.
 *
 * Three shapes, and the second is why this is not just "find the next
 * `{`". A concise arrow — `const page = (ok) => \`<html>…\`` — has no
 * block at all, and the first `{` after it belongs to a `${…}`
 * substitution inside the template. Slicing from there produced a "body"
 * that started in the middle of a string and ended wherever the braces
 * happened to balance.
 *
 * Angle-bracket depth is tracked so a return type such as
 * `: Promise<{ ok: boolean }>` is not mistaken for the body; the `>` of
 * `=>` is told apart from a closing angle by the `=` in front of it.
 */
function bodyRange(masked, from) {
  let angle = 0;
  let arrow = -1;
  for (let i = from; i < masked.length; i++) {
    const c = masked[i];
    if (c === "<") {
      angle++;
      continue;
    }
    if (c === ">") {
      if (masked[i - 1] === "=") {
        arrow = i + 1;
        break;
      }
      angle--;
      continue;
    }
    if (angle > 0) continue;
    if (c === "{") {
      const end = matchDelimiter(masked, i, "{", "}");
      return end < 0 ? null : { start: i, end: end + 1 };
    }
    if (c === ";") return null;
  }
  if (arrow < 0) return null;

  let i = arrow;
  while (i < masked.length && /\s/.test(masked[i])) i++;
  if (masked[i] === "{") {
    const end = matchDelimiter(masked, i, "{", "}");
    return end < 0 ? null : { start: i, end: end + 1 };
  }
  // Expression-bodied arrow: run to the `;` that ends the statement, or
  // to the end of the line if the author left it off.
  let depth = 0;
  for (let j = i; j < masked.length; j++) {
    const c = masked[j];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (depth <= 0 && (c === ";" || c === "\n")) return { start: i, end: j };
  }
  return { start: i, end: masked.length };
}

/**
 * The handler's own request binding — the name the body must use for a
 * body read to count. Anchoring on it is what keeps the ubiquitous
 * `Response.json({...})` from reading as "this handler parses a body";
 * a plain `.json(` search would mark every route in the tree as an input
 * reader and the gate would be noise.
 */
function firstParamName(masked, source, open, close) {
  const raw = source.slice(open + 1, close);
  const maskedRaw = masked.slice(open + 1, close);
  let depth = 0;
  let end = maskedRaw.length;
  for (let i = 0; i < maskedRaw.length; i++) {
    const c = maskedRaw[i];
    if ("({[<".includes(c)) depth++;
    else if (")}]>".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      end = i;
      break;
    }
  }
  const first = raw.slice(0, end).split(":")[0].trim();
  return /^[A-Za-z_$][\w$]*$/.test(first) ? first : null;
}

/** Brace depth at every offset, so module scope can be told from nested. */
function braceDepths(masked) {
  const depth = new Int32Array(masked.length);
  let d = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === "}") d--;
    depth[i] = d;
    if (c === "{") d++;
  }
  return depth;
}

const DECLARATIONS = [
  // `function name(`, `async function name(` — exported or not.
  /(?:^|[^\w$.])(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g,
  // `const name = (`, `= async (`, `= function (`, `= async function name(`.
  /(?:^|[^\w$.])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*?)?=\s*(?:async\s+)?(?:function\s*\*?\s*[\w$]*\s*)?\(/g,
];

/**
 * Every function declared at MODULE SCOPE, by name.
 *
 * Needed because "does this handler read input" was answered by looking
 * only at the handler's own braces, and extracting a shared
 * `readQuery(req)` helper as a route file grows is ordinary refactoring
 * rather than evasion. Doing it converted a flagged handler into one the
 * gate affirmatively listed as reading nothing at all.
 */
function extractLocalFunctions(source, masked) {
  const depth = braceDepths(masked);
  const out = new Map();
  for (const pattern of DECLARATIONS) {
    for (const m of masked.matchAll(pattern)) {
      const name = m[1];
      const nameAt = m.index + m[0].indexOf(name);
      if (depth[nameAt] !== 0) continue;
      const open = m.index + m[0].length - 1;
      const close = matchDelimiter(masked, open, "(", ")");
      if (close < 0) continue;
      const body = bodyRange(masked, close + 1);
      if (!body) continue;
      if (out.has(name)) continue;
      out.set(name, {
        param: firstParamName(masked, source, open, close),
        body: masked.slice(body.start, body.end),
      });
    }
  }
  return out;
}

/**
 * Every exported HTTP handler in one file, with its body text.
 *
 * All three forms Next accepts are matched — declaration, arrow const and
 * function-expression const. Only the first appears in this tree today,
 * which is exactly why the others are here: a gate that only knows the
 * shape currently in use is bypassed by writing one of the others.
 */
function extractHandlers(source, masked) {
  const handlers = [];
  const seen = new Set();
  const names = HTTP_METHODS.join("|");
  const patterns = [
    new RegExp(`export\\s+(?:async\\s+)?function\\s+(${names})\\s*\\(`, "g"),
    new RegExp(
      `export\\s+const\\s+(${names})\\s*(?::[^=]*?)?=\\s*(?:async\\s+)?(?:function\\s*\\*?\\s*[\\w$]*\\s*)?\\(`,
      "g",
    ),
  ];

  for (const pattern of patterns) {
    for (const m of masked.matchAll(pattern)) {
      const method = m[1];
      if (seen.has(method)) continue;
      const open = m.index + m[0].length - 1;
      const close = matchDelimiter(masked, open, "(", ")");
      if (close < 0) continue;
      const body = bodyRange(masked, close + 1);
      if (!body) continue;
      seen.add(method);
      handlers.push({
        method,
        line: source.slice(0, m.index).split(/\r?\n/).length,
        req: firstParamName(masked, source, open, close),
        params: masked.slice(open + 1, close),
        body: masked.slice(body.start, body.end),
      });
    }
  }
  return handlers;
}

/**
 * Handler names the file EXPORTS, however it spells the export.
 *
 * The completeness net, and it exists because the old one had a hole with
 * a specific shape. A file the extractor could not read at all failed
 * loudly, which was right — but the guard fired only when a file yielded
 * ZERO handlers. `export async function GET` beside
 * `async function del(...)` + `export { del as DELETE }` yielded one, so
 * the net disarmed itself and the DELETE was not mentioned in any bucket:
 * not validated, not flagged, not even listed as reading nothing. One
 * conventional handler was enough to hide every unconventional sibling.
 *
 * Comparing this set against what the extractor actually parsed turns
 * "the gate cannot read this handler" into a per-handler failure.
 */
function declaredHandlerExports(masked) {
  const declared = new Set();
  const add = (name) => {
    if (HTTP_METHODS.includes(name)) declared.add(name);
  };
  for (const m of masked.matchAll(/export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) {
    add(m[1]);
  }
  for (const m of masked.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of masked.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const piece of m[1].split(",")) {
      const parts = piece.trim().split(/\s+as\s+/);
      add((parts[parts.length - 1] ?? "").trim());
    }
  }
  return declared;
}

/**
 * The root identifier of the expression a `.parse(` was called on.
 *
 * Walks backwards through a member/call chain: `z.string().uuid()` and
 * `z.object({…})` both answer `z`, `tradesQuerySchema` answers itself,
 * and `qs`/`JSON` answer themselves too — which is the point, because
 * those are the ones that must NOT count.
 */
function receiverRoot(text, dotIndex) {
  let i = dotIndex - 1;
  const skipSpace = () => {
    while (i >= 0 && /\s/.test(text[i])) i--;
  };
  skipSpace();
  for (;;) {
    if (i < 0) return null;
    const c = text[i];
    if (c === ")" || c === "]") {
      const open = c === ")" ? "(" : "[";
      let depth = 0;
      while (i >= 0) {
        if (text[i] === c) depth++;
        else if (text[i] === open && --depth === 0) break;
        i--;
      }
      if (i < 0) return null;
      i--;
      skipSpace();
      continue;
    }
    if (/[\w$]/.test(c)) {
      const end = i;
      while (i >= 0 && /[\w$]/.test(text[i])) i--;
      const ident = text.slice(i + 1, end + 1);
      skipSpace();
      if (i >= 0 && text[i] === ".") {
        i--;
        skipSpace();
        continue;
      }
      return ident;
    }
    return null;
  }
}

/**
 * Identifiers this file binds to a Zod expression — `const q = z.object(…)`.
 *
 * Without this the receiver check below would only accept `z.…` and names
 * ending in `Schema`, so a locally-built schema with a short name would
 * read as "not Zod" and its handler would be flagged for validating
 * properly. Naming is a style, and a gate that enforces one is a gate
 * people route around.
 */
function zodBoundNames(masked) {
  const names = new Set();
  for (const m of masked.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*z\s*\./g,
  )) {
    names.add(m[1]);
  }
  return names;
}

/** `[start, end]` of the argument list of every genuine Zod parse call. */
function zodParseSpans(body, zodImported, schemaNames) {
  if (!zodImported) return [];
  const spans = [];
  for (const m of body.matchAll(/\.\s*(safeParseAsync|safeParse|parseAsync|parse)\s*\(/g)) {
    const root = receiverRoot(body, m.index);
    if (root !== "z" && !/[Ss]chemas?$/.test(root ?? "") && !schemaNames.has(root)) continue;
    const open = m.index + m[0].length - 1;
    const close = matchDelimiter(body, open, "(", ")");
    if (close < 0) continue;
    spans.push([open, close]);
  }
  return spans;
}

/**
 * The names a read site is bound to, so `const kind = sp.get("kind")`
 * can be followed to wherever `kind` is parsed — or shown never to be.
 * Scans back only to the nearest statement boundary; a read that is not
 * bound to anything (used inline in a comparison, passed straight to a
 * call) yields none, and is judged on the read site's own position.
 */
const DECLARED_NAME =
  /\b(?:const|let|var)\s+(\{[^}]*\}|\[[^\]]*\]|[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=/g;

function bindingsAt(body, index) {
  let start = index;
  while (start > 0 && !";{}".includes(body[start - 1])) start--;
  const prefix = body.slice(start, index);
  let last = null;
  for (const m of prefix.matchAll(DECLARED_NAME)) last = m[1];
  if (!last) return [];
  if (/^[A-Za-z_$][\w$]*$/.test(last)) return [last];
  // Destructuring: the BOUND name is what matters, so `{ a: b }` yields b.
  return last
    .slice(1, -1)
    .split(",")
    .map((piece) => {
      const bound = piece.includes(":") ? piece.slice(piece.indexOf(":") + 1) : piece;
      return bound
        .replace(/\.\.\./, "")
        .split("=")[0]
        .trim();
    })
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

const QUERY_READ =
  /\bsearchParamsToObject\s*\(|\bURLSearchParams\b|\bsearchParams\b|\.\s*search\b/g;
const BODY_READ = "(?:json|text|formData|arrayBuffer|blob|bytes)\\s*\\(|body\\b";

/**
 * Analyse one route file. Pure: `name` is only used to decide whether the
 * route is dynamic and to look up allowlist entries, so the self-test can
 * hand it a source string with no file behind it.
 */
function analyzeSource(name, source) {
  const masked = maskLiterals(source);
  const handlers = extractHandlers(source, masked);
  const locals = extractLocalFunctions(source, masked);
  const declared = declaredHandlerExports(masked);
  const zodImported = ZOD_IMPORT.test(source);
  const schemaNames = zodBoundNames(masked);
  const isDynamic = /\[[^\]]+\]/.test(name);

  const unreadable = [...declared].filter((method) => !handlers.some((h) => h.method === method));
  const results = [];

  for (const h of handlers) {
    // Follow same-file helpers. The request BINDING is followed with the
    // call: a helper is only treated as reading the request when the
    // handler actually passes its own request into the first parameter,
    // so `serializeTrade(row)` cannot make `row.json()` look like a body
    // read while `readBody(request)` can.
    const requestNames = new Set(h.req ? [h.req] : []);
    let effective = h.body;
    const inlined = new Set();
    for (let round = 0; round < 8; round++) {
      let grew = false;
      for (const alias of effective.matchAll(
        /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*[;,\n]/g,
      )) {
        if (requestNames.has(alias[2]) && !requestNames.has(alias[1])) {
          requestNames.add(alias[1]);
          grew = true;
        }
      }
      for (const call of effective.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)?/g)) {
        const local = locals.get(call[1]);
        if (!local) continue;
        if (requestNames.has(call[2] ?? "") && local.param && !requestNames.has(local.param)) {
          requestNames.add(local.param);
          grew = true;
        }
        if (inlined.has(call[1])) continue;
        inlined.add(call[1]);
        // `\n;\n` so a statement in the handler and one in the helper can
        // never be read as the same statement by `bindingsAt`.
        effective += `\n;\n${local.body}`;
        grew = true;
      }
      if (!grew) break;
    }

    const sites = [];
    for (const m of effective.matchAll(QUERY_READ)) sites.push({ index: m.index, source: "query" });
    for (const req of requestNames) {
      const pattern = new RegExp(`\\b${req}\\s*\\.\\s*(?:${BODY_READ})`, "g");
      for (const m of effective.matchAll(pattern)) {
        sites.push({ index: m.index, source: "the request body" });
      }
    }
    // A dynamic segment is only an input if the handler reaches for it;
    // a handler that ignores `params` has nothing to narrow.
    if (isDynamic) {
      for (const m of effective.matchAll(/\bparams\b/g)) {
        sites.push({ index: m.index, source: "a dynamic path param" });
      }
    }

    const spans = zodParseSpans(effective, zodImported, schemaNames);
    const inSpan = (i) => spans.some(([a, b]) => i > a && i < b);
    const unnarrowed = new Set();
    for (const site of sites) {
      if (inSpan(site.index)) continue;
      const names = bindingsAt(effective, site.index);
      const reaches = names.some((n) =>
        spans.some(([a, b]) => new RegExp(`\\b${n}\\b`).test(effective.slice(a, b))),
      );
      if (!reaches) unnarrowed.add(site.source);
    }

    results.push({
      method: h.method,
      line: h.line,
      readsInput: sites.length > 0,
      unnarrowed: [...unnarrowed],
    });
  }

  return { handlers: results, unreadable };
}

/**
 * The allowlist's own gate. `why` used never to be read by anything, so
 * an entry could silence a handler while asserting nothing — and the
 * summary would then report it as "justified".
 */
function validateAllowlist(entries) {
  const problems = [];
  const seen = new Set();
  for (const entry of entries) {
    const id = `${entry.file}:${entry.handler}`;
    if (!entry.file || !HTTP_METHODS.includes(entry.handler)) {
      problems.push(`${id} — file and handler are required, and handler must be an HTTP method`);
      continue;
    }
    if (seen.has(id)) problems.push(`${id} — duplicate entry`);
    seen.add(id);
    // 40 characters is "a sentence", not "ok" or "n/a". The number is
    // arbitrary; having one is not.
    if (typeof entry.why !== "string" || entry.why.trim().length < 40) {
      problems.push(`${id} — 'why' must be a written reason of at least 40 characters`);
    }
  }
  return problems;
}

// ── The gate's own tests ───────────────────────────────────────────────
//
// Every case is a shape that got past an earlier version of this file, or
// a control that must keep passing so a case cannot be satisfied by the
// gate simply flagging everything.
//
// An expectation is either `"none"` — the handler reads no query, body or
// path input — or the list of input sources it reads and does NOT narrow.
// `[]` therefore means "reads input and parses all of it", which is a
// different claim from "none" and lands in a different summary bucket;
// conflating the two is how a missed read gets announced as an absence.

const SELF_TEST = [
  {
    name: "control: query read, parsed",
    file: "app/api/probe/route.ts",
    source: `import { z } from "zod";
      const q = z.object({ kind: z.string() });
      export async function GET(req: Request) {
        const { kind } = q.parse(Object.fromEntries(new URL(req.url).searchParams));
        return Response.json({ kind });
      }`,
    expect: { GET: [] },
  },
  {
    name: "control: dynamic path param, parsed",
    file: "app/api/probe/[id]/route.ts",
    source: `import { uuidParamSchema } from "@/lib/api/schemas";
      export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
        const id = uuidParamSchema.parse((await params).id);
        return Response.json({ id });
      }`,
    expect: { GET: [] },
  },
  {
    name: "control: reads nothing",
    file: "app/api/probe/route.ts",
    source: `export async function GET() { return Response.json({ ok: true }); }`,
    expect: { GET: "none" },
  },
  {
    name: "p4a: helper declared inside the handler",
    file: "app/api/probe/route.ts",
    source: `export async function GET(request: Request) {
        const read = () => new URL(request.url).searchParams.get("x");
        return Response.json({ x: read() });
      }`,
    expect: { GET: ["query"] },
  },
  {
    name: "p4b: helpers at module scope, called by the handler",
    file: "app/api/probe/route.ts",
    source: `function readQuery(r: Request) { return new URL(r.url).searchParams.get("x"); }
      async function readBody(r: Request) { return r.json(); }
      export async function GET(request: Request) { return Response.json({ x: readQuery(request) }); }
      export async function POST(request: Request) { return Response.json(await readBody(request)); }`,
    expect: { GET: ["query"], POST: ["the request body"] },
  },
  {
    name: "p4b-control: a module helper the handler does NOT hand its request to",
    file: "app/api/probe/route.ts",
    source: `function serialize(row: { id: string }) { return { id: row.id }; }
      export async function GET(request: Request) { return Response.json(serialize({ id: "1" })); }`,
    expect: { GET: "none" },
  },
  {
    name: "p5a: destructured searchParams under another name",
    file: "app/api/probe/route.ts",
    source: `export async function GET(request: Request) {
        const { searchParams: sp } = new URL(request.url);
        return Response.json({ x: sp.get("x") });
      }`,
    expect: { GET: ["query"] },
  },
  {
    name: "p5b: the query read that never types the token searchParams",
    file: "app/api/probe/route.ts",
    source: `export async function GET(request: Request) {
        const qs = new URLSearchParams(new URL(request.url).search);
        return Response.json({ kind: qs.get("kind") });
      }`,
    expect: { GET: ["query"] },
  },
  {
    name: "p6: the request under an alias",
    file: "app/api/probe/route.ts",
    source: `export async function POST(request: Request) {
        const incoming = request;
        const body = await incoming.json();
        return Response.json(body);
      }`,
    expect: { POST: ["the request body"] },
  },
  {
    name: "p20: a body method the alternation forgot",
    file: "app/api/probe/route.ts",
    source: `export async function POST(request: Request) {
        const raw = await request.bytes();
        return new Response(raw);
      }`,
    expect: { POST: ["the request body"] },
  },
  {
    name: "p9: one value parsed, its sibling used raw",
    file: "app/api/probe/route.ts",
    source: `import { z } from "zod";
      export async function DELETE(request: Request) {
        const url = new URL(request.url);
        const kind = url.searchParams.get("kind");
        const refId = z.string().min(1).max(64).safeParse(url.searchParams.get("refId"));
        return Response.json({ kind, refId: refId.success });
      }`,
    expect: { DELETE: ["query"] },
  },
  {
    name: "p10: an identifier that merely ends in Schema",
    file: "app/api/probe/route.ts",
    source: `const columnSchema = { ticker: "ticker" } as const;
      export async function GET(request: Request) {
        const kind = new URL(request.url).searchParams.get("kind");
        return Response.json({ column: columnSchema, kind });
      }`,
    expect: { GET: ["query"] },
  },
  {
    name: "p11: a .parse( that is not Zod's",
    file: "app/api/probe/route.ts",
    source: `import qs from "qs";
      export async function GET(request: Request) {
        const parsed = qs.parse(new URL(request.url).searchParams.toString());
        return Response.json(parsed);
      }`,
    expect: { GET: ["query"] },
  },
  {
    name: "p13: headers only — out of scope, and must be reported as such",
    file: "app/api/probe/route.ts",
    source: `export async function GET(request: Request) {
        return Response.json({ ua: request.headers.get("user-agent") });
      }`,
    expect: { GET: "none" },
  },
  {
    name: "p7: handlers exported by rename",
    file: "app/api/probe/route.ts",
    source: `async function getHandler(request: Request) { return Response.json({}); }
      export { getHandler as GET };`,
    expect: {},
    unreadable: ["GET"],
  },
  {
    name: "p14: one readable handler must not disarm the net for its siblings",
    file: "app/api/probe/route.ts",
    source: `export async function GET() { return Response.json({ ok: true }); }
      async function del(request: Request) {
        return Response.json({ kind: new URL(request.url).searchParams.get("kind") });
      }
      export { del as DELETE };`,
    expect: { GET: "none" },
    unreadable: ["DELETE"],
  },
  {
    name: "p17: a handler wrapped in a higher-order function",
    file: "app/api/probe/route.ts",
    source: `import { withAuth } from "@/lib/auth";
      export const GET = withAuth(async (req: Request) => Response.json({ ok: true }));`,
    expect: {},
    unreadable: ["GET"],
  },
  {
    name: "p19: a function expression assigned to the export",
    file: "app/api/probe/route.ts",
    source: `export const GET = async function (request: Request) {
        return Response.json({ x: new URL(request.url).searchParams.get("x") });
      };`,
    expect: { GET: ["query"] },
  },
  {
    name: "a concise arrow helper whose template contains braces",
    file: "app/api/probe/route.ts",
    source: `const page = (ok: boolean): string => \`<html>\${ok ? "yes" : "no"}</html>\`;
      export async function GET() { return new Response(page(true)); }`,
    expect: { GET: "none" },
  },
];

/**
 * Filenames Next.js routes, and ones it does not. `route.tsx` is the case
 * that mattered: the walker matched `entry === "route.ts"`, so a .tsx
 * route reading an unvalidated query parameter was never opened.
 */
const FILENAME_CASES = [
  ["route.ts", true],
  ["route.tsx", true],
  ["route.js", true],
  ["route.jsx", true],
  ["route.mjs", true],
  ["route.cjs", true],
  ["route.mts", true],
  ["route.test.ts", false],
  ["not-route.ts", false],
  ["route.txt", false],
  ["router.ts", false],
];

/** The allowlist validator, against the three ways `why` was defeatable. */
const ALLOWLIST_CASES = [
  [[{ file: "a/route.ts", handler: "GET" }], true],
  [[{ file: "a/route.ts", handler: "GET", why: "" }], true],
  [[{ file: "a/route.ts", handler: "GET", why: "   " }], true],
  [[{ file: "a/route.ts", handler: "GET", why: "fine" }], true],
  [[{ file: "a/route.ts", handler: "get", why: "x".repeat(60) }], true],
  [
    [
      { file: "a/route.ts", handler: "GET", why: "x".repeat(60) },
      { file: "a/route.ts", handler: "GET", why: "y".repeat(60) },
    ],
    true,
  ],
  [[{ file: "a/route.ts", handler: "GET", why: "x".repeat(60) }], false],
];

function runSelfTest() {
  const failures = [];

  for (const [filename, routed] of FILENAME_CASES) {
    if (ROUTE_FILE.test(filename) !== routed) {
      failures.push(`filename ${filename}: routed=${!routed}, expected ${routed}`);
    }
  }

  for (const [entries, shouldFail] of ALLOWLIST_CASES) {
    const problems = validateAllowlist(entries);
    if (problems.length > 0 !== shouldFail) {
      failures.push(
        `allowlist ${JSON.stringify(entries)}: ${problems.length} problems, expected ` +
          `${shouldFail ? "at least one" : "none"}`,
      );
    }
  }

  for (const probe of SELF_TEST) {
    const { handlers, unreadable } = analyzeSource(probe.file, probe.source);
    const expectedUnreadable = probe.unreadable ?? [];
    if (unreadable.sort().join(",") !== expectedUnreadable.sort().join(",")) {
      failures.push(
        `${probe.name}: unreadable handlers [${unreadable}] , expected [${expectedUnreadable}]`,
      );
    }
    for (const [method, expected] of Object.entries(probe.expect)) {
      const got = handlers.find((h) => h.method === method);
      if (!got) {
        failures.push(`${probe.name}: ${method} was not extracted at all`);
        continue;
      }
      if (expected === "none") {
        if (got.readsInput) {
          failures.push(
            `${probe.name}: ${method} was expected to read nothing, but reads input ` +
              `(unnarrowed: [${got.unnarrowed}])`,
          );
        }
        continue;
      }
      if (!got.readsInput) {
        failures.push(`${probe.name}: ${method} reads no input, expected it to read some`);
        continue;
      }
      if (got.unnarrowed.sort().join(",") !== [...expected].sort().join(",")) {
        failures.push(
          `${probe.name}: ${method} unnarrowed [${got.unnarrowed}], expected [${expected}]`,
        );
      }
    }
    const extra = handlers.filter((h) => !(h.method in probe.expect));
    if (extra.length) {
      failures.push(`${probe.name}: unexpected handlers extracted: ${extra.map((h) => h.method)}`);
    }
  }
  return failures;
}

// ── Run ────────────────────────────────────────────────────────────────

const selfTestFailures = runSelfTest();
if (selfTestFailures.length) {
  console.error("api schemas: THE GATE ITSELF IS BROKEN — its own probes disagree with it\n");
  for (const failure of selfTestFailures) console.error(`  ${failure}`);
  console.error(
    "\nEvery probe in SELF_TEST is a shape that once got past this file. A failure here\n" +
      "means the analysis changed; fix the analysis, or change the probe and say why.",
  );
  process.exit(1);
}

const allowlistProblems = validateAllowlist(ALLOWLIST);
if (allowlistProblems.length) {
  console.error("api schemas: the ALLOWLIST is not a justification, it is a list of names\n");
  for (const problem of allowlistProblems) console.error(`  ${problem}`);
  console.error(
    "\nAn entry silences a real finding. The sentence in `why` is the whole price of\n" +
      "doing that, and it is what a reviewer refuses or accepts.",
  );
  process.exit(1);
}

const files = [];
(function walk(current) {
  for (const entry of readdirSync(current)) {
    const full = join(current, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (ROUTE_FILE.test(entry)) files.push(full);
  }
})(dir);

// A gate that finds nothing because it looked nowhere is worse than no
// gate: it reports success. If the route directory moves, say so loudly.
if (files.length === 0) {
  console.error(`api schemas: no route files under ${relative(root, dir)} — has the app moved?`);
  process.exit(1);
}

const findings = [];
const noInput = [];
const validated = [];
const used = new Set();

for (const file of files.sort()) {
  const name = relative(root, file).replace(/\\/g, "/");
  const { handlers, unreadable } = analyzeSource(name, readFileSync(file, "utf8"));

  for (const method of unreadable) {
    findings.push({
      file: name,
      line: 1,
      label: `${method} is exported but the extractor could not read it — it was checked by nothing`,
    });
  }

  // Next requires at least one handler per route file. Zero means either
  // an unrouted file or a broken extractor, and a broken extractor passes
  // everything.
  if (handlers.length === 0 && unreadable.length === 0) {
    findings.push({
      file: name,
      line: 1,
      label: "no exported handler found — the extractor could not read this file",
    });
    continue;
  }

  for (const h of handlers) {
    const id = `${name}:${h.method}`;
    if (!h.readsInput) {
      noInput.push(`${name.replace(/^apps\/web\/src\/app/, "")} ${h.method}`);
      continue;
    }
    if (h.unnarrowed.length === 0) {
      validated.push(id);
      continue;
    }
    if (ALLOWLIST.some((a) => a.file === name && a.handler === h.method)) {
      used.add(id);
      continue;
    }
    findings.push({
      file: name,
      line: h.line,
      label: `${h.method} reads ${h.unnarrowed.join(" + ")} and uses it without a Zod parse`,
    });
  }
}

// A justification that no longer applies is not harmless: it is a claim
// about code that has moved on, and the next reader takes it as current.
// This used to be a line appended to the SUCCESS message, which meant the
// nag landed inside a green step and nothing ever removed one — the
// watchlist entry argued for its own preservation ("the stale-allowance
// line below will nag until someone does") and nothing ever forced it.
//
// Reported alongside findings rather than instead of them: a run that
// fixes one handler and breaks another must show both, or the second
// arrives as a surprise after the first is dealt with.
const stale = ALLOWLIST.filter((a) => !used.has(`${a.file}:${a.handler}`));
if (stale.length) {
  console.error("api schemas: ALLOWLIST entries that no longer describe anything\n");
  for (const entry of stale) console.error(`  ${entry.file} ${entry.handler}`);
  console.error(
    "\nThe handler either stopped reading input, started parsing it, was renamed, or was\n" +
      "deleted. Whichever it was, delete the entry — an argument for code that is not\n" +
      "there any more reads as an argument for the code that replaced it.\n",
  );
}

if (findings.length) {
  console.error(
    `api schemas: ${findings.length === 1 ? "1 handler reads" : `${findings.length} handlers read`} input without validating it\n`,
  );
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.label}`);
  }
  console.error(
    "\nA handler that reads a value before narrowing it hands the shape decision to\n" +
      "whatever it calls next — the database, a cast, a template. Parse it with a Zod\n" +
      "schema (lib/api/schemas.ts already covers the trade/company/politician query\n" +
      "surface) — or, if the value genuinely needs no schema, add an entry to\n" +
      "ALLOWLIST in scripts/lint-api-schemas.mjs with the reason.",
  );
}

if (findings.length || stale.length) process.exit(1);

const handlerCount = validated.length + noInput.length + used.size;
console.log(
  `api schemas ok — ${files.length} route files, ${handlerCount} handlers, ` +
    `${SELF_TEST.length + FILENAME_CASES.length + ALLOWLIST_CASES.length} self-tests\n` +
    `  ${validated.length} narrow every value they read through Zod\n` +
    `  ${noInput.length} read no query, body or path input, so there is nothing here to ` +
    `validate (headers and cookies are out of scope): ${noInput.join(", ")}\n` +
    `  ${used.size} read input without Zod and are justified in ALLOWLIST`,
);
