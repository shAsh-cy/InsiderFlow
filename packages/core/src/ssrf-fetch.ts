/**
 * The enforcing half of the outbound guard — Node only.
 *
 * `ssrf.ts` decides; this connects. It is a separate module because it
 * imports `node:dns` and `node:https`, neither of which exists in the
 * Cloudflare Worker runtime, and because `packages/core`'s entry point is
 * imported BY that Worker. Nothing here is re-exported from `index.ts`:
 * importing this file is a deliberate act by a Node process.
 *
 * ── WHY A URL CHECK ALONE IS NOT ENOUGH ───────────────────────────────
 *
 * `checkOutboundUrl` proves the HOST is one somebody listed. It cannot
 * prove anything about the ADDRESS, because the address does not exist
 * until DNS is asked — and between asking and connecting, the answer can
 * change. That gap is DNS rebinding, and it is not exotic: a name whose
 * record has a one-second TTL and alternates between a public address and
 * 169.254.169.254 defeats every validate-then-fetch implementation, because
 * the validation resolves the name once and the HTTP client resolves it
 * again a moment later.
 *
 * The fix is not to validate harder before the fetch. It is to validate
 * the address the socket is actually about to use, which is what
 * `guardedLookup` does: it is handed to `https.request` as its `lookup`
 * option, so it sits between the resolver and `net.connect`, and there is
 * no second resolution afterwards for an attacker to win.
 *
 * ── WHY NOT fetch() ───────────────────────────────────────────────────
 *
 * `fetch` in Node is undici, and undici only accepts a custom resolver
 * through a `Dispatcher`, which is not exported by any `node:` module —
 * it would mean taking undici as a direct dependency to reach an API this
 * repo otherwise never touches. `https.request` takes `lookup` directly
 * and passes it to `net.connect`, and its `servername` for TLS is still
 * derived from the hostname, so certificates verify against the NAME the
 * caller asked for even though the socket goes to a pinned address. That
 * property is what makes address pinning safe to do here at all.
 */
import { lookup as defaultLookup } from "node:dns";
import type { LookupAddress, LookupOptions } from "node:dns";
import { request as defaultRequest } from "node:https";
import type { RequestOptions } from "node:https";

import { OUTBOUND_ALLOWLIST, checkOutboundUrl, classifyAddress } from "./ssrf";
import type { FetchLikeResponse } from "./http";

/**
 * A refusal, distinguishable from a network fault.
 *
 * Callers log ingestion failures and move on; a refusal is a
 * configuration or attack signal and should read differently in a log
 * from "the upstream was down".
 */
export class OutboundRefusedError extends Error {
  constructor(
    readonly url: string,
    readonly refusalReason: string,
  ) {
    super(`outbound request refused: ${refusalReason} (${url})`);
    this.name = "OutboundRefusedError";
  }
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

export type LookupFn = (hostname: string, options: LookupOptions, callback: LookupCallback) => void;

/**
 * A `lookup` for `https.request` that refuses to hand back an address we
 * will not talk to.
 *
 * ── ALL OR NOTHING ────────────────────────────────────────────────────
 *
 * Every address the resolver returns is checked, and ONE blocked address
 * refuses the whole request. Filtering to the acceptable subset instead
 * would be the obvious thing and would be wrong: a name that answers with
 * both a public address and 127.0.0.1 is either compromised or
 * misconfigured, and quietly using the half that passes means the
 * operator never learns which. It also removes the attacker's cheapest
 * move, which is to return several addresses and let retry logic find the
 * one that works.
 */
export function guardedLookup(resolver: typeof defaultLookup = defaultLookup): LookupFn {
  return (hostname, options, callback) => {
    // `all: true` regardless of what the caller asked for, because the
    // decision above needs every answer. The shape is converted back at
    // the end so `net.connect` gets what it expects.
    resolver(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) {
        callback(err, "");
        return;
      }
      const resolved = addresses as LookupAddress[];
      if (resolved.length === 0) {
        callback(Object.assign(new Error(`no address for ${hostname}`), { code: "ENOTFOUND" }), "");
        return;
      }
      for (const entry of resolved) {
        const verdict = classifyAddress(entry.address);
        if (verdict.blocked) {
          callback(
            Object.assign(
              new OutboundRefusedError(
                hostname,
                `${hostname} resolves to ${entry.address} (${verdict.reason})`,
              ),
              { code: "EOUTBOUNDREFUSED" },
            ),
            "",
          );
          return;
        }
      }
      if (options.all === true) {
        callback(null, resolved);
        return;
      }
      const [first] = resolved;
      // Unreachable — the empty case returned above — but written as a
      // guard rather than a `!` so that a future edit to the empty check
      // cannot turn this into `undefined.address` at connect time.
      if (!first) {
        callback(Object.assign(new Error(`no address for ${hostname}`), { code: "ENOTFOUND" }), "");
        return;
      }
      callback(null, first.address, first.family);
    });
  };
}

