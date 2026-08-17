import { EventEmitter } from "node:events";
import { request as realRequest } from "node:https";
import type { LookupAddress } from "node:dns";
import { describe, expect, it } from "vitest";

import type { FetchLike } from "./http";

import {
  OutboundRefusedError,
  createGuardedFetch,
  guardedLookup,
  redirectTarget,
} from "./ssrf-fetch";

const ALLOW = ["upstream.example", "other.example"];

/** A resolver that answers whatever the test says, in dns.lookup's shape. */
function resolverReturning(answers: Record<string, LookupAddress[]>) {
  return ((hostname: string, _options: unknown, callback: unknown) => {
    const cb = callback as (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void;
    const found = answers[hostname];
    if (!found) {
      cb(Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }), []);
      return;
    }
    cb(null, found);
  }) as unknown as Parameters<typeof guardedLookup>[0];
}

const call = (lookup: ReturnType<typeof guardedLookup>, hostname: string, all = false) =>
  new Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number }>(
    (resolve) => {
      lookup(hostname, { all }, (err, address, family) => resolve({ err, address, family }));
    },
  );

describe("guardedLookup — the DNS-rebinding defence", () => {
  it("passes a public address through unchanged", async () => {
    const lookup = guardedLookup(
      resolverReturning({ "upstream.example": [{ address: "93.184.216.34", family: 4 }] }),
    );
    const result = await call(lookup, "upstream.example");
    expect(result.err).toBeNull();
    expect(result.address).toBe("93.184.216.34");
    expect(result.family).toBe(4);
  });

  it.each([
    ["127.0.0.1", 4, "loopback"],
    ["169.254.169.254", 4, "the metadata service"],
    ["10.0.0.5", 4, "RFC 1918"],
    ["::1", 6, "IPv6 loopback"],
    ["fd00:ec2::254", 6, "AWS IMDS over IPv6"],
    ["::ffff:169.254.169.254", 6, "the metadata service, IPv4-mapped"],
  ])("refuses a name that resolves to %s (%s)", async (address, family) => {
    const lookup = guardedLookup(
      resolverReturning({ "upstream.example": [{ address, family: family as 4 | 6 }] }),
    );
    const result = await call(lookup, "upstream.example");
    expect(result.err, `${address} must produce an error`).toBeInstanceOf(OutboundRefusedError);
    expect((result.err as NodeJS.ErrnoException).code).toBe("EOUTBOUNDREFUSED");
    // The message names the address, because "upstream.example was
    // refused" without it sends an operator to the wrong place.
    expect(result.err?.message).toContain(address);
  });

  it("refuses when ANY answer is blocked, not just when all of them are", async () => {
    // The attacker's cheapest move: return a good address and a bad one,
    // and let connection retry logic find the bad one. Filtering to the
    // acceptable subset would silently succeed here.
    const lookup = guardedLookup(
      resolverReturning({
        "upstream.example": [
          { address: "93.184.216.34", family: 4 },
          { address: "169.254.169.254", family: 4 },
        ],
      }),
    );
    const result = await call(lookup, "upstream.example");
    expect(result.err).toBeInstanceOf(OutboundRefusedError);
    expect(result.err?.message).toContain("169.254.169.254");
  });

  it("keeps the `all` shape when the caller asked for it", async () => {
    const lookup = guardedLookup(
      resolverReturning({
        "upstream.example": [
          { address: "93.184.216.34", family: 4 },
          { address: "2606:4700::1111", family: 6 },
        ],
      }),
    );
    const result = await call(lookup, "upstream.example", true);
    expect(result.err).toBeNull();
    expect(result.address).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700::1111", family: 6 },
    ]);
  });

  it("passes a resolver failure through as itself", async () => {
    const lookup = guardedLookup(resolverReturning({}));
    const result = await call(lookup, "nowhere.example");
    expect((result.err as NodeJS.ErrnoException).code).toBe("ENOTFOUND");
    expect(result.err).not.toBeInstanceOf(OutboundRefusedError);
  });

  it("refuses an empty answer rather than connecting to undefined", async () => {
    const lookup = guardedLookup(resolverReturning({ "upstream.example": [] }));
    const result = await call(lookup, "upstream.example");
    expect(result.err).not.toBeNull();
  });

  /**
   * The wiring, not the logic.
   *
   * Everything above proves `guardedLookup` decides correctly. This proves
   * the real `https.request` actually CALLS it — that the `lookup` option
   * is passed and honoured — by giving the real transport a resolver that
   * says a permitted name is 127.0.0.1 and asserting the request dies with
   * our refusal rather than reaching a socket. Without this, every test
   * above could pass against a fetcher that never installed the hook.
   */
  it("is honoured by the real node:https transport", async () => {
    const fetchFn = createGuardedFetch({
      allowedHosts: ["pinned.insiderflow.test"],
      transport: realRequest,
      resolver: resolverReturning({
        "pinned.insiderflow.test": [{ address: "127.0.0.1", family: 4 }],
      }),
    });
    await expect(fetchFn("https://pinned.insiderflow.test/feed.json")).rejects.toThrow(
      /resolves to 127\.0\.0\.1/,
    );
  });
});

