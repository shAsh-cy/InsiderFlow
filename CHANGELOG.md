# Changelog

All notable changes to InsiderFlow. Newest first.

## r3 — one left edge, a nav that tells the truth, and a tape you can work

### Tokens ratified

`--text-muted` is now canonical at `#808881` (dark) and `#626E7A` (light).
The r2 spec named darker tones; both fail WCAG AA for the small text they
carry, and `/design` publishes the full measurement table for all four
grounds in both themes, spec values included, so the next person to reach for
the darker tone can see exactly what it costs.

### The left edge, everywhere

r2 left-anchored the landing, `/trades` and `/screener`. Everything else was
still centred, which meant the product had two layouts and its left edge
moved when you navigated between them — the exact failure r2 set out to fix,
preserved on eleven routes.

The shell is full-bleed and the content well is left-anchored inside it. A
readability limit survives (~78rem, 60–68rem on the prose pages) but is a
right-hand trim: `margin-inline: auto` is gone from every app page, and
`.shell-measure` writes the asymmetry out explicitly so its absence cannot
read as an oversight. Centring survives only on `/login` and inside true
empty states.

Three tokens carry it: `--shell-gutter` (24px, 36px at `lg`),
`--shell-sidebar` and `--shell-rail-inset`.

The rail motif needed rework to survive. `.rail` indents the text it marks by
its own padding, so a railed page heading sat 20px right of the cards beneath
it — the rail won and the left edge lost. `.rail-bleed` hangs the rule out
into the gutter, and its negative margin includes the 2px rule itself so the
_content_ box lands on exactly the same x as an unrailed sibling.
Off-by-the-border is the quietest way a one-edge system stops having one.

`/status`, `/legal` and `/docs/methodology` also gain a `<main id="main">`.
They had none, so the skip-to-content link pointed at nothing.

`e2e/layout.spec.ts` is the guard: it measures the gutter through a live
probe, walks every ancestor of the content region looking for resurrected
auto-margins, and asserts every top-level block on fifteen routes sits on one
x — measuring margin boxes, so the hanging rail is judged by where it was
placed rather than by how far its rule reaches back.

### Nav truth

**The brand.** A 4px accent rule sat beside the wordmark, visually identical
to the rule the sidebar draws down the current page. It was reported as a
highlight stuck on, and that reading was correct: one mark meant two things.
The mark is now a bordered square holding a tape line — enclosed and
horizontally symmetric, where every state marker in this product is an open
vertical rule or an underline. A test asserts it never carries `aria-current`
and never grows a left border again.

**Active state.** Exact matching lit nothing on `/politicians/42`; naive
prefix matching lights both `/docs` and `/docs/methodology`, and
`aria-current` on two links is a lie a screen reader repeats aloud.
`activeNavHref()` matches on a path _segment_ boundary and keeps the longest
hit, and returns null where nothing owns the route — a stock page belongs to
no section, and marking the nearest one would be a guess presented as a fact.
The sidebar marker gains a tinted ground and heavier ink on top of the accent
rule.

**IA.** Design and API docs sat in the top bar _and_ in the sidebar's
Reference section — one destination reachable twice in a viewport, which is
two things to keep in sync. The top bar is now brand, search, language,
theme, Settings and sign-in/account. `/docs` and `/docs/methodology` move
into the shell: they were listed in the sidebar but rendered without it, so
following the index dropped you out of the product.

### The tape

**Arrival flash.** A row that just streamed in fades its value cell in the
direction's own tint — buy or sell, 12% for 600ms, background only.
Deliberately not the accent, which means "actionable" everywhere else: a
green flash on a sale would say the opposite of what happened. It costs no
React state; `LiveFeedRow` is the only component that renders for an SSE
arrival, so it carries the class and CSS does the rest.

**Quick actions.** Star to track, bell to alert. Signed out, neither is
refused: the click remembers what you meant, opens the contextual sign-in and
replays once the session exists. The intent travels in sessionStorage, not
the query string — a redirect that rewrites the reader's URL with a ticker is
one they did not ask for. The replay lives at the root layout, because the
auth callback can land anyone anywhere.

Hover reveals the actions where hover exists; where it does not they are
simply always there. A hover-revealed control on a touchscreen appears on the
tap meant to activate it.

**Keyboard.** One tab stop for the whole tape, then ↑/↓ walk it, Enter opens
the company, `w` tracks it. Thirty tab stops is how a keyboard user gets
trapped in a feed they only wanted to pass. Real DOM focus rather than
`aria-activedescendant`, so `:focus-visible` draws the same ring as
everywhere else. `?` opens a sheet documenting the keys — and the sheet has a
visible button too, because a convention you must already know is not
discoverability.

Row component prop signatures are unchanged: the hooks are DOM attributes
from `tapeRowProps()`, which is what lets the landing strip, the live fold
and the virtualized history all be navigable without knowing about each
other. 10k-row scroll re-measured at 60fps.

### Loading and empty

Spinners are gone from the two places rows arrive. A row skeleton says what
is coming and holds the space for it; the placeholder height is asserted
against a real row, because a skeleton of the wrong height is a layout shift
with extra steps. The shimmer is named explicitly in the reduced-motion block
rather than left to the blanket duration override.

