/**
 * Outbound request guard — OWASP 2025 A01 (Broken Access Control, which
 * absorbed the old A10 Server-Side Request Forgery category).
 *
 * ── WHAT THIS SERVICE ACTUALLY EXPOSES ────────────────────────────────
 *
 * Nothing here fetches a URL a visitor typed. The surface is narrower and
 * more ordinary than that, which is exactly why it is worth writing down:
 *
 *   - `INDIA_FEED_URL` is fetched server-side and is set by whoever
 *     deploys, not by whoever visits;
 *   - `UPSTASH_REDIS_REST_URL` is called on every rate-limit check;
 *   - `--house-url` / `--senate-url` override the politician feed
 *     constants from the ingestion CLI;
 *   - the NSE/BSE scraper builds URLs from date arguments.
 *
 * An operator pointing one of those at `http://169.254.169.254/latest/
 * meta-data/iam/security-credentials/` is not an attack, it is a typo with
 * a very bad blast radius: the process would fetch the cloud instance's
 * role credentials and write them into an ingestion log. The same is true
 * of a compromised or expired upstream domain that starts resolving to a
 * private address, which no amount of care in choosing the URL prevents.
 *
 * So the guard is deliberately NOT "validate what the user typed". It is:
 * every outbound request this codebase makes goes to a host somebody
 * listed, over TLS, at an address that is routable on the public
 * internet — checked against the address actually connected to.
 *
 * ── THE DECISION IS PURE; THE ENFORCEMENT IS NOT ──────────────────────
 *
 * This module has no I/O. It answers "may this URL be fetched?" and "is
 * this address one we refuse to talk to?", and it is unit-tested as a
 * function of its inputs — including the address forms that exist only to
 * defeat string matching. `ssrf-fetch.ts` does the DNS, the connecting
 * and the redirect following, and calls back in here for every decision.
 *
 * That split is also what keeps this file usable in the Cloudflare Worker,
 * which has no `node:dns` and no socket API: the Worker gets the URL
 * check, the Node processes get the URL check AND connect-time address
 * pinning.
 */

/** A decision, with the reason attached so a refusal can be logged. */
export type OutboundDecision = { allowed: true; url: URL } | { allowed: false; reason: string };

/**
 * IPv4 ranges that are never a legitimate upstream.
 *
 * Written as [dotted-quad base, prefix length] and compared numerically,
 * because prefix comparison on strings is the bug: "10.0.0.1".startsWith
 * ("10.") also matches "10.0.0.1.evil.example" as a hostname, and misses
 * the same address written as 167772161.
 */
const BLOCKED_IPV4: ReadonlyArray<readonly [string, number, string]> = [
  ["0.0.0.0", 8, "this-network / unspecified"],
  ["10.0.0.0", 8, "RFC 1918 private"],
  ["100.64.0.0", 10, "RFC 6598 carrier-grade NAT"],
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "RFC 3927 link-local — includes the cloud metadata service"],
  ["172.16.0.0", 12, "RFC 1918 private"],
  ["192.0.0.0", 24, "IETF protocol assignments — includes 192.0.0.192, Oracle metadata"],
  ["192.0.2.0", 24, "TEST-NET-1"],
  ["192.88.99.0", 24, "6to4 relay anycast"],
  ["192.168.0.0", 16, "RFC 1918 private"],
  ["198.18.0.0", 15, "benchmarking"],
  ["198.51.100.0", 24, "TEST-NET-2"],
  ["203.0.113.0", 24, "TEST-NET-3"],
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "reserved — includes 255.255.255.255 broadcast"],
];

/**
 * Metadata endpoints that are NOT inside the ranges above, named
 * individually because each is a live credential vending machine.
 *
 * 169.254.169.254 (AWS/GCP/Azure/DO) and 192.0.0.192 (Oracle) are already
 * covered by link-local and protocol-assignments; they are named in those
 * reasons rather than repeated here.
 *
 * The two below are ALSO covered — 100.100.100.200 sits inside the
 * carrier-grade NAT /10 and fd00:ec2::254 inside the unique-local /7 — so
 * this list opens no hole if someone deletes it, and the test asserts
 * that. It exists so that a refusal names the thing it refused. "Alibaba
 * Cloud metadata" in a log tells an operator what they misconfigured;
 * "RFC 6598 carrier-grade NAT" leaves them to work it out.
 */
