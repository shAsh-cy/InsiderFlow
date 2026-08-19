# Performance — what is measured, and the one route that regressed

`pnpm lighthouse` is the committed runner. It samples each route `--runs`
times and judges the median, because these scores are a measurement of a
machine under load and not a property of the page.

## The r16 claim was wrong, and this is the correction

r16 reported that this project's long-standing Lighthouse figures were "not
true" and that performance was "nowhere near the claimed 100 on either
preset". **That was a unit error and it is withdrawn.**

The old numbers carried their preset. CHANGELOG r4 reads:

> - Lighthouse **desktop**: accessibility 100 on every route; performance 100
>   on every route except the 10k-row `/design` showcase.
> - Lighthouse **mobile** (Moto G Power, 4× CPU, slow 4G): accessibility 100.
>   Performance **75 / 87 / 76 / 74** on landing, `/trades`, `/screener`,
>   `/stock` — … short of the brief's 90 for structural reasons that predate r4.

The mobile shortfall was measured, written down, and explained at the time.
r16 compared this runner's **mobile** medians against the **desktop** figure
and announced a 34-point gap that was mostly a comparison between two
different measurements of the same build.

## Re-measured on a quiet machine (2026-08-19)

Production build on `:3100`, nothing else running, median of 5.

| Route           | mobile | desktop preset | desktop unthrottled | r4 mobile |
| --------------- | -----: | -------------: | ------------------: | --------: |
| `/`             |     78 |             80 |             **100** |        75 |
| `/trades`       |     88 |             89 |              **99** |        87 |
| `/screener`     | **62** |             60 |                  78 |        76 |
| `/stock/ZZNOVA` |     74 |             75 |                   — |        74 |
| `/design`       |     72 |             70 |                   — |         — |

Three conclusions, in order of how much they matter.

**The historical desktop figures reproduce exactly.** `/` scores 100 and
`/trades` 99 unthrottled today. "Lighthouse desktop 100" was true when it was
written and is still true. Note what that means about the preset: the desktop
figures were taken **unthrottled**, because Lighthouse's own desktop _preset_
throttles and yields 80/89.

**The historical mobile figures reproduce too, on every route but one.**
78/88/74 today against r4's 75/87/74. Nothing regressed on `/`, `/trades` or
`/stock`, and the mobile bar of 90 was never met on them — as r4 said.

**`/screener` regressed: 76 → 62 mobile.** That is the one real finding in
this round, and it is worth fourteen points rather than thirty-four.

## `/screener`, diagnosed

Two things are true of it and of no other route.

**It is the only route whose score is bimodal.** Five consecutive quiet runs:
`62 76 57 59 73`. A nineteen-point spread on an unchanging build means the
score is being decided by timing, not by weight — the same shape r4 recorded
on `/leaderboard` ("the first run after a server restart scored 100 and the
rest scored 90"). A median is the honest summary; the spread is the symptom.

**Even unthrottled it stops at 78** where `/` reaches 100. So there is a
fixed cost that throttling is not creating. Lighthouse attributes it:

```
script eval        947 ms  /screener                      (the document)
                   835 ms  chunks/6121-*.js               (170 kB)
                   149 ms  chunks/app/(shell)/screener/page-*.js
unused-javascript  ~430 ms
TBT                544 ms mobile / 438 desktop / 77 unthrottled
First Load JS      286 kB  (vs /trades 228 kB, /heatmap 122 kB)
```

The cost is **script evaluation and hydration**, not the server: TTFB is 62 ms.
It is not the seven presets either — those are server-side query builders and
never reach the client bundle.

### What has NOT been ruled out

Being explicit, because a plausible cause stated as a finding is how the r16
error happened.

- **Every route is dynamically rendered** (`ƒ` for all 42 in the build output;
  only `icon.svg` and `security.txt` are static). The root layout calls
  `headers()` for the CSP nonce and `getSessionUser()` for the session, and
  either alone forces the whole tree dynamic. This is a real change since r9.2
  — r12 added the nonce — but it shows up in TTFB, and TTFB is 62 ms. It is
  **not** the cause of the `/screener` deficit, though it may cost a point or
  two everywhere.
- **`bf-cache` is blocked**, which Lighthouse reports but does not score.
  Likely `Cache-Control: no-store` from the r12 security work. Cheap to
  investigate, no scored effect.
- **Which module dominates chunk 6121** is unknown. The chunk is minified and
  library fingerprints do not survive; `@tanstack/react-table` plus
  `@tanstack/react-virtual` is the hypothesis, and it is only a hypothesis.
  Naming it would need a bundle analyser, which is the next step and is not
  taken here.

### Why no fix in this round

The honest estimate of the available gain is **not yet measurable**, and this
document is not going to invent one. What is known: 286 kB of First Load JS
evaluating for ~1.9 s on a throttled CPU, of which Lighthouse believes ~430 ms
is unused. A code-split of the table path would plausibly recover part of the
TBT, but "plausibly" is the operative word, and shipping a refactor of the
screener's rendering path against an unproven attribution is how a
14-point regression becomes a 30-point one.

The floor in `scripts/lighthouse.mjs` is set at 55 for `/screener`, below the
bottom of its own 57–76 noise band, so the gate catches a further regression
without tripping on variance. The goal stays at 90 and the deficit prints on
every run.

## Reproducing

```bash
# production build, quiet machine, nothing else running
pnpm --filter @insiderflow/web exec next build
pnpm --filter @insiderflow/web exec next start -p 3100 &
pnpm lighthouse --runs=5                 # mobile, the gate
pnpm lighthouse --runs=5 --preset=desktop
```

Kill stray Chrome processes first. r4 lost a sweep to twenty-one of them, and
r16 lost one to a concurrent `next build` — this suite's recurring lesson is
that the test measures the machine unless you make it not.
