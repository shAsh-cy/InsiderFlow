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
      <header className="rail-bleed flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Companies</h1>
        <p className="max-w-[68ch] text-sm text-ink-muted">
          Every company with tracked insider activity, US and India.
        </p>
      </header>

      {/* Plain GET form — search works with zero client JS. */}
      <form
        method="get"
        role="search"
        className="surface flex h-11 max-w-md items-center gap-2 rounded-md px-3 md:h-10"
      >
        <Search className="size-4 text-ink-faint" aria-hidden />
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by name or ticker…"
          aria-label="Search companies"
          className="h-full min-h-11 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint md:min-h-0"
        />
      </form>

      {hits.length === 0 ? (
        <p className="surface rounded-lg px-4 py-8 text-center text-sm text-ink-muted">
          {q
            ? `No companies match “${q}”.`
            : "No companies tracked yet — the ingestion worker fills this in."}
        </p>
      ) : (
        // One surface, hairline-separated rows: a directory reads as a list,
        // and a card per company would put a border around every name.
        <ul className="surface overflow-hidden rounded-lg">
          {hits.map((hit) => (
            <li key={hit.id} className="border-b border-border last:border-b-0">
              <Link
                href={hit.ticker ? `/stock/${hit.ticker}` : "#"}
                aria-disabled={!hit.ticker}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-fill"
              >
                <CountryFlag country={hit.country} />
                <span className="num w-24 shrink-0 text-xs font-semibold text-ink">
                  {hit.ticker ?? "—"}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">{hit.name}</span>
                <span className="num text-2xs text-ink-faint">{hit.trades} trades</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