const BLOCKED_METADATA_HOSTS: ReadonlyArray<readonly [string, string]> = [
  ["100.100.100.200", "Alibaba Cloud metadata"],
  ["fd00:ec2::254", "AWS IMDS over IPv6"],
];

/**
 * IPv6 prefixes, as [first-hextets, prefix length].
 *
 * The three embedded-IPv4 prefixes are NOT here — ::ffff:0:0/96,
 * 64:ff9b::/96 and 2002::/16 carry a v4 address inside them, so they are
 * unwrapped and re-checked against the v4 table instead. Blocking them
 * outright would refuse legitimate NAT64 traffic; letting them through
 * unwrapped is how `::ffff:169.254.169.254` reaches the metadata service.
 */
const BLOCKED_IPV6: ReadonlyArray<readonly [string, number, string]> = [
  ["::", 128, "unspecified"],
  ["::1", 128, "loopback"],
  ["100::", 64, "RFC 6666 discard-only"],
  ["2001:db8::", 32, "documentation"],
  ["fc00::", 7, "RFC 4193 unique-local"],
  ["fe80::", 10, "link-local"],
  ["ff00::", 8, "multicast"],
];

/** Dotted quad → 32-bit integer, or null if it is not one. */
function ipv4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    // Leading zeros are rejected rather than parsed. `010` is 8 to an
    // `inet_aton`-style resolver and 10 to `Number`, and a value whose
    // meaning depends on who reads it has no business in an allow/deny
    // decision. The URL parser has already normalised the forms that
    // reach us from a real URL — `http://0177.0.0.1/` arrives here as
    // 127.0.0.1 — so this only rejects hand-built strings.
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith("0"))) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function inIpv4Range(address: number, base: string, prefix: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  // `>>> 0` and division rather than `<<`: JS bitwise operators are
  // signed 32-bit, so a /8 mask built with `-1 << 24` on 240.0.0.0
  // compares as a negative number and silently never matches.
  const size = 2 ** (32 - prefix);
  return address >= baseInt && address < baseInt + size;
}

/**
 * IPv6 text → eight 16-bit groups, or null.
 *
 * Handles `::` compression and a trailing dotted-quad (`::ffff:127.0.0.1`).
 * Node hands us both forms: `dns.lookup` returns `::ffff:127.0.0.1` while
 * the WHATWG URL parser normalises the same address to `::ffff:7f00:1`.
 */