describe("redirectTarget — the second hop is chosen by the upstream", () => {
  const here = new URL("https://upstream.example/feed.json");

  it("returns null for a non-redirect", () => {
    expect(redirectTarget(here, 200, null, ALLOW)).toBeNull();
    expect(redirectTarget(here, 404, "https://other.example/x", ALLOW)).toBeNull();
  });

  it("allows a redirect to another allowlisted host", () => {
    const target = redirectTarget(here, 302, "https://other.example/x", ALLOW);
    expect(target?.allowed).toBe(true);
  });

  it("resolves a relative Location against the current URL", () => {
    const target = redirectTarget(here, 301, "/moved.json", ALLOW);
    expect(target?.allowed).toBe(true);
    if (target?.allowed) expect(target.url.toString()).toBe("https://upstream.example/moved.json");
  });

  it.each([
    ["https://169.254.169.254/latest/meta-data/", "the metadata service by address"],
    ["https://127.0.0.1/admin", "loopback"],
    ["https://10.0.0.1/internal", "RFC 1918"],
    ["https://[::1]/admin", "IPv6 loopback"],
    ["https://evil.example/x", "a host nobody listed"],
    ["http://upstream.example/x", "a downgrade to plaintext on an allowed host"],
    [
      "//169.254.169.254/latest/meta-data/",
      "protocol-relative, which inherits https and is still internal",
    ],
    ["file:///etc/passwd", "a scheme change"],
    ["https://upstream.example:8080/x", "an allowed host on another port"],
  ])("refuses a redirect to %s (%s)", (location) => {
    const target = redirectTarget(here, 302, location, ALLOW);
    expect(target?.allowed, `${location} must be refused`).toBe(false);
  });

  it("refuses a redirect with no Location, rather than treating it as a body", () => {
    const target = redirectTarget(here, 302, null, ALLOW);
    expect(target?.allowed).toBe(false);
  });
});

/** A transport that replays scripted responses and records what it was asked for. */
function scriptedTransport(
  script: Array<{ status: number; headers: Record<string, string>; body?: string }>,
) {
  const seen: string[] = [];
  let index = 0;
  const transport = ((url: URL | string, _options: unknown, callback: unknown) => {
    seen.push(String(url));
    const step = script[Math.min(index, script.length - 1)] ?? {
      status: 500,
      headers: {} as Record<string, string>,
      body: undefined as string | undefined,
    };
    index += 1;
    const req = new EventEmitter() as EventEmitter & {
      setTimeout: () => void;
      destroy: () => void;
      end: () => void;
    };
    req.setTimeout = () => {};
    req.destroy = () => {};
    req.end = () => {
      const res = new EventEmitter() as EventEmitter & {
        statusCode: number;
        headers: Record<string, string>;
        destroy: () => void;
      };
      res.statusCode = step.status;
      res.headers = step.headers;
      res.destroy = () => {};
      queueMicrotask(() => {
        (callback as (r: typeof res) => void)(res);
        queueMicrotask(() => {
          if (step.body) res.emit("data", Buffer.from(step.body));
          res.emit("end");
        });
      });
    };
    return req;
  }) as unknown as typeof realRequest;
  return { transport, seen };
}

