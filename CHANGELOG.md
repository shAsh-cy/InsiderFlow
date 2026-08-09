# Changelog

All notable changes to InsiderFlow. Newest first.

## r5 — Layout v3, dark by default, and width that buys information

### Layout v3 — chrome pins, content is fluid

Two rounds went past each other, and the rule that stops it separates the
two things they kept treating as one.

r3 pinned every page to the viewport's left edge and left a dead strip of
paper down the right of any wide screen. r4 corrected that by centring the
whole frame — which centred the CHROME with it, so at 1920 the sidebar
floated 250px in from the bezel and the application read as an island
sitting on a desktop rather than as the window it is. Both applied one rule
to two things that want opposite treatment.

**Chrome pins.** The masthead spans the viewport and the sidebar's left edge
IS the screen's left edge. A window frame that floats is not a frame. The
bar's _contents_ pin too, not only its rule: r4 rode the contents on the
centred frame while the rule beneath them spanned the screen, which is the
visual tell that the two had come apart.

**Content is fluid.** The region runs from (sidebar + gutter) to (viewport −
gutter) with no cap at all. A tape, a table, a stat strip and a grid all get
better with width; capping them buys nothing and costs the width. Measured:
992px of content region at 1280, 1152 at 1440, 1632 at 1920, with a 32px
right-hand gutter at every one.

**Prose is the one exception.** A reading block caps at ~72ch keyed to the
region's LEFT edge, and there the right-hand whitespace is the point — r4's
own leaderboard CLS bug came from a paragraph with no measure at all.

`--shell-max`, `--shell-pad` and `.shell-frame` are gone. Routes with no
chrome to pin against take `clamp(24px, 6vw, 120px)`, which tracks the
viewport instead of stepping at a breakpoint and stops at 120px so a 2560px
screen does not become a letterbox. Landing gutters measure 77/77 at 1280,
86/86 at 1440, 115/115 at 1920.

The spec is rewritten, not adjusted: r4's frame-centring assertions asserted
the opposite of the contract, and a test that has to be inverted was
encoding an implementation rather than a rule. 15 tests to 20, including one
that the region genuinely WIDENS from 1440 to 2560 rather than merely moving
further from the edge. Published on `/design` with a drawn diagram, because
the failure being replaced was two rounds reading one sentence and picturing
different boxes.

### Dark is the default, and not the machine's decision

The token layer is written dark-first — `:root` IS the dark theme, `.light`
is the override — and the accent is tuned twice because one green cannot be
both a fill and a legible label on two grounds. Deferring that to
`prefers-color-scheme` handed roughly half of all first visits a theme the
design does not lead with, and made the product's identity a property of the
visitor's laptop.

`defaultTheme="dark"`, `enableSystem={false}`. A stored choice still wins and
nothing clears one — **a browser that was toggled to light before this change
stays light, and needs one toggle click to see the new default.** Taking
someone's preference away to demonstrate a default would be a worse bug than
the one being fixed.

Six tests, each in a fresh context. The flash test records every value
`<html>`'s class attribute ever holds and fails if any was ever the light
theme; writing it caught a bug in the instrument first, since an init script
runs before `document.documentElement` exists and the observer silently never
attached.

### Width buys information, not void

A fluid row at 1920 stretched about 600px of nothing between the identity
cluster and the numerics, because the insider's name was the only flexible
cell and took every pixel of the slack.

Two columns arrive once there is room, and the role shares the slack with the
name so the middle is filled rather than pulled apart. **Role** moves the
officer title out of the name cell, where it had been a second string
competing for the same truncation budget. **Price per share** has three
states and the difference between them is the point: a filed price is shown
as a fact; where the filing states none but gives both value and shares, the
quotient is shown with a tilde and a title saying it is an average across
whatever the row aggregates; neither available renders NotDisclosed, because
a zero there would be a fabricated fact about somebody's trade.