/**
 * Where a redirect wants to go, judged by the same rules as the first hop.
 *
 * This is the half of redirect handling that is worth testing on its own,
 * and the half that is usually missing: an implementation that validates
 * the URL it was given and then lets its HTTP client follow redirects has
 * validated nothing at all, because the upstream chooses the second hop.
 * `https.request` does not follow redirects, so the choice is ours to
 * make explicitly.
 *
 * Returns null when the response is not a redirect.
 */
export function redirectTarget(
  current: URL,
  status: number,
  location: string | null,
  allowedHosts: readonly string[],
): null | { allowed: true; url: URL } | { allowed: false; reason: string } {
  if (status < 300 || status > 399) return null;
  if (!location) return { allowed: false, reason: `${status} with no Location header` };
  let next: URL;
  try {
    // Resolved against the CURRENT url, so a relative Location works and
    // a protocol-relative one (`//evil.example/x`) is resolved to https —
    // and then judged, rather than being mistaken for a path.
    next = new URL(location, current);
  } catch {
    return { allowed: false, reason: `unparseable Location: ${location}` };
  }
  return checkOutboundUrl(next.toString(), allowedHosts);
}

export interface GuardedFetchOptions {
  /** Hosts this fetcher may reach. Defaults to the shared upstream list. */
  allowedHosts?: readonly string[];
  /** Redirect hops permitted before refusing. */
  maxRedirects?: number;
  /** Per-hop socket timeout. */
  timeoutMs?: number;
  /** Body ceiling, so a hostile upstream cannot exhaust memory. */
  maxBytes?: number;
  /** Seam: the resolver `guardedLookup` wraps. */
  resolver?: typeof defaultLookup;
  /** Seam: the transport. Defaults to `node:https.request`. */
  transport?: typeof defaultRequest;
}

/**
 * `FetchLikeResponse` plus `getSetCookie`, which the NSE session needs to
 * carry its priming cookies. Declared rather than bolted on so the extra
 * method is part of the type a caller sees, and so this stays assignable
 * to the plain `FetchLike` every adapter takes.
 */
export interface GuardedResponse extends FetchLikeResponse {
  headers: { get(name: string): string | null; getSetCookie: () => string[] };
}

export type GuardedFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<GuardedResponse>;

/**
 * A `FetchLike` that refuses anything the guard does not allow.
 *
 * Shaped as `FetchLike` on purpose: every adapter in this repo already
 * takes one, so wiring the guard in is a change at the call site that
 * builds the adapter context, and an adapter cannot opt out of it.
 */
export function createGuardedFetch(options: GuardedFetchOptions = {}): GuardedFetch {
  const allowedHosts = options.allowedHosts ?? OUTBOUND_ALLOWLIST;
  const maxRedirects = options.maxRedirects ?? 3;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  const transport = options.transport ?? defaultRequest;
  const lookup = guardedLookup(options.resolver ?? defaultLookup);

  return async function guardedFetch(rawUrl, init) {
    const first = checkOutboundUrl(rawUrl, allowedHosts);
    if (!first.allowed) throw new OutboundRefusedError(rawUrl, first.reason);

    let current = first.url;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const response = await requestOnce(current, init?.headers ?? {});
      const target = redirectTarget(
        current,
        response.status,
        response.headers.get("location"),
        allowedHosts,
      );
      if (target === null) return response;
      if (!target.allowed) {
        throw new OutboundRefusedError(current.toString(), `redirect refused: ${target.reason}`);
      }
      current = target.url;
    }
    throw new OutboundRefusedError(current.toString(), `more than ${maxRedirects} redirects`);
  };

  function requestOnce(url: URL, headers: Record<string, string>): Promise<GuardedResponse> {
    return new Promise((resolve, reject) => {
      const requestOptions: RequestOptions = {
        method: "GET",
        headers,
        // The whole point of this module. `net.connect` calls it with the
        // hostname, and whatever it returns is the address the socket
        // uses — there is no later resolution to race.
        lookup: lookup as RequestOptions["lookup"],
        // Belt and braces with `checkOutboundUrl`'s port rule.
        servername: url.hostname,
      };
      const req = transport(url, requestOptions, (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            res.destroy();
            reject(new OutboundRefusedError(url.toString(), `response exceeded ${maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers: {
              get(name: string): string | null {
                const value = res.headers[name.toLowerCase()];
                if (value === undefined) return null;
                return Array.isArray(value) ? value.join(", ") : value;
              },
              // Kept separate from `get` because joining Set-Cookie on a
              // comma is lossy — `Expires=Mon, 01 Jan 2035` contains one.
              getSetCookie(): string[] {
                const raw = res.headers["set-cookie"];
                if (raw === undefined) return [];
                return Array.isArray(raw) ? raw : [raw];
              },
            },
            text: () => Promise.resolve(body),
          });
        });
        res.on("error", reject);
      });
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`outbound request timed out after ${timeoutMs}ms`));
      });
      req.on("error", reject);
      req.end();
    });
  }
}
