/**
 * Seed a local database so `docker compose up` yields a working product.
 *
 * DATA HONESTY — the constraint that shapes this whole file:
 *
 *   Every seeded row is SYNTHETIC and lives in the reserved `ZZ*` ticker
 *   namespace, with `e2e-seed-*` dedup keys and obviously fictional people.
 *   Nothing here is attributed to a real company, a real executive, or a real
 *   member of Congress.
 *
 * That is not squeamishness. A screenshot of this app showing "Tim Cook sold
 * $40M of AAPL" would be read as fact, and a seeded fixture that looks real is
 * indistinguishable from a real filing once it leaves the developer's laptop.
 * The ZZ namespace is also what the analytics layer filters out of every
 * leaderboard and heatmap, so seeded rows can never be presented as market data.
 *
 * REFUSES TO RUN against anything that looks like production (see guard below).
 *
 *   DATABASE_URL=... pnpm --filter @insiderflow/db seed
 *   DATABASE_URL=... pnpm --filter @insiderflow/db run seed -- --reset
 *
 * (`run` is required: with the implicit form pnpm swallows the flag.)
 */
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const reset = process.argv.includes("--reset");
const force = process.argv.includes("--force");

/**
 * Seeding production would inject fabricated filings into a public dataset.
 * Local Postgres is the only thing that looks like a dev database, so anything
 * else has to be opted into explicitly.
 */
const isLocal = /@(localhost|127\.0\.0\.1|postgres|host\.docker\.internal)[:/]/.test(databaseUrl);
if (!isLocal && !force) {
  console.error(
    [
      "Refusing to seed: DATABASE_URL does not look local.",
      "",
      "Seed data is synthetic. Writing it to a shared or production database",
      "would put fabricated filings in front of real users.",
      "",
      "Pass --force if you are certain this is a scratch database.",
    ].join("\n"),
  );
  process.exit(1);
}

const sql = postgres(databaseUrl, { prepare: false, max: 1 });
const log = (event, data = {}) =>
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...data }));

const day = (offset) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

/**
 * INGESTION TIME, spread across the last day and a bit.
 *
 * `created_at` is when the ingester SAW a filing, which is a different
 * fact from when the trade happened, and it is the one the landing page
 * counts: "filings today" is a claim about the last 24 hours of
 * ingestion. Left to the column default, every seeded row lands in the
 * same second — so the tape shows twenty rows all "just now", their
 * relative order is whatever the insert loop happened to do, and the
 * count falls to zero the day after seeding and never recovers.
 *
 * So each row gets an explicit arrival time, newest first, stepping back
 * over ~30 hours. Deterministic (index-derived, no randomness), and
 * weighted so most rows land inside the 24-hour window — a clean
 * `docker compose up` therefore shows a real non-zero figure, computed
 * by the same query production uses, from timestamps that are true.
 *
 * This does not fabricate freshness: it makes the fixture's arrival
 * times as relative-to-now as its trade dates already were. A seed whose
 * timestamps are frozen at build time is the thing that lies.
 */
const INGEST_SPAN_MINUTES = 30 * 60;
const ingestedAt = (index, total) => {
  // 8 minutes ago for the newest, then evenly back. `total - 1` so the
  // oldest lands exactly on the far edge rather than past it.
  const step = total > 1 ? INGEST_SPAN_MINUTES / (total - 1) : 0;
  return new Date(Date.now() - (8 + index * step) * 60_000).toISOString();
};

// ── Fixtures ────────────────────────────────────────────────────────────────
// Shaped to exercise every feature: a cluster, a dip buy, routine vs
// opportunistic, an amendment, multi-currency, and an India-market company.

