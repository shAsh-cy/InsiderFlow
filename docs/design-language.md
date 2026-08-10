# Ledger — the InsiderFlow design language

A paper terminal. Warm off-white stock, hairline rules, ink-black type,
monospaced figures, and exactly one accent.

The live showcase is at [`/design`](<../apps/web/src/app/(shell)/design/page.tsx>).
The tokens themselves live in
[`apps/web/src/app/globals.css`](../apps/web/src/app/globals.css) — this file
explains the reasoning; that file is the source of truth.

---

## The four rules

1. **No raw colour values in components.** Everything is a token. A hex code
   in a `.tsx` file is a bug.
2. **Hairlines, never glows.** One border weight: `1px solid var(--border)`.
   No `box-shadow` used as emphasis, no gradient borders, no neon.
3. **One accent element per view.** Oxblood earns attention by scarcity. Two
   primary buttons on one screen means neither is primary.
4. **Colour never carries meaning alone.** Every buy/sell distinction is
   paired with a glyph (`▲`/`▼`), a letter code, or a written label.

---

## Colour

Light is the default. Dark is warm near-black ink — the same language after
sundown, not an inverted neon skin.

| Token          | Light     | Dark      | Use                            |
| -------------- | --------- | --------- | ------------------------------ |
| `--bg`         | `#FBFAF7` | `#0E0D0B` | Page ground                    |
| `--surface`    | `#FFFFFF` | `#17150F` | Cards, tables, overlays        |
| `--fill`       | `#F1F0EC` | `#1E1B17` | Zebra bands, hover, wells      |
| `--border`     | `#E4E1D9` | `#2A2723` | Every rule in the product      |
| `--ink`        | `#17150F` | `#F2EFE8` | Primary type                   |
| `--ink-muted`  | `#6B6659` | `#A7A091` | Secondary type                 |
| `--ink-faint`  | `#9B9689` | `#6B6659` | Tertiary type, null glyphs     |
| `--accent`     | `#8A2B2B` | `#8A2B2B` | Oxblood — CTA fills, brand     |
| `--accent-ink` | `#8A2B2B` | `#C97F76` | Oxblood as _text_              |
| `--accent-2`   | `#B15F2C` | `#B15F2C` | Burnt orange — live pulse only |

### Why `--accent` and `--accent-ink` are two tokens

Oxblood on paper is 8.2:1 — excellent as text. The _same_ oxblood on near-black
is 2.3:1, which fails. So the fill colour and the text colour are separated:
`--accent` never changes (a button's fill must be the brand colour in both
themes), and `--accent-ink` lifts in dark so oxblood-as-type stays legible.

The same split exists for the data colours below.

### Data semantics — Wong palette

Colourblind-safe, from Wong, _Nature Methods_ 8:441 (2011). Deliberately **not**
red/green: roughly 8% of men have a colour-vision deficiency, and red–green is
the axis most of them lose.

| Role     | Colour                 | Notes                                     |
| -------- | ---------------------- | ----------------------------------------- |
| BUY      | `#D55E00` vermillion   | Always paired with `▲` or the code letter |
| SELL     | `#0072B2` blue         | Always paired with `▼` or the code letter |
| Series 3 | `#009E73` bluish green |                                           |
| Series 4 | `#E69F00` orange       |                                           |

`--buy-ink` / `--sell-ink` are the text-legible variants. Vermillion is only
3.7:1 on paper, so small text uses a darkened tone of the same hue; the blue
needs the same treatment in dark. Chart _marks_ use the canonical values (large
areas need 3:1, not 4.5:1), so the palette is never actually distorted where it
matters for identification.

The heatmap uses a perceptually uniform sequential ramp (Viridis, six stops:
`--ramp-0` … `--ramp-5`). A sequential quantity gets a sequential ramp; a
red–green diverging scale here would be wrong twice over.

---

## Type

