import { classifyTransaction, SEC_TRANSACTION_CODES } from "@insiderflow/core";

const FEATURED_CODES = ["P", "S", "M", "A", "F", "G"] as const;

const DIRECTION_STYLES = {
  buy: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30",
  sell: "bg-rose-500/10 text-rose-400 ring-rose-500/30",
  neutral: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/30",
} as const;

export default function Home() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-16 px-6 py-16">
      <div
        role="alert"
        className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300"
      >
        <strong className="font-semibold">Not investment advice.</strong> InsiderFlow republishes
        public regulatory filings for research and education only. Filings can be late, amended, or
        wrong. Do your own research.
      </div>

      <section className="flex flex-col gap-4">
        <p className="text-sm font-medium uppercase tracking-widest text-emerald-400">
          Open source · AGPL-3.0
        </p>
        <h1 className="text-5xl font-bold tracking-tight">InsiderFlow</h1>
        <p className="max-w-2xl text-lg text-zinc-400">
          A real-time, multi-market insider-trading tracker. Watch what executives and directors
          actually do with their own money — starting with SEC EDGAR Form 4 filings, normalized into
          one clean schema.
        </p>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        {[
          {
            title: "Real-time ingestion",
            body: "A Cloudflare Worker polls SEC EDGAR on a cron schedule and normalizes new Form 4 filings within minutes.",
          },
          {
            title: "Multi-market schema",
            body: "One canonical model for companies, insiders, filings, and transactions — designed to add more markets later.",
          },
          {
            title: "Alerts",
            body: "Email (Resend) and Telegram alerts for the insiders, tickers, and transaction types you follow.",
          },
        ].map((feature) => (
          <div key={feature.title} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h2 className="mb-2 font-semibold">{feature.title}</h2>
            <p className="text-sm leading-relaxed text-zinc-400">{feature.body}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">Form 4 transaction codes</h2>
        <p className="text-sm text-zinc-400">
          Every transaction is classified from its SEC code. A few of the {""}
          {Object.keys(SEC_TRANSACTION_CODES).length} codes we track:
        </p>
        <ul className="flex flex-col gap-2">
          {FEATURED_CODES.map((code) => {
            const direction = classifyTransaction(code);
            return (
              <li
                key={code}
                className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3"
              >
                <span className="w-6 text-center font-mono text-lg font-bold">{code}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${DIRECTION_STYLES[direction]}`}
                >
                  {direction}
                </span>
                <span className="text-sm text-zinc-400">{SEC_TRANSACTION_CODES[code]}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <footer className="flex flex-col gap-3 border-t border-zinc-800 pt-8 text-xs leading-relaxed text-zinc-500">
        <p>
          <strong className="text-zinc-400">Data sources:</strong> US data is sourced from SEC
          EDGAR, a US-government service whose filings are in the public domain; access follows the
          SEC fair-access policy. NSE/BSE (India) data is subject to restrictive exchange terms and
          is not redistributed by this project.
        </p>
        <p>
          InsiderFlow is free software licensed under AGPL-3.0. Nothing on this site is investment
          advice or a recommendation to buy or sell any security.
        </p>
      </footer>
    </main>
  );
}
