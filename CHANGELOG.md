# Changelog

All notable changes to InsiderFlow. Newest first.

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