Three empty screens had grown three layouts, which made one kind of event
read as three. `EmptyState` is an icon, one sentence and at most one action,
adopted by watchlist, alerts and politicians — the politicians copy carried
over word for word, because "No filers ingested yet" is a claim about this
deployment's pipeline, not an invitation.

### Settings

The sheet had three settings and three different left edges for the thing you
operate. Every section is now a definition grid — name left, control right,
44px minimum row height — so the digest time has its own row instead of
floating off the end of the Email line, and the quiet-hours window is one row
with both ends on one baseline. Order: Alert channels → Alert rules → Quiet
hours → Watchlist → API. The API card is an honest placeholder: the public
API is already open at 60 req/min with no key, and self-serve key issuance
does not exist, so the card says that and offers no control.

### Freshness, honestly

"Filings today" read zero on a freshly-cloned checkout. The figure was true
and useless: the seed left `created_at` to the column default, so arrival
times were whatever `now()` was when someone last ran it. The seed now
derives arrival times relative to now — stepping back over ~30 hours, ordered
so a filing about a recent trade arrives more recently — and logs how many
land inside the window. Production behaviour is untouched.

Both the stats panel and the live tape now carry "as of &lt;time&gt;",
sourced from `max(created_at)` and from the newest row on the tape, never
from the render time. A 24-hour count is ambiguous at zero: it means either a
quiet day or a stalled pipeline. Formatted in UTC by hand, because anything
depending on the machine's timezone renders differently on server and client.

### Contrast: the tint is the ground

Lighthouse found `--sell-ink` at 4.22:1 inside a direction badge. The r2
contrast sweep had reported that page clean, and was wrong in an instructive
way: it walked _past_ any background with alpha below 0.9 and measured
against the first opaque ancestor. A direction badge sits on `--*-soft` — the
same hue as its own ink, at 10% — and on a zebra row that composites over
`--surface-sunken` too.

Against the true worst case the r2 inks were 4.31 (buy) and 4.01 (sell);
against plain white the same text read 5.49 and 5.19 and looked fine. Both
light inks darken along their own hue: `--buy-ink` `#B04A00` → `#A44500`,
`--sell-ink` `#0072B2` → `#00669F`. `--buy` and `--sell` are untouched — a
mark owes 3:1, and the palette is not distorted where identification happens.
Lighthouse flagged only the sell badge; the buy badge was the same bug one
row away and is fixed on the arithmetic, not on the report.

Contrast is now verified with axe-core, both themes, sixteen routes: zero
failures.

Also fixed: `aria-pressed` on an anchor in the politicians filter (defined
for `role="button"` only — `aria-current` is both valid and more accurate),
and the shortcut sheet's "?" glyph is `aria-hidden` so the button reads as an
icon control named by its label rather than failing WCAG 2.5.3.

### Test-suite corrections

**A security test that was not testing security.** `every /api/me route
rejects a tampered token` failed roughly one run in sixteen with "expected
401, received 200". The API had not accepted a forged JWT; the test had
failed to forge one. `tamperSignature` swapped the final base64url character
between "A" and "B" — for a 43-character signature that character carries
four significant bits plus two of _padding_, so whenever the real signature
ended in "A" the "tampered" token decoded to the original bytes and
authenticated correctly. It now flips a bit in a middle byte and throws if
the result equals the original. Verified independently of Playwright: with a
real change the route returned 401 on twenty consecutive requests; with the
old one, 200 on twenty.

**A suite that flooded its own tape.** The new loading spec inserts 34 rows
so the tape has a second page. Inserted at `now()` those rows broadcast over
SSE into every tape open in every parallel worker, evicting the row
live-stream was waiting on. They are depth, not events, so they are
backdated. Worth stating because the symptom looked alarming: the tape does
not lose streamed rows when a reconnect is refused.

**A perf test measuring the machine.** The 10k-row scroll runs in its own
Playwright project gated behind the rest, so nothing else is running when it
measures a frame budget.

### Verification

- 287 unit/integration tests; 140 Playwright e2e (was 280 / 103).
- Lighthouse desktop, fifteen routes: accessibility **100 on every one**;
  performance 99–100 except `/design` (90 — the 10k-row showcase, scoring
  0.97 LCP and 0.98 TBT on the metrics themselves).
- axe-core contrast: zero failures, sixteen routes × both themes.
- Domain-primitive prop signatures byte-identical; no raw colour values in
  components.

## r2 — “Terminal” re-theme and five corrections

### Re-theme: Ledger → Terminal

The paper-terminal palette is replaced by a trading-terminal one. **Dark is
now the default**; light (“Graphite”) is a cool grey rather than warm stock,
so the product no longer reads as a document.

The token layer is dark-first — `:root` _is_ the dark theme and `.light`
overrides it — which is why `next-themes` now emits an explicit `.light`
class. With a dark-first root, light has to be an opt-in class rather than
the absence of one, or a light-preferring visitor gets dark tokens with no
override. `defaultTheme` stays `"system"`.

