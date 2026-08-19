#!/usr/bin/env node
/**
 * REFUSE TO RUN MIGRATIONS THROUGH A TRANSACTION POOLER.
 *
 * Supabase publishes three ways into the same database, and only two of them
 * can run DDL. The difference is invisible in the connection string except for
 * one number, and choosing wrong does not fail — it HANGS, which is the worst
 * available outcome inside a deploy pipeline with an approval gate behind it.
 *
 *   direct        db.<ref>.supabase.co:5432          session mode, DDL fine,
 *                                                    but IPv6-ONLY without the
 *                                                    IPv4 add-on — and GitHub
 *                                                    Actions runners are IPv4,
 *                                                    so from CI this is a
 *                                                    connection timeout.
 *   session pool  aws-N-<region>.pooler.supabase.com:5432
 *                                                    session mode, IPv4. This
 *                                                    is what migrations use.
 *   transaction   aws-N-<region>.pooler.supabase.com:6543
 *   pool                                             TRANSACTION mode only
 *                                                    since 2025-02-28. Holds no
 *                                                    session state, so
 *                                                    drizzle-kit migrate and
 *                                                    `db push` HANG rather than
 *                                                    error. Correct for the
 *                                                    runtime web app, wrong
 *                                                    here.
 *
 * So this asserts the shape before the migration step gets a chance to hang,
 * and it prints the PORT and the HOST SHAPE and nothing else — the string it
 * is reading is an admin credential and this output goes to a public run log.
 *
 * Usage: node scripts/assert-session-pooler.mjs [ENV_VAR_NAME]
 *        (default DATABASE_URL)
 */

const name = process.argv[2] ?? "DATABASE_URL";
const raw = process.env[name];

const fail = (title, ...lines) => {
  console.error(`\n${title}\n`);
  for (const line of lines) console.error(`  ${line}`);
  console.error("");
  process.exit(1);
};

if (!raw || raw.trim() === "") {
  fail(
    `${name} IS NOT SET`,
    "The migration step has nothing to connect to. Set it as a repository",
    "secret — see DEPLOY.md, 'Where every secret goes'.",
  );
}

let url;
try {
  url = new URL(raw.trim());
} catch {
  // Deliberately does not echo the value: a malformed connection string is
  // still a credential, and a paste error usually keeps the password intact.
  fail(
    `${name} IS NOT A URL`,
    "It could not be parsed. Check for a stray quote, a newline, or a copied",
    "shell prompt. The value is not printed here on purpose.",
  );
}

if (!/^postgres(ql)?:$/.test(url.protocol)) {
  fail(
    `${name} IS NOT A POSTGRES URL`,
    `Scheme is "${url.protocol}", expected postgres: or postgresql:`,
  );
}

/** 5432 when absent, which is what libpq assumes too. */
const port = url.port === "" ? "5432" : url.port;
const host = url.hostname;
const isSupabasePooler = /\.pooler\.supabase\.com$/i.test(host);
const isSupabaseDirect = /^db\.[a-z0-9]+\.supabase\.co$/i.test(host);

/** Host SHAPE, never the host itself — the subdomain is the project ref. */
const shape = isSupabasePooler
  ? "supabase pooler"
  : isSupabaseDirect
    ? "supabase direct"
    : "other/self-hosted";

console.log(`${name}: port ${port}, host shape "${shape}"`);

if (port === "6543") {
  fail(
    "MIGRATIONS CANNOT RUN THROUGH THE TRANSACTION POOLER",
    `${name} points at port 6543, which has been transaction-mode-only since`,
    "2025-02-28. drizzle-kit migrate does not error there — it HANGS, and a",
    "pipeline that hangs after an approval gate is worse than one that fails.",
    "",
    "Use the SESSION pooler: the same hostname, port 5432.",
    "  Supabase dashboard -> Connect -> Session pooler",
    "",
    "The RUNTIME app keeps using 6543 with prepare:false. That is correct and",
    "is a different variable: APP_DATABASE_URL, set in Vercel. See DEPLOY.md.",
  );
}

if (isSupabaseDirect) {
  // Not fatal: a project with the IPv4 add-on reaches this fine, and a
  // developer running the same command from a v6-capable network reaches it
  // too. But from an Actions runner it is a timeout with no explanation, so
  // say so here rather than let it be diagnosed at 2am.
  console.log(
    "\nNOTE — this is the DIRECT connection, which is IPv6-only unless the\n" +
      "  project has the IPv4 add-on (~$4/mo). GitHub Actions runners are IPv4,\n" +
      "  so from CI this will time out rather than refuse. The session pooler\n" +
      "  (aws-N-<region>.pooler.supabase.com:5432) is the free path.\n",
  );
}

if (port !== "5432") {
  console.log(
    `\nNOTE — port ${port} is neither 5432 nor 6543. Assuming it is session-capable;\n` +
      "  if migrations hang, this is the first thing to check.\n",
  );
}

console.log("session-capable connection: OK");