describe("createGuardedFetch", () => {
  const publicResolver = resolverReturning({
    "upstream.example": [{ address: "93.184.216.34", family: 4 }],
    "other.example": [{ address: "93.184.216.35", family: 4 }],
  });

  it("fetches an allowlisted URL and reads the body", async () => {
    const { transport } = scriptedTransport([
      { status: 200, headers: { "content-type": "application/json" }, body: '{"ok":true}' },
    ]);
    const fetchFn = createGuardedFetch({
      allowedHosts: ALLOW,
      transport,
      resolver: publicResolver,
    });
    const response = await fetchFn("https://upstream.example/feed.json");
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.text()).toBe('{"ok":true}');
  });

  it("refuses before opening a socket when the URL fails the check", async () => {
    const { transport, seen } = scriptedTransport([{ status: 200, headers: {} }]);
    const fetchFn = createGuardedFetch({
      allowedHosts: ALLOW,
      transport,
      resolver: publicResolver,
    });
    await expect(fetchFn("https://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(
      OutboundRefusedError,
    );
    // The point of "before": nothing was requested at all.
    expect(seen, "no request may be made for a refused URL").toEqual([]);
  });

  it("follows an allowed redirect and reports the final response", async () => {
    const { transport, seen } = scriptedTransport([
      { status: 302, headers: { location: "https://other.example/moved.json" } },
      { status: 200, headers: {}, body: "arrived" },
    ]);
    const fetchFn = createGuardedFetch({
      allowedHosts: ALLOW,
      transport,
      resolver: publicResolver,
    });
    const response = await fetchFn("https://upstream.example/feed.json");
    expect(await response.text()).toBe("arrived");
    expect(seen).toEqual([
      "https://upstream.example/feed.json",
      "https://other.example/moved.json",
    ]);
  });

  it("refuses a redirect into the metadata service, and does not request it", async () => {
    const { transport, seen } = scriptedTransport([
      { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data/" } },
      { status: 200, headers: {}, body: "credentials" },
    ]);
    const fetchFn = createGuardedFetch({
      allowedHosts: ALLOW,
      transport,
      resolver: publicResolver,
    });
    await expect(fetchFn("https://upstream.example/feed.json")).rejects.toThrow(/redirect refused/);
    expect(seen, "the second hop must never be requested").toEqual([
      "https://upstream.example/feed.json",
    ]);
  });

  it("refuses a redirect loop rather than following it forever", async () => {
    const { transport, seen } = scriptedTransport([
      { status: 302, headers: { location: "https://upstream.example/feed.json" } },
    ]);
    const fetchFn = createGuardedFetch({
      allowedHosts: ALLOW,
      transport,
      resolver: publicResolver,
      maxRedirects: 2,
    });
    await expect(fetchFn("https://upstream.example/feed.json")).rejects.toThrow(
      /more than 2 redirects/,
    );
    expect(seen.length).toBe(3);
  });

  it("refuses a body past the ceiling instead of buffering it", async () => {
    const { transport } = scriptedTransport([{ status: 200, headers: {}, body: "x".repeat(1024) }]);
    const fetchFn = createGuardedFetch({
      allowedHosts: ALLOW,
      transport,
      resolver: publicResolver,
      maxBytes: 16,
    });
    await expect(fetchFn("https://upstream.example/feed.json")).rejects.toThrow(
      /exceeded 16 bytes/,
    );
  });

  it("is assignable to the FetchLike every adapter takes", () => {
    // A compile-time claim, asserted where it can fail. The guard is only
    // useful if it can be dropped in where a bare `fetch` was, and the
    // added `getSetCookie` must widen the response without breaking that.
    const asFetchLike: FetchLike = createGuardedFetch({ allowedHosts: ALLOW });
    expect(typeof asFetchLike).toBe("function");
  });

  it("defaults to the shared upstream allowlist, not to everything", async () => {
    const { transport } = scriptedTransport([{ status: 200, headers: {} }]);
    const fetchFn = createGuardedFetch({ transport, resolver: publicResolver });
    // `upstream.example` is a test fixture and is deliberately NOT in the
    // shipped list, so this is the default proving it is a real list.
    await expect(fetchFn("https://upstream.example/feed.json")).rejects.toThrow(/allowlist/);
  });
});