The tape gates on a CONTAINER stop, not a viewport one, and that distinction
is the whole reason the row is container-queried: the landing page's tape is
a 700px column on the same 1920px screen and must not sprout columns it has
no room for. DataTable gains a fourth priority tier, deliberately excluded
from the "All columns" affordance — tiers 2 and 3 are withheld on a narrow
screen and offering them back is honest, while tier 4 is progressive and
offering to "show" it on a phone would promise width the row does not have.

### The polish sweep

**One control family.** The filter row mixed 32px pill chips with raw native
`<select>`s — different height, different radius, the platform's arrow and
the platform's focus treatment — so they read as two toolbars that landed on
one line. The select stays a real `<select>`, because a native picker on a
phone beats a matching arrow, but loses its chrome to `appearance-none`. The
sector input, the clear control and the code legend join it; the legend was a
faint text link with a chevron, which reads as a footnote rather than as
something you press, and what it opens is the key to twenty badges.

**One header pattern.** "Live" was an eyebrow with its status pinned right,
"History" a panel title in another size and colour with nothing beside it,
"Today on the tape" a page heading — three spellings of one object on one
page. `SectionHeader` is label-left, meta-right, on a shared baseline, with
three tones that are a scale rather than an accident.

**Stat cards on one baseline**, with the hint pushed to the bottom so the
figures align whether or not a card carries one, and each card saying what
window it covers. When nothing has ever been ingested the hint says so
outright, so a zero reads as a stated fact rather than a broken panel.

**The account control** was a bare letter with no boundary of its own; it is
now a chip with a drawn avatar and a chevron.

Also: the treemap holds its last usable measurement. `ParentSize` reports 0
for a frame whenever its box is re-measured from scratch, and the canvas
refuses to draw below 10px, so a single zero blanked the whole chart.

### The mobile-performance attempt, and where it stopped

The landing tape opens its EventSource on idle rather than during hydration:
the rows on screen are server-rendered, so the stream keeps them current
rather than putting them there. It bought nothing measurable — landing
medians 83 before and 83 after, against a run-to-run spread of about ±4 — and
stays because it is correct and free.

Checked and already clean: next/font is not double-loading, with three IBM
Plex Mono weights (all three used) and one variable Onest face.

The motion split did not happen, and the reason is measured rather than
assumed. A throwaway build with the landing's reveals removed scored 86/82/86
against 78/83/84 — about three points of median, ranges overlapping — and it
does not remove the chunk anyway, because StatCard's spring count-up imports
the runtime too. The real change would be rewriting three animation
components, and three points of a noisy metric is not worth putting a stated
reduced-motion contract through that.

Landing 78/83/84, `/trades` 89/83/90, against r4's 67–82 and 77–89 on the
same harness. Main-thread work on the landing is down from 4.8s to 3.8s —
script evaluation 1333ms to 1042ms, style and layout 1284ms to 811ms — which
is Layout v3 paying off. Landing remains short of the 85 target by about two
points of a metric that moves four. What is left is React hydrating a page of
client components at 4× CPU; going further means deciding the landing tape
should not be live on first paint. That is a product decision.

### Verification

- 287 unit/integration; 192 Playwright e2e across three projects (was 177).
- Lighthouse desktop: accessibility **100 on every route**; performance 99–100
  everywhere except the 10k-row `/design` showcase.
- axe-core contrast: zero failures, 14 routes × both themes.
- Layout v3 contract measured at 1280/1440/1920 on every route.

## r4 — a shell that is centred, and a product that fits on a phone

### Layout equilibrium

r3 forbade `margin-inline: auto` on app pages. That was one rule doing two
jobs and it got one of them wrong. What needed protecting was that the
CONTENT does not re-centre — a heading over a centred card is a broken
column. Pinning the whole page to x=0 was never required for that, and above
~1500px it produced a layout hugging the left bezel with a dead strip of
paper down the right.

The model is now two levels, and keeping them apart is the point. The SHELL
is centred and capped at `--shell-max` (88rem), so above the cap the left
edge stops moving — which is the property r3 actually wanted, obtained by
bounding the frame rather than by pinning it. The BLOCKS inside it still key
to the shell's start edge and still may not re-centre.