const COMPANIES = [
  {
    key: "ZZNOVA",
    name: "ZZ Nova Robotics Inc.",
    country: "US",
    sector: "Technology",
    industry: "Industrial Machinery",
    sic: "3559",
    exchange: "Nasdaq",
  },
  {
    key: "ZZHELIO",
    name: "ZZ Helio Therapeutics Corp.",
    country: "US",
    sector: "Health Care",
    industry: "Pharmaceutical Preparations",
    sic: "2834",
    exchange: "Nasdaq",
  },
  {
    key: "ZZORCA",
    name: "ZZ Orca Energy Partners",
    country: "US",
    sector: "Energy",
    industry: "Crude Petroleum & Natural Gas",
    sic: "1311",
    exchange: "NYSE",
  },
  {
    key: "ZZMERID",
    name: "ZZ Meridian Financial Group",
    country: "US",
    sector: "Financials",
    industry: "State Commercial Banks",
    sic: "6022",
    exchange: "NYSE",
  },
  {
    key: "ZZBHARAT",
    name: "ZZ Bharat Industries Ltd.",
    country: "IN",
    sector: "Industrials",
    industry: "Fabricated Metal",
    sic: "3440",
    exchange: "NSE",
  },
];

const INSIDERS = [
  { key: "ZZ AVERY STONE", officer: true, title: "Chief Executive Officer", director: true },
  { key: "ZZ MARLOW REED", officer: true, title: "Chief Financial Officer" },
  { key: "ZZ INES OKONKWO", director: true },
  { key: "ZZ THEO BRANNIGAN", director: true },
  { key: "ZZ PRIYA RAMANATHAN", officer: true, title: "Chief Operating Officer" },
  { key: "ZZ DESMOND HALE", tenPct: true },
];

/**
 * `code` and `relevance` are set together on purpose: P/S are discretionary,
 * while A (grant) and F (tax withholding) are routine plumbing. Screens and
 * scoring both depend on that distinction, so the seed has to show both.
 */
const TRADES = [
  // A 3-insider cluster in ZZNOVA — drives /screener?preset=cluster-buys.
  { co: "ZZNOVA", who: "ZZ AVERY STONE", code: "P", day: 6, shares: 25_000, price: 18.4 },
  { co: "ZZNOVA", who: "ZZ INES OKONKWO", code: "P", day: 4, shares: 12_000, price: 18.95 },
  { co: "ZZNOVA", who: "ZZ THEO BRANNIGAN", code: "P", day: 2, shares: 8_000, price: 19.6 },
  {
    co: "ZZNOVA",
    who: "ZZ MARLOW REED",
    code: "A",
    day: 20,
    shares: 40_000,
    // NULL, not 0. A grant has no purchase price, and docs/architecture.md
    // states the invariant plainly: "a missing value is never a zero". The
    // renderers were correct — they faithfully printed the 0 they were given,
    // as "at USD 0" in RSS and "$0" on the stock page. The FIXTURE was the lie,
    // and it is the first example every contributor reads.
    price: null,
    routine: true,
  },

  // A big discretionary sale — /screener?preset=big-discretionary-sales.
  { co: "ZZHELIO", who: "ZZ AVERY STONE", code: "S", day: 3, shares: 60_000, price: 41.2 },
  {
    co: "ZZHELIO",
    who: "ZZ MARLOW REED",
    code: "F",
    day: 12,
    shares: 3_400,
    price: 39.8,
    routine: true,
  },
  { co: "ZZHELIO", who: "ZZ DESMOND HALE", code: "P", day: 45, shares: 150_000, price: 28.75 },

  // A dip buy: priced below the seeded close for that day.
  { co: "ZZORCA", who: "ZZ PRIYA RAMANATHAN", code: "P", day: 5, shares: 30_000, price: 11.1 },
  { co: "ZZORCA", who: "ZZ THEO BRANNIGAN", code: "S", day: 30, shares: 15_000, price: 13.4 },

  { co: "ZZMERID", who: "ZZ INES OKONKWO", code: "P", day: 9, shares: 5_000, price: 63.2 },
  { co: "ZZMERID", who: "ZZ AVERY STONE", code: "S", day: 60, shares: 22_000, price: 58.9 },

  // India-market rows, in INR with a USD conversion.
  {
    co: "ZZBHARAT",
    who: "ZZ PRIYA RAMANATHAN",
    code: "P",
    day: 7,
    shares: 9_000,
    price: 1420,
    ccy: "INR",
  },
  {
    co: "ZZBHARAT",
    who: "ZZ DESMOND HALE",
    code: "S",
    day: 25,
    shares: 4_500,
    price: 1380,
    ccy: "INR",
  },

  // ── A track record, so the LEADERBOARD is not empty ──────────────────────
  //
  // The leaderboard defaults to min_trades=5, which is not an arbitrary cutoff:
  // the composite score shrinks toward zero by sample size, and ranking someone
  // on one lucky trade is exactly the kind of false precision this project
  // refuses to publish. So the honest way to make the page render on a seeded
  // stack is to seed insiders who have actually traded enough — not to lower
  // the threshold for the demo.
  //
  // Every row here is opportunistic P/S, at least 30 days old (scoring's
  // minimum holding age), on a ticker with seeded price history, so the
  // computed returns are real arithmetic over real fixtures rather than
  // decoration.
  ...[
    { who: "ZZ AVERY STONE", days: [75, 120, 165, 210, 255, 300] },
    { who: "ZZ DESMOND HALE", days: [90, 135, 180, 225, 270, 315] },
  ].flatMap(({ who, days }) =>
    days.map((day, i) => {
      const co = ["ZZNOVA", "ZZHELIO", "ZZORCA", "ZZMERID"][i % 4];
      const base = { ZZNOVA: 19.8, ZZHELIO: 40, ZZORCA: 12.4, ZZMERID: 61 }[co];
      return {
        co,
        who,
        // Alternating direction: excess return is SIGNED by direction, so a
        // well-timed sale has to be able to score as a win here too.
        code: i % 2 === 0 ? "P" : "S",
        day,
        shares: 4_000 + i * 1_500,
        // Slightly off the seeded close so the return is not trivially zero.
        price: Number((base * (1 + ((i % 3) - 1) * 0.04)).toFixed(2)),
      };
    }),
  ),
];

