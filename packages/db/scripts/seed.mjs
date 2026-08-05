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
 *   DATABASE_URL=... pnpm --filter @insiderflow/db seed -- --reset
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
    price: 0,
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
    await sql`delete from daily_prices where symbol like 'ZZ%'`;
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
    on conflict (accession_no) do update set form_type = excluded.form_type
    returning id`;
  const [amendment] = await sql`
    insert into filings (accession_no, form_type, filed_at, issuer_company_id, source_url)
    values ('e2e-seed-0000000002', '4/A', now() - interval '1 day',
            ${companyIds.get("ZZHELIO")}, 'https://example.invalid/seed/amendment')
    on conflict (accession_no) do update set form_type = excluded.form_type
    returning id`;
  await sql`
    update filings set superseded_by_filing_id = ${amendment.id} where id = ${original.id}`;
  log("seeded", { filings: 2, amendment: true });

  // ── Transactions ──────────────────────────────────────────────────────────
  let n = 0;
  for (const t of TRADES) {
    const ccy = t.ccy ?? "USD";
    const value = t.shares * t.price;
    const priceUsd = ccy === "INR" ? t.price * INR_USD : t.price;
    const valueUsd = ccy === "INR" ? value * INR_USD : value;
    const country = COMPANIES.find((c) => c.key === t.co).country;
    await sql`
      insert into transactions (source, insider_id, company_id, txn_date, code, shares, price,
        value, currency, price_usd, value_usd, acquired_disposed, is_10b5_1, is_derivative,
        relevance, dedup_key, country)
      values ('edgar', ${insiderIds.get(t.who)}, ${companyIds.get(t.co)}, ${day(t.day)},
        ${t.code}, ${t.shares}, ${t.price}, ${value}, ${ccy}, ${priceUsd}, ${valueUsd},
        ${["P", "A", "M"].includes(t.code) ? "A" : "D"}, false, false,
        ${t.routine ? "routine" : "opportunistic"},
        ${`e2e-seed-${t.co}-${t.who.replaceAll(" ", "")}-${t.day}-${t.code}#0`}, ${country})
      on conflict (dedup_key) do nothing`;
    n++;
  }
  log("seeded", { transactions: n });

  // ── Daily prices ──────────────────────────────────────────────────────────
  // Enough history for the dip / near-low screens and for forward-return
  // scoring, plus a SPY benchmark series.
  const priceSeries = [
    ["ZZNOVA", "US", 19.8],
    ["ZZHELIO", "US", 40.0],
    ["ZZORCA", "US", 12.4],
    ["ZZMERID", "US", 61.0],
    ["SPY", "US", 560.0],
  ];
  let priceRows = 0;
  for (const [symbol, market, base] of priceSeries) {
    const values = [];
    for (let d = 400; d >= 0; d--) {
      // Deterministic pseudo-wave: reproducible across runs, no Math.random.
      const drift = 1 + (400 - d) * 0.0006;
      const wave = 1 + Math.sin(d / 11) * 0.035 + Math.cos(d / 29) * 0.02;
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