`--shell-pad` is 16px below 640 and 24px above. `--shell-gutter` now means
only the gap between the sidebar and the content, and is zero where there is
no sidebar — adding a second gutter to the frame padding was double-indenting
the column. `--shell-rail-inset` gains a third step so the hanging rail keeps
~6px of air at every breakpoint rather than at the one width the suite
happened to render.

`.shell-aligned` was reconstructing the content edge by adding the sidebar to
the viewport's left edge — correct exactly while the shell starts at x=0, and
244px wrong at 1920. It is now a frame in its own right and tracks the shell
by centring the same way.

And the width has to be USED, or a centred shell has only moved the dead zone
one level down. The landing hero spans the frame at its existing 7/5 instead
of stopping at 72rem. `/stock` splits into a panel rail and the record, and
`/settings` flows its cards into two columns — both at `xl` and not `lg`,
because inside the sidebar shell `lg` leaves 716px and dividing that
reproduces the same problem in miniature. Prose pages keep a 72rem measure
and their left edge: a right margin inside a centred frame is whitespace on
purpose.

The layout spec is rewritten rather than adjusted, because r3's two central
assertions now encode the opposite of the contract. 7 tests to 15.

### The phone

Every test in the r3 suite ran at 1280x720 — no `setViewportSize`, no device
descriptor, no `hasTouch` anywhere. 140 tests only ever executed the ≥1024px
branch of every responsive rule, and what they were not looking at had rotted
accordingly.

**The masthead** had five children summing to 43px more than a 360px viewport
holds, and no `shrink-0` on any of them. A flex item's automatic minimum size
is its CONTENT, so the row settled its arithmetic by squeezing whichever
control shrank quietest — the hamburger, to about seventeen pixels, and it
was the only route to eleven destinations below `lg`. Every control in the bar
is now 44px and `shrink-0`; below `md` the icon controls drop their borders
and take the space instead.

**The navigation** becomes an off-canvas drawer. It is the sidebar, so it
slides from the left, behind a trigger moved to the leading edge, with the
page visible behind the scrim. Radix supplies the focus trap, Escape, scroll
lock and outside-press. It does not supply focus restoration here, and that
was a live bug: `DialogContent` hard-wires an `onCloseAutoFocus` that cancels
FocusScope's restore and focuses `context.triggerRef`, a ref only ever
populated by `<DialogTrigger>`. Both overlays are opened by plain buttons, so
the ref was null and a keyboard user pressing Escape was returned to the top
of the document.

**Language and theme** fold into an overflow menu. The locale switcher had
exactly one mount point in the entire app — the masthead, behind
`hidden sm:inline-flex`. A reader on a phone could not choose Hindi, and a
reader who had chosen it on a desktop was locked into it with no way back.

**The tape row** folds to two lines below 640px. At 360px the insider's name
— the subject of the row — was resolving to about twelve pixels and rendering
as a single ellipsis: it is the only flexible cell, its fixed siblings already
consumed the width, and `truncate` sets `overflow: hidden`, which zeroes a
flex item's automatic minimum size. So the column collapsed silently instead
of overflowing. The page looked correct, scrolled correctly, and had lost the
one field a reader is scanning for.

The fold is on the VIEWPORT even though every optional column stays on its
container query, because the two rules answer different questions — and a
container query could not answer this one anyway: the tape's container is
607px at a 639px viewport and 592px at 640px, so it moves the wrong way across
the boundary the fold needs.

**Row quick-actions** were gated behind an `@lg` container query, which below
a 512px container meant `display: none`. On a phone the feature was not hard
to reach, it was absent. Above 640px the hover-revealed pair stays; below, one
44px menu, because two 24px buttons cannot be laid out on a 60px row at a
tappable size without their hit areas overlapping.

**Wide tables** get column priority (on TanStack's `meta`, so no prop
signature changes), a frozen first column with its own ground, and a drawn
edge. At 390px the screener goes from 979px of table in a 358px well to 414px.
Nothing is lost: the full set is one tap away, because hiding a filing's
source with no way to ask for it would make the phone a lesser view of the
truth rather than a smaller one.