- **Onest** (variable) — interface and headings.
- **IBM Plex Mono** — _every_ numeral, ticker, currency amount, and table
  figure, with `font-variant-numeric: tabular-nums`.

Use the `.num` utility for figures — it applies the mono face and tabular
figures together. Use `.tnum` when you need tabular figures in the sans face.

Numbers are set in mono because a column of amounts has to align digit-for-digit,
and because a ticking counter whose digits change width is unreadable.

### Scale (rem)

`0.75 · 0.8125 · 0.875 · 1 · 1.125 · 1.375 · 1.75 · 2.25 · 3 · 4`

Mapped to `text-2xs` through `text-5xl`. `text-6xl` and `text-7xl` are clamped
to `4rem` so a stray class cannot reintroduce an off-scale size.

---

## Shape and depth

- **Radii:** cards `12px` (`rounded-lg`), inputs and buttons `8px`
  (`rounded-md`), badges `6px` (`rounded-sm`), pills `full`.
  Rectangular badges vs. pill-shaped chips is a real distinction: **the shape
  tells you whether a thing is clickable.**
- **Spacing:** 4px base grid — 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64.
- **Shadows:** near-flat and warm. `--shadow-card` for resting surfaces,
  `--shadow-overlay` for dialogs and popovers. Nothing else.

### Surface utilities

| Class             | Meaning                                                     |
| ----------------- | ----------------------------------------------------------- |
| `.surface`        | A card. Paper, one hairline, one whisper of shadow.         |
| `.surface-sunken` | A well or inset. `--fill` ground.                           |
| `.surface-raised` | A floating layer — dialog, popover, palette.                |
| `.ruled`          | The signature motif: accounting-paper hairlines every 32px. |
| `.paper-grain`    | One very quiet fibre layer over the page.                   |

---

## Motion

Presets live in [`apps/web/src/lib/motion.ts`](../apps/web/src/lib/motion.ts).
A component that hand-rolls a spring is a bug — the point of the system is
that a row inserting, a card lifting, and a number ticking all feel like the
same hand.

| Preset    | Spring        | Used for                                  |
| --------- | ------------- | ----------------------------------------- |
| `snappy`  | 400 / 17 / 1  | Hover lift (slight, deliberate overshoot) |
| `press`   | 400 / 30      | Press — critically damped, never bounces  |
| `layout`  | 500 / 30      | The `layout` prop; reorder and reflow     |
| `feedRow` | 350 / 30 / 1  | Live SSE row insertion                    |
| `reveal`  | 100 / 20 / 1  | Scroll-triggered section reveal           |
| `counter` | 75 / 15 / 0.8 | Number count-up                           |

Stagger is `0.1s`, or `0.05s` in dense grids.

Springs rather than durations: physical settling reads as material behaviour,
and it stays coherent when two animations of different distances run side by
side — something a fixed duration cannot do.

### Reduced motion

The app is wrapped in `<MotionConfig reducedMotion="user">`, so every spring
honours the OS setting by default. Components that move something large also
branch on `useReducedMotion()` to **drop the transform entirely** rather than
merely shorten it. Opacity and colour still animate; nothing ever stays
invisible.

`.live-pulse` is the system's only infinite CSS animation. It is pure ornament,
so `@media (prefers-reduced-motion: reduce)` stops it outright rather than
shortening it. The e2e suite additionally sweeps every element on the page and
fails if anything is still animating indefinitely under that setting.

---

## Data honesty is a design constraint

These are not styling choices and must not be "cleaned up":

- A missing value renders `NotDisclosed` (an em dash plus a screen-reader
  label), **never** `0` and never an empty cell.
- Politician trade amounts are ranges. No surface may synthesise a midpoint.
- Superseded filings are hidden by default and flagged when shown.
- Synthetic `ZZ*` fixtures never appear in aggregates without the
  `SyntheticDataNotice` banner alongside them.

`SyntheticDataNotice` is one of the few components allowed to spend the accent.
A caveat the reader must not skim past is exactly what scarcity is saved for.
