import { parseAccessionNumbersFromAtom } from "./parse";

export interface Env {
  /** Required by the SEC fair-access policy, e.g. "InsiderFlow/0.1 (you@example.com)". */
  EDGAR_USER_AGENT: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
}

/** Latest Form 4 filings, newest first. Poll at most every 10 minutes; stay under SEC rate limits. */
const EDGAR_CURRENT_FORM4_ATOM =
  "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&owner=include&count=100&output=atom";

async function ingestLatestForm4Filings(env: Env): Promise<string[]> {
  const response = await fetch(EDGAR_CURRENT_FORM4_ATOM, {
    headers: {
      "User-Agent": env.EDGAR_USER_AGENT,
      "Accept-Encoding": "gzip, deflate",
      Host: "www.sec.gov",
    },
  });
  if (!response.ok) {
    throw new Error(`EDGAR responded ${response.status}`);
  }

  const atom = await response.text();
  const accessionNumbers = parseAccessionNumbersFromAtom(atom);

  // TODO(ingestion): for each new accession number, fetch the Form 4 XML,
  // normalize it with @insiderflow/core, and upsert via @insiderflow/db
  // (Supabase transaction pooler; Workers free tier has no raw TCP, so use
  // the Supabase REST endpoint or a pooler-compatible HTTP driver).
  console.log(`edgar-worker: found ${accessionNumbers.length} recent Form 4 accession numbers`);
  return accessionNumbers;
}

export default {
  async scheduled(event, env, ctx): Promise<void> {
    console.log(`edgar-worker: cron ${event.cron} fired`);
    ctx.waitUntil(ingestLatestForm4Filings(env));
  },

  // Health check endpoint.
  async fetch(): Promise<Response> {
    return Response.json({ service: "insiderflow-edgar-worker", status: "ok" });
  },
} satisfies ExportedHandler<Env>;