Two things fell out of that work. The sticky header had never stuck: `Table`
always wrapped the `<table>` in `overflow-x-auto`, and an element with
`overflow-x: auto` and unspecified `overflow-y` computes `overflow-y: auto`
too, so the wrapper was the header's nearest scrollport — a box of
`height: auto` that can never scroll vertically. And the scroll well's height
was an inline pixel value no class could override: 560px on a 640px-tall phone
captured every vertical drag inside it, so the page could not be scrolled past
the table by touch at all.

**The screener's filters** move into a bottom sheet with draft state and an
Apply button, leaving market and side on the page as one scrolling row. Laid
out flat at 360px the sixteen controls take six rows, and about 545px of a
640px screen was spent before the first result.

**The heatmap** replaces the treemap with its ranked list below `md`. The
label gate needs a tile of 72×40px, which on a 286×520 canvas is 1.9% of total
gross flow — fewer than ten of a hundred and twenty cells clear it. Raising
the minimum cell size instead would mean showing fewer companies without
saying so. The treemap's tooltip also gains a touch path: it was bound solely
to `mouseenter` and `focus`, so on any touch device the first tap navigated
and the figures behind every tile were unreachable.

**Touch targets**: 279 standalone controls under 44×44 at 390px, down to zero,
with two documented exemptions — the skip link, which is `sr-only` until
focused, and the transaction-code badge, which goes 20×20 → 24×24 to clear
WCAG 2.2 §2.5.8 and stops there because 44px would double the height of every
row in the product.

### Two defects found by disagreement

The overflow spec asserted `document.scrollWidth <= window.innerWidth`. Under
`isMobile: true` — which the mobile project sets, and which is the whole point
of it — Chromium honours the meta viewport, and content wider than the layout
viewport WIDENS THE LAYOUT VIEWPORT rather than overflowing it. So the check
was strictly weakest on the configuration it exists for: `/politicians` was
408px wide inside a 360px window and the assertion compared 408 to 408 and
passed. The screenshot sweep, which runs without `isMobile`, is what caught
it. The page bug underneath was a grid item's default `min-width: auto`
resolving to its min-content width, so the longest name in a list set a floor
the whole page had to widen to meet.

`/leaderboard` came out of r4 at Lighthouse desktop 90, down from 100, on CLS
alone. The block that moves is the methodology disclaimer, which had no
measure and so ran to ~150 characters a line — leaving it exactly on a wrap
boundary, where the font swap gains it a line and pushes the results table
18px down. r4 did not create the reflow (`display: swap` can always relay a
paragraph; a size-adjusted fallback matches vertical metrics, not glyph
advances) — it narrowed the content region by 44px at 1440, which is what
centring and capping the frame costs, and moved that paragraph onto the edge.
An 80ch measure is the right typography either way and takes it back off.

Both are worth recording for how nearly they were missed. The Lighthouse
metric is bimodal — the first run after a server restart scored 100 and the
rest scored 90 — so the one-run-per-route sweep could have said either, and
the first r3-vs-r4 comparison was one run each and appeared to clear r3 of a
regression it did not have. Three consecutive runs per build settled it, after
killing twenty-one orphaned Chrome processes left behind by earlier Lighthouse
runs: the same "the test is measuring the machine" trap r3 hit with the 60fps
spec.

### Verification

- 287 unit/integration; 174 Playwright e2e across three projects (was 140).
- Lighthouse desktop: accessibility 100 on every route; performance 100 on
  every route except the 10k-row `/design` showcase.
- Lighthouse mobile (Moto G Power, 4× CPU, slow 4G): accessibility 100.
  Performance 75 / 87 / 76 / 74 on landing, `/trades`, `/screener`, `/stock`
  — measured at 75 / 89 / 76 / 75 on the r3 build, so unchanged, and short of
  the brief's 90 for structural reasons that predate r4.
- axe-core contrast: zero failures, 16 routes × both themes.
- Zero page-level overflow at 360/768/1024/1440/1920 in both themes.

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