function ipv6ToGroups(address: string): number[] | null {
  let text = address.trim();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  // A zone index (`fe80::1%eth0`) names an interface, which is a local
  // concept — strip it and judge the address.
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  if (text.length === 0 || !/^[0-9a-fA-F:.]+$/.test(text)) return null;

  // A trailing dotted quad becomes the two hex groups it stands for, so
  // the compression logic below has exactly one form to handle. Doing it
  // the other way — parsing the tail separately and stitching it back on
  // — is what broke `64:ff9b::169.254.169.254`, where the `::` and the
  // dotted tail meet and the stitching dropped a colon.
  const lastColon = text.lastIndexOf(":");
  const maybeV4 = text.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const v4 = ipv4ToInt(maybeV4);
    if (v4 === null) return null;
    const high = Math.floor(v4 / 65536).toString(16);
    const low = (v4 % 65536).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (chunk: string): number[] | null => {
    if (chunk === "") return [];
    const groups: number[] = [];
    for (const part of chunk.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
      groups.push(Number.parseInt(part, 16));
    }
    return groups;
  };

  const head = parse(halves[0] ?? "");
  if (head === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const rest = parse(halves[1] ?? "");
  if (rest === null) return null;
  const explicit = head.length + rest.length;
  // `::` must stand for at least one zero group, so an eight-group
  // address written with one is malformed rather than merely redundant.
  if (explicit >= 8) return null;
  return [...head, ...new Array<number>(8 - explicit).fill(0), ...rest];
}

function inIpv6Range(groups: number[], base: string, prefix: number): boolean {
  const baseGroups = ipv6ToGroups(base);
  if (baseGroups === null) return false;
  let bits = prefix;
  for (let i = 0; i < 8 && bits > 0; i += 1) {
    const take = Math.min(16, bits);
    const mask = take === 16 ? 0xffff : (0xffff << (16 - take)) & 0xffff;
    if (((groups[i] ?? 0) & mask) !== ((baseGroups[i] ?? 0) & mask)) return false;
    bits -= take;
  }
  return true;
}

/** Eight groups → the dotted quad in the two groups starting at `at`. */
function embeddedIpv4(groups: number[], at: number): string {
  const high = groups[at] ?? 0;
  const low = groups[at + 1] ?? 0;
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

export interface AddressVerdict {
  blocked: boolean;
  /** Why, in words a log line can carry. */
  reason: string;
}

/**
 * Is this a literal IP address we refuse to connect to?
 *
 * Anything that is not parseable as an address is NOT blocked here —
 * hostnames are the caller's business (see `checkOutboundUrl`), and a
 * function that answered "blocked" for a name it simply could not read
 * would be reporting a parse failure as a security verdict.
 */
export function classifyAddress(address: string): AddressVerdict {
  const literal = address.trim().replace(/^\[|\]$/g, "");

  for (const [host, reason] of BLOCKED_METADATA_HOSTS) {
    const asV6 = ipv6ToGroups(host);
    const candidate = ipv6ToGroups(literal);
    if (asV6 && candidate && asV6.every((g, i) => g === candidate[i])) {
      return { blocked: true, reason };
    }
    if (host === literal) return { blocked: true, reason };
  }

  const v4 = ipv4ToInt(literal);
  if (v4 !== null) {
    for (const [base, prefix, reason] of BLOCKED_IPV4) {
      if (inIpv4Range(v4, base, prefix)) return { blocked: true, reason };
    }
    return { blocked: false, reason: "public IPv4" };
  }

  const groups = ipv6ToGroups(literal);
  if (groups !== null) {
    // Unwrap the three prefixes that carry a v4 address, and judge the
    // address they carry. `::ffff:169.254.169.254` is the metadata
    // service wearing a hat.
    if (inIpv6Range(groups, "::ffff:0:0", 96)) {
      const inner = classifyAddress(embeddedIpv4(groups, 6));
      return inner.blocked
        ? { blocked: true, reason: `IPv4-mapped ${inner.reason}` }
        : { blocked: false, reason: "IPv4-mapped public address" };
    }
    if (inIpv6Range(groups, "64:ff9b::", 96)) {
      const inner = classifyAddress(embeddedIpv4(groups, 6));
      return inner.blocked
        ? { blocked: true, reason: `NAT64-embedded ${inner.reason}` }
        : { blocked: false, reason: "NAT64-embedded public address" };
    }
    if (inIpv6Range(groups, "2002::", 16)) {
      const inner = classifyAddress(embeddedIpv4(groups, 1));
      return inner.blocked
        ? { blocked: true, reason: `6to4-embedded ${inner.reason}` }
        : { blocked: false, reason: "6to4-embedded public address" };
    }
    for (const [base, prefix, reason] of BLOCKED_IPV6) {
      if (inIpv6Range(groups, base, prefix)) return { blocked: true, reason };
    }
    return { blocked: false, reason: "public IPv6" };
  }

  return { blocked: false, reason: "not an IP literal" };
}

export const isBlockedAddress = (address: string): boolean => classifyAddress(address).blocked;

/**
 * May this URL be fetched at all?
 *
 * ── EVERY RULE HERE IS THE STRICT VERSION, AND WHY ────────────────────
 *
 * HTTPS ONLY. Not because plaintext is an SSRF vector on its own, but
 * because every upstream this project talks to is https, so `http:` in a
 * configured URL is always either a mistake or a downgrade. `file:`,
 * `gopher:` and `data:` are refused by the same rule rather than by a
 * denylist that has to keep up with the schemes a URL parser accepts.
 *
 * AN EXPLICIT ALLOWLIST, MATCHED EXACTLY. Not a suffix match. The reason
 * is the one `lib/security/csrf.ts` argues at length for origins:
 * `endsWith(".sec.gov")` also accepts `evil-sec.gov` if the dot is
 * forgotten, and `evil.example/?x=.sec.gov` if the check ever moves to
 * the whole URL. Exact host equality has no such edge.
 *
 * NO CREDENTIALS IN THE URL. `https://allowed.example@evil.example/` has
 * a HOST of evil.example and reads to a human as allowed.example. Every
 * parser agrees with the machine here and every reviewer with the human,
 * which is what makes it worth refusing outright rather than parsing
 * carefully.
 *
 * DEFAULT PORT ONLY. An allowlisted host reached on :8080 or :6379 is a
 * different service from the one somebody vetted. Since all real
 * upstreams are on 443, permitting anything else buys nothing.
 *
 * A LITERAL IP IS STILL CLASSIFIED. If a deployment allowlists a bare
 * address, the range check still applies — the allowlist says which hosts
 * are intended, not which addresses are safe.
 */
export function checkOutboundUrl(raw: string, allowedHosts: readonly string[]): OutboundDecision {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { allowed: false, reason: "not a valid absolute URL" };
  }

  if (url.protocol !== "https:") {
    return { allowed: false, reason: `scheme ${url.protocol} is not https` };
  }
  if (url.username !== "" || url.password !== "") {
    return { allowed: false, reason: "credentials in the URL are refused" };
  }
  if (url.port !== "" && url.port !== "443") {
    return { allowed: false, reason: `port ${url.port} is not the default https port` };
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const permitted = allowedHosts.map((h) => h.toLowerCase().replace(/\.$/, ""));
  if (permitted.length === 0) {
    // Fail closed, the same rule `telegram-webhook.ts` was rewritten to
    // obey: an unset allowlist must not mean "anything goes".
    return { allowed: false, reason: "no outbound allowlist is configured" };
  }
  if (!permitted.includes(host.replace(/^\[|\]$/g, "")) && !permitted.includes(host)) {
    return { allowed: false, reason: `host ${url.hostname} is not on the outbound allowlist` };
  }

  const verdict = classifyAddress(host);
  if (verdict.blocked) {
    return { allowed: false, reason: `${url.hostname} is ${verdict.reason}` };
  }

  return { allowed: true, url };
}

/**
 * The upstreams this codebase talks to, as one list.
 *
 * Kept here rather than beside each caller so that adding a host is a
 * visible change to a security file, and so `pnpm test` can assert the
 * list matches what the adapters actually request. Per-deployment hosts —
 * `UPSTASH_REDIS_REST_URL`, `INDIA_FEED_URL` — are NOT here: they are
 * passed in by the caller that reads the variable, since a list in source
 * cannot know them. Those callers get the scheme, port, credential and
 * address checks, which is the part that protects them; the allowlist
 * entry is only ever the operator agreeing with themselves.
 */
export const OUTBOUND_ALLOWLIST: readonly string[] = [
  "api.bseindia.com",
  "api.resend.com",
  "api.telegram.org",
  "data.sec.gov",
  "disclosures-clerk.house.gov",
  "financialmodelingprep.com",
  "finnhub.io",
  "house-stock-watcher-data.s3-us-west-2.amazonaws.com",
  "nsearchives.nseindia.com",
  "senate-stock-watcher-data.s3-us-west-2.amazonaws.com",
  "www.bseindia.com",
  "www.nseindia.com",
  "www.sec.gov",
];