const INR_USD = 0.0117;

try {
  if (reset) {
    log("reset_start");
    // Only ever touches the synthetic namespace.
    await sql`delete from politician_trades where dedup_key like 'e2e-seed-%'`;
    await sql`delete from politicians where external_key like '%zz %'`;
    await sql`delete from trade_returns where company_id in (select id from companies where ticker like 'ZZ%')`;
    await sql`delete from cluster_flags where company_id in (select id from companies where ticker like 'ZZ%')`;
    await sql`delete from company_anomalies where company_id in (select id from companies where ticker like 'ZZ%')`;
    await sql`delete from transactions where dedup_key like 'e2e-seed-%'`;
    await sql`update filings set superseded_by_filing_id = null where accession_no like 'e2e-seed-%'`;
    await sql`delete from filings where accession_no like 'e2e-seed-%'`;
    await sql`delete from companies where ticker like 'ZZ%'`;
    await sql`delete from insiders where external_key like 'name:%:ZZ %'`;
    // Every row this script writes carries source='seed', including the SPY
    // benchmark series. Deleting only ZZ* left SPY frozen at whatever the
    // first run wrote, so a change to the price model silently did not apply
    // to the benchmark — and scoring measures excess OVER that benchmark.
    await sql`delete from daily_prices where source = 'seed'`;
    await sql`delete from sast_disclosures where dedup_key like 'e2e-seed-%'`;
    await sql`delete from bulk_block_deals where dedup_key like 'e2e-seed-%'`;
    await sql`delete from pledge_disclosures where dedup_key like 'e2e-seed-%'`;
    log("reset_ok");
  }

  // ── Companies ─────────────────────────────────────────────────────────────
  const companyIds = new Map();
  for (const c of COMPANIES) {
    const [row] = await sql`
      insert into companies (external_key, ticker, name, country, sector, industry, sic_code, exchange)
      values (${`ticker:${c.country}:${c.key}`}, ${c.key}, ${c.name}, ${c.country},
              ${c.sector}, ${c.industry}, ${c.sic}, ${c.exchange})
      on conflict (external_key) do update set name = excluded.name, sector = excluded.sector
      returning id`;
    companyIds.set(c.key, row.id);
  }
  log("seeded", { companies: companyIds.size });

  // ── Insiders ──────────────────────────────────────────────────────────────
  const insiderIds = new Map();
  for (const i of INSIDERS) {
    const [row] = await sql`
      insert into insiders (external_key, name, is_director, is_officer, is_ten_pct_owner, officer_title)
      values (${`name:US:${i.key}`}, ${i.key}, ${!!i.director}, ${!!i.officer},
              ${!!i.tenPct}, ${i.title ?? null})
      on conflict (external_key) do update set name = excluded.name
      returning id`;
    insiderIds.set(i.key, row.id);
  }
  log("seeded", { insiders: insiderIds.size });

  // ── Filings ───────────────────────────────────────────────────────────────
  // One original + one amendment, so the "show amendments" toggle and the
  // superseded-exclusion rules have something real to act on.
  const [original] = await sql`
    insert into filings (accession_no, form_type, filed_at, issuer_company_id, source_url)
    values ('e2e-seed-0000000001', '4', now() - interval '3 days',
            ${companyIds.get("ZZHELIO")}, 'https://example.invalid/seed/original')
    on conflict (accession_no) do update set form_type = excluded.form_type,
      filed_at = excluded.filed_at
    returning id`;
  const [amendment] = await sql`
    insert into filings (accession_no, form_type, filed_at, issuer_company_id, source_url)
    values ('e2e-seed-0000000002', '4/A', now() - interval '1 day',
            ${companyIds.get("ZZHELIO")}, 'https://example.invalid/seed/amendment')
    on conflict (accession_no) do update set form_type = excluded.form_type,
      filed_at = excluded.filed_at
    returning id`;
  await sql`
    update filings set superseded_by_filing_id = ${amendment.id} where id = ${original.id}`;
  log("seeded", { filings: 2, amendment: true });

  // ── Transactions ──────────────────────────────────────────────────────────
  //
  // Ordered newest-trade-first before assigning arrival times, so a filing
  // about a recent trade arrives more recently than one about an old
  // trade. That is how the real pipeline behaves, and it means the tape
  // sorted by `created_at` reads in a sensible order out of the box.
  //
  // RE-SEEDING MUST MOVE BOTH DATES, not just the arrival.
  //
  // `dedup_key` below encodes the day OFFSET, which is stable across runs,
  // so a re-seed always matches the existing row and takes the ON CONFLICT
  // branch. That branch used to update `created_at` alone: it refreshed when
  // a filing was SEEN and left when the trade HAPPENED frozen at whatever
  // date the database was first seeded, so every trade drifted one day
  // further into the past for every day the database survived.
  //
  // Not cosmetic. The cluster detector looks back 14 days, so a fortnight
  // after the first seed the three ZZNOVA buys that exist to form a cluster
  // fall out of the window, `cluster_flags` goes empty, and
  // `cold-start.spec.ts` fails its "cluster-buys returns rows" assertion.
  // Measured on a database seeded 7 days earlier: those buys sat 13, 15 and
  // 17 days back instead of 2, 4 and 6, and the analytics run wrote 0 flags
  // where a clean database wrote 1.
  //
  // The e2e pre-flight prints `pnpm seed` as the remedy for a stale
  // database. Until this was fixed that remedy did not actually fix it,
  // which is the worse half: a documented cure that reports success and
  // changes nothing.
  //
  // STILL STALE ON RE-SEED: the politician, SAST, deal and pledge inserts
  // are ON CONFLICT DO NOTHING, so their dates never move either. Left
  // alone deliberately — those rows carry honesty-sensitive columns
  // (amount ranges above all) and turning them into an UPDATE is a design
  // decision about what a re-seed may overwrite, not a bug fix.
  const ARRIVALS = [...TRADES].sort((a, b) => a.day - b.day);
  let n = 0;
  for (const t of TRADES) {
    const ccy = t.ccy ?? "USD";
    // A null price yields a null value and a null USD value all the way
    // through. Multiplying by 0 or coalescing here is exactly how a
    // not-disclosed field becomes a confident-looking zero downstream.
    const hasPrice = t.price !== null && t.price !== undefined;
    const value = hasPrice ? t.shares * t.price : null;
    const priceUsd = !hasPrice ? null : ccy === "INR" ? t.price * INR_USD : t.price;
    const valueUsd = value === null ? null : ccy === "INR" ? value * INR_USD : value;
    const country = COMPANIES.find((c) => c.key === t.co).country;
    const createdAt = ingestedAt(ARRIVALS.indexOf(t), ARRIVALS.length);
    await sql`
      insert into transactions (source, insider_id, company_id, txn_date, code, shares, price,
        value, currency, price_usd, value_usd, acquired_disposed, is_10b5_1, is_derivative,
        relevance, dedup_key, country, created_at)
      values ('edgar', ${insiderIds.get(t.who)}, ${companyIds.get(t.co)}, ${day(t.day)},
        ${t.code}, ${t.shares}, ${t.price}, ${value}, ${ccy}, ${priceUsd}, ${valueUsd},
        ${["P", "A", "M"].includes(t.code) ? "A" : "D"}, false, false,
        ${t.routine ? "routine" : "opportunistic"},
        ${`e2e-seed-${t.co}-${t.who.replaceAll(" ", "")}-${t.day}-${t.code}#0`}, ${country},
        ${createdAt})
      on conflict (dedup_key) do update set created_at = excluded.created_at,
        txn_date = excluded.txn_date`;
    n++;
  }
  // Report the figure the landing page will show, so a seed run that
  // would leave "filings today" at zero says so in its own output.
  const withinDay = ARRIVALS.filter(
    (_, i) => Date.now() - Date.parse(ingestedAt(i, ARRIVALS.length)) < 86_400_000,
  ).length;
  log("seeded", { transactions: n, ingestedWithin24h: withinDay });

  // ── Daily prices ──────────────────────────────────────────────────────────
  // Enough history for the dip / near-low screens and for forward-return
  // scoring, plus a SPY benchmark series.
  //
  // Each symbol gets its own drift, amplitude and phase. That is not cosmetic:
  // scoring measures EXCESS return over SPY, so a set of series that all move
  // identically produces an excess of ~0 for every trade and a leaderboard of
  // zeroes — arithmetic that is technically honest and demonstrates nothing.
  // Distinct paths make the seeded scores real numbers with real signs, while
  // staying fully deterministic (no Math.random, identical on every run).
  //
  //                symbol      market  base   drift  amp   phase
  const priceSeries = [
    ["ZZNOVA", "US", 19.8, 1.9, 1.6, 0],
    ["ZZHELIO", "US", 40.0, 0.4, 1.1, 13],
    ["ZZORCA", "US", 12.4, 1.3, 2.2, 7],
    ["ZZMERID", "US", 61.0, -0.6, 0.9, 21],
    ["SPY", "US", 560.0, 1.0, 0.3, 5],
  ];
  let priceRows = 0;
  for (const [symbol, market, base, driftMul, amp, phase] of priceSeries) {
    const values = [];
    for (let d = 400; d >= 0; d--) {
      // Deterministic pseudo-wave: reproducible across runs, no Math.random.
      const drift = 1 + (400 - d) * 0.0006 * driftMul;
      const wave =
        1 + Math.sin((d + phase) / 11) * 0.035 * amp + Math.cos((d + phase) / 29) * 0.02 * amp;
      values.push({
        symbol,
        market,
        price_date: day(d),
        close: (base * drift * wave).toFixed(4),
        source: "seed",
      });
    }
    for (let i = 0; i < values.length; i += 200) {
      const chunk = values.slice(i, i + 200);
      await sql`insert into daily_prices ${sql(chunk, "symbol", "market", "price_date", "close", "source")}
                on conflict do nothing`;
      priceRows += chunk.length;
    }
  }
  log("seeded", { dailyPrices: priceRows });

  // ── Congressional disclosures ─────────────────────────────────────────────
  // Obviously fictional filers. A fabricated STOCK Act filing attributed to a
  // real member of Congress would be defamatory the moment it was screenshotted.
  const POLITICIANS = [
    {
      key: "house:zz rep dana quillfeather",
      name: "ZZ Rep. Dana Quillfeather",
      chamber: "house",
      party: "IND",
      state: "ZZ",
      district: "ZZ01",
    },
    {
      key: "senate:zz sen. bramwell fenwick",
      name: "ZZ Sen. Bramwell Fenwick",
      chamber: "senate",
      party: "IND",
      state: "ZZ",
    },
  ];
  const politicianIds = new Map();
  for (const p of POLITICIANS) {
    const [row] = await sql`
      insert into politicians (external_key, name, chamber, party, state, district)
      values (${p.key}, ${p.name}, ${p.chamber}, ${p.party}, ${p.state}, ${p.district ?? null})
      on conflict (external_key) do update set name = excluded.name
      returning id`;
    politicianIds.set(p.key, row.id);
  }

  const PTRS = [
    {
      who: POLITICIANS[0].key,
      co: "ZZNOVA",
      type: "purchase",
      txn: 38,
      disc: 8,
      min: 15001,
      max: 50000,
      label: "$15,001 - $50,000",
    },
    {
      who: POLITICIANS[0].key,
      co: "ZZHELIO",
      type: "sale_full",
      txn: 20,
      disc: 6,
      min: 1001,
      max: 15000,
      label: "$1,001 - $15,000",
    },
    // Filed 61 days after the trade — past the 45-day STOCK Act deadline, so
    // the "late" badge and the late_only filter have something to show.
    {
      who: POLITICIANS[1].key,
      co: "ZZORCA",
      type: "purchase",
      txn: 70,
      disc: 9,
      min: 100001,
      max: 250000,
      label: "$100,001 - $250,000",
    },
    // Open-ended top bracket: max is NULL, and must render as "$50,000,000+".
    {
      who: POLITICIANS[1].key,
      co: "ZZMERID",
      type: "purchase",
      txn: 30,
      disc: 4,
      min: 50000000,
      max: null,
      label: "Over $50,000,000",
    },
  ];
  for (const t of PTRS) {
    await sql`
      insert into politician_trades (politician_id, company_id, ticker, asset_description,
        asset_type, txn_type, txn_date, disclosed_at, amount_min, amount_max, amount_range,
        owner, source, source_url, dedup_key)
      values (${politicianIds.get(t.who)}, ${companyIds.get(t.co)}, ${t.co},
        ${COMPANIES.find((c) => c.key === t.co).name}, 'Stock', ${t.type},
        ${day(t.txn)}, ${day(t.disc)}, ${t.min}, ${t.max}, ${t.label}, 'self',
        'seed-fixture', 'https://example.invalid/seed/ptr.pdf',
        ${`e2e-seed-ptr-${t.co}-${t.txn}-${t.type}#0`})
      on conflict (dedup_key) do nothing`;
  }
  log("seeded", { politicians: politicianIds.size, disclosures: PTRS.length });

  // ── India disclosures (SEBI) ──────────────────────────────────────────────
  //
  // The stock page has three India panels — SAST, bulk/block deals, promoter
  // pledges — and the seed shipped zero rows for all of them, so every panel
  // rendered its empty state and the whole India feature was unprovable from a
  // clean start. "The schema exists" is not the same claim as "the feature
  // works", and only one of them is testable.
  //
  // These are written directly, NOT via the local-scrape runner: the hosted
  // deployment never scrapes NSE/BSE, and neither does `docker compose up`.
  // The exchanges' terms restrict automated access and India IT Act s43
  // creates civil liability for unauthorised access — see
  // ingestion/india-local/README.md. Fixtures are how this path is exercised
  // without touching either.
  const SAST = [
    {
      acquirer: "ZZ Kaveri Holdings Pvt Ltd",
      regulation: "29(2)",
      side: "acquisition",
      shares: 1_250_000,
      pctBefore: 4.86,
      pctAfter: 6.31,
      // Reg 29 requires the SHAREHOLDING to be disclosed, not the consideration.
      // Most filings carry no value at all, and inventing one — say, shares x
      // yesterday's close — would publish a number nobody filed. NULL, and the
      // UI says "not disclosed".
      value: null,
      day: 5,
    },
    {
      acquirer: "ZZ Bharat Promoter Family Trust",
      regulation: "31(1)",
      side: "disposal",
      shares: 400_000,
      pctBefore: 22.4,
      pctAfter: 21.94,
      value: 568_000_000,
      day: 18,
    },
  ];
  for (const d of SAST) {
    await sql`
      insert into sast_disclosures (country, exchange, symbol, company_name, acquirer_name,
        regulation, category, acquisition_mode, side, shares, shares_pct_before, shares_pct_after,
        value, currency, value_usd, txn_date, intimated_at, source_url, dedup_key)
      values ('IN', 'NSE', 'ZZBHARAT', 'ZZ Bharat Industries Ltd.', ${d.acquirer},
        ${d.regulation}, 'Promoter Group', 'Market purchase', ${d.side}, ${d.shares},
        ${d.pctBefore}, ${d.pctAfter}, ${d.value}, 'INR',
        ${d.value === null ? null : (d.value * INR_USD).toFixed(4)},
        ${day(d.day)}, ${day(d.day - 1)},
        'https://example.invalid/seed/sast.pdf',
        ${`e2e-seed-sast-ZZBHARAT-${d.day}-${d.side}#0`})
      on conflict (dedup_key) do nothing`;
  }

  const DEALS = [
    {
      type: "bulk",
      client: "ZZ Sundara Asset Management",
      side: "buy",
      qty: 820_000,
      wap: 1432.5,
      day: 6,
    },
    {
      type: "block",
      client: "ZZ Nilgiri Capital LLP",
      side: "sell",
      qty: 500_000,
      wap: 1418.0,
      day: 14,
    },
  ];
  for (const d of DEALS) {
    const value = d.qty * d.wap;
    await sql`
      insert into bulk_block_deals (country, exchange, deal_type, deal_date, symbol, company_name,
        client_name, side, quantity, wap, value, currency, value_usd, remarks, dedup_key)
      values ('IN', 'NSE', ${d.type}, ${day(d.day)}, 'ZZBHARAT', 'ZZ Bharat Industries Ltd.',
        ${d.client}, ${d.side}, ${d.qty}, ${d.wap}, ${value}, 'INR',
        ${(value * INR_USD).toFixed(4)}, null,
        ${`e2e-seed-deal-ZZBHARAT-${d.day}-${d.side}#0`})
      on conflict (dedup_key) do nothing`;
  }

  const PLEDGES = [
    {
      promoter: "ZZ Bharat Promoter Family Trust",
      event: "pledge",
      shares: 3_000_000,
      pct: 3.42,
      day: 9,
    },
    {
      promoter: "ZZ Bharat Promoter Family Trust",
      event: "revoke",
      shares: 1_100_000,
      pct: 1.25,
      day: 2,
    },
  ];
  for (const p of PLEDGES) {
    await sql`
      insert into pledge_disclosures (country, exchange, symbol, company_name, promoter_name,
        event_type, shares, shares_pct, value, currency, value_usd, event_date, intimated_at,
        source_url, dedup_key)
      values ('IN', 'NSE', 'ZZBHARAT', 'ZZ Bharat Industries Ltd.', ${p.promoter},
        ${p.event}, ${p.shares}, ${p.pct},
        -- A pledge moves no consideration; there is no value to report.
        null, 'INR', null,
        ${day(p.day)}, ${day(Math.max(0, p.day - 1))},
        'https://example.invalid/seed/pledge.pdf',
        ${`e2e-seed-pledge-ZZBHARAT-${p.day}-${p.event}#0`})
      on conflict (dedup_key) do nothing`;
  }
  log("seeded", { sast: SAST.length, deals: DEALS.length, pledges: PLEDGES.length });

  // ── Scanner row ───────────────────────────────────────────────────────────
  await sql`insert into scanner_state (name) values ('alerts') on conflict do nothing`;

  const [counts] = await sql`
    select (select count(*) from companies)         as companies,
           (select count(*) from transactions)      as transactions,
           (select count(*) from daily_prices)      as prices,
           (select count(*) from politician_trades) as ptrs`;

  log("seed_complete", {
    companies: Number(counts.companies),
    transactions: Number(counts.transactions),
    dailyPrices: Number(counts.prices),
    politicianTrades: Number(counts.ptrs),
    note: "All seeded rows are synthetic (ZZ* namespace). Run analytics to populate clusters/scores.",
  });
} catch (error) {
  log("seed_failed", { message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
