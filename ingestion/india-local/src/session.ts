/**
 * NSE session with cookie priming. Verified live 2026-08-02:
 *  - the NSE homepage returns 403 to non-browser clients, but the
 *    corporate-filings LISTING page returns 200 and sets the cookies;
 *  - without valid cookies the APIs answer 200 with empty data rather than
 *    erroring, so a real browser-grade session matters.
 *
 * An empty payload is therefore AMBIGUOUS by construction, and r16 showed
 * how expensive that is: `corporates-pit` returned an empty envelope for
 * three rounds and it was read as a session or IP problem the whole time.
 * It was neither — the endpoint is retired. When a payload comes back
 * empty, check whether a SIBLING endpoint on the same session returns rows
 * before concluding anything about the connection.
 *
 * Rate limit: one shared limiter across priming and API calls keeps the
 * whole session at ≤3 req/s (350ms spacing ≈ 2.86 req/s).
 */
import { NSE_PRIME_URL } from "@insiderflow/core";
import { jsonLogger, RateLimiter } from "@insiderflow/edgar-worker/http";
import type { Logger } from "@insiderflow/edgar-worker/http";

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": BROWSER_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Minimal structural response — native fetch satisfies it; tests mock it. */
export interface SessionResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null; getSetCookie?: () => string[] };
  text(): Promise<string>;
}

export type SessionFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<SessionResponse>;

export class NseSession {
  private readonly cookies = new Map<string, string>();
  /** Exposed for tests and the smoke report. */
  primeCount = 0;

  constructor(
    private readonly fetchFn: SessionFetch = fetch as unknown as SessionFetch,
    private readonly limiter: RateLimiter = new RateLimiter(350),
    private readonly log: Logger = jsonLogger,
  ) {}

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private storeCookies(response: SessionResponse): void {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const pair = raw.split(";")[0];
      const eq = pair?.indexOf("=") ?? -1;
      if (pair && eq > 0) {
        this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    }
  }

  async prime(): Promise<void> {
    await this.limiter.wait();
    const response = await this.fetchFn(NSE_PRIME_URL, { headers: BROWSER_HEADERS });
    this.storeCookies(response);
    this.primeCount++;
    this.log("nse_session_primed", {
      status: response.status,
      cookies: this.cookies.size,
      primeCount: this.primeCount,
    });
    if (!response.ok) {
      // Typical for datacenter IPs — run this module from a residential
      // connection (see README). We continue; some endpoints still answer.
      this.log("nse_prime_blocked", { status: response.status });
    }
  }

  private async request(url: string, referer: string): Promise<SessionResponse> {
    await this.limiter.wait();
    return this.fetchFn(url, {
      headers: {
        ...BROWSER_HEADERS,
        Accept: "*/*",
        Referer: referer,
        Cookie: this.cookieHeader(),
      },
    });
  }

  /**
   * GET a document body, same session and same limiter.
   *
   * PIT filings are XBRL, and since PIT V2.0 the index and the trades are
   * two different fetches. Routing the second through here rather than a
   * bare `fetch` is what keeps one index of 169 filings inside the ≤3 req/s
   * budget the whole module promises NSE.
   */
  async getText(url: string, referer: string): Promise<string> {
    if (this.cookies.size === 0) await this.prime();
    let response = await this.request(url, referer);
    if (response.status === 401 || response.status === 403) {
      this.log("nse_session_reprime", { url, status: response.status });
      this.cookies.clear();
      await this.prime();
      response = await this.request(url, referer);
    }
    if (!response.ok) {
      throw new Error(`NSE responded ${response.status} for ${url}`);
    }
    return response.text();
  }

  /** GET JSON with automatic cookie priming and one re-prime on 401/403. */
  async getJson<T>(url: string, referer: string): Promise<T> {
    if (this.cookies.size === 0) await this.prime();
    let response = await this.request(url, referer);
    if (response.status === 401 || response.status === 403) {
      this.log("nse_session_reprime", { url, status: response.status });
      this.cookies.clear();
      await this.prime();
      response = await this.request(url, referer);
    }
    if (!response.ok) {
      throw new Error(`NSE responded ${response.status} for ${url}`);
    }
    const body = await response.text();
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new Error(`NSE returned non-JSON for ${url}: ${body.slice(0, 80)}`);
    }
  }
}
