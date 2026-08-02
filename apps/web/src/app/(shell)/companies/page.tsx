import { Search } from "lucide-react";
import Link from "next/link";

import { CountryFlag } from "@/components/domain/country-flag";
import { flattenSearchParams } from "@/lib/api/search-params";
import type { NextSearchParams } from "@/lib/api/search-params";
import { searchCompanies } from "@/lib/api/page-queries";
import { getDb } from "@/lib/db";

export const metadata = { title: "Companies" };

/** Searchable directory (pg_trgm name/ticker search, shared query layer). */
export default async function CompaniesPage({ searchParams }: { searchParams: NextSearchParams }) {
  const q = flattenSearchParams(await searchParams).q?.slice(0, 64);
  const hits = await searchCompanies(getDb(), q).catch(() => []);

  return (
    <div className="flex flex-col gap-6 pb-24">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Companies</h1>
        <p className="text-sm text-muted-foreground">
          Every company with tracked insider activity, US and India.
        </p>
      </header>

      {/* Plain GET form — search works with zero client JS. */}
      <form
        method="get"
        role="search"
        className="glass flex h-10 max-w-md items-center gap-2 rounded-lg px-3"
      >
        <Search className="size-4 text-subtle-foreground" aria-hidden />
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by name or ticker…"
          aria-label="Search companies"
          className="h-full w-full bg-transparent text-sm outline-none placeholder:text-subtle-foreground"
        />
      </form>

      {hits.length === 0 ? (
        <p className="glass rounded-lg px-4 py-8 text-center text-sm text-muted-foreground">
          {q
            ? `No companies match “${q}”.`
            : "No companies tracked yet — the ingestion worker fills this in."}
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {hits.map((hit) => (
            <li key={hit.id}>
              <Link
                href={hit.ticker ? `/stock/${hit.ticker}` : "#"}
                aria-disabled={!hit.ticker}
                className="glass flex items-center gap-3 rounded-lg px-4 py-3 transition-all hover:-translate-y-0.5 hover:shadow-lift"
              >
                <CountryFlag country={hit.country} />
                <span className="font-mono text-xs font-semibold">{hit.ticker ?? "—"}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                  {hit.name}
                </span>
                <span className="tnum text-2xs text-subtle-foreground">{hit.trades} trades</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