The accent is racing green and means **actionable** — it never encodes
direction. Buy and sell keep the only two data colours (Wong, _Nature
Methods_ 8:441, 2011), always paired with a ▲/▼ glyph or a written label.

Two accent tokens, not one: on the dark ground the accent is 3.6:1 — fine as
a fill behind `--accent-contrast`, too low for small text — so
`--accent-bright` (6.3:1) carries type and borders. On Graphite the
relationship inverts. One green cannot be both a fill and a legible label.

Mono is now reserved for numbers, tickers, SEC codes and microtext; headings
and body are sentence-case Onest. Uppercase mono dressed as a section heading
reads as a system message rather than a sentence. Capitals stay where they
are the _data_ — SEC transaction codes, ISO country codes. 35 files changed.

Type scale, radii (4/6/8/12/full), spacing (4px grid) and shadows are all
re-specified; `/design` documents every one of them.

**Deviation from the supplied spec, and why.** `--text-muted` was given as
`#6E7873` (dark) and `#6B7885` (light). Both fail WCAG AA for the small text
they actually carry: measured 4.17:1 on `--bg` and 4.05:1 on `--surface` in
dark, 4.21:1 and 4.00:1 in light. They are now `#808881` and `#626E7A` — the
nearest tones of the same hue that clear 4.5:1 against _every_ ground in
their theme, including `--surface-sunken`, where half of every zebra-striped
table's microtext sits.

### 1 · Left-anchored editorial layout

The hero was left-aligned inside a centred container, which still reads as
centred. Headline, access promise, CTA, figures and the feature index now key
to one left edge, and the asymmetry is carried by what sits to the right of
it — the live tape, promoted from the panel below. An F-pattern reader takes
the top-left first (Nielsen Norman Group). Centring survives only where it is
correct: auth screens and true empty states.

### 2 · “All data is free to read”, said out loud

The competitor this product answers gates alerts, exports and tracked-stock
capacity behind paid tiers, so visitors arrive expecting a wall and read
“Sign in” as “pay up”.

- A dismissible one-liner on `/trades` and `/screener` for signed-out
  readers. Dismissal persists in a cookie — a banner you cannot kill is its
  own kind of paywall; a cookie (not `localStorage`) so the next server
  render respects it instead of flashing.
- Empty watchlist/alert states explain the value instead of implying a lock.
- Copy rule throughout: **save / alert / track** — never _unlock_, _upgrade_,
  _premium_ or _trial_. Full en + hi parity.

### 3 · Sign-in prominence and contextual auth

The masthead sign-in becomes the primary affordance it always was:
accent-bordered on dark, accent-filled on Graphite.

“Save as alert” is **no longer disabled** when signed out. A dead control
next to a screen the reader just built for free is exactly the “your data is
locked” signal this product must not send. Clicking offers sign-in in place
and then **replays the save** once the session exists, via `?pending=alert`
on the URL they were already on. Sending someone to `/login` and losing their
screen answers the request by throwing it away.

### 4 · Tighter tape

Columnar on one left edge — code · flag · ticker · insider — with shares and
value in fixed, right-aligned columns so scrolling scans a column of digits
rather than a ragged edge. Rows are a flat 40px.

`RelevanceBadge` is now a **dot**, not a word. A label that repeats on every
row carries no information: it is pure ink cost and it crowded out the
figures the row exists to show. The word survives in the tooltip and in
screen-reader text, and relevance remains a first-class _filter_ — which is
where the distinction actually does work. `SourceBadge` loses its chip and
becomes quiet mono microtext.

Row layout uses **container queries**, not viewport ones: the same row
renders full-width on `/trades` and inside a narrow hero column on the
landing page, and viewport breakpoints clipped the narrow case on wide
screens.

Domain-primitive prop APIs are unchanged. Column alignment rides on
TanStack's own `ColumnDef.meta`, which callers already pass.

### 5 · Restrained physical motion

Magnetic pull on primary CTAs, opt-in by `data-magnetic`, behind four hard
gates: `(hover: hover) and (pointer: fine)`, `useReducedMotion()`,
transform-only (`translate3d`), and one rAF-batched document listener with
geometry measured on enter rather than per move — `getBoundingClientRect()`
inside a mousemove handler forces a synchronous layout on every event. No
data page uses it.

### Verification

280 unit/integration and 103 Playwright e2e green (three consecutive runs).
Lighthouse desktop: `/` 100 perf / 100 a11y, `/trades` 100/100, `/screener`
99/100, `/stock` 100/96, `/heatmap` 100/100. Contrast swept across 11 routes
× both themes: zero failures. Data-honesty invariants unchanged.

Two e2e assertions were rewritten rather than deleted: both asserted that the
signed-out save control “stays disabled”, which is the contract r2
deliberately reverses. They now assert the control is live, says “save”,
never says “unlock”, and opens a keyboard-dismissible sign-in offer. The
write path is still refused without a session — covered separately and
unchanged.

---

## r1 — “Ledger” design language

Rebuilt the interface on an original paper-terminal design language,
replacing the dark-only black/neon-purple theme. See
`docs/design-language.md` and commit `985aad2`.
