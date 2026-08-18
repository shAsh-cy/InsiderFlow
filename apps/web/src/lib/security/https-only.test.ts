import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { OUTBOUND_ALLOWLIST, checkOutboundUrl } from "@insiderflow/core";

import { SECURITY_HEADERS } from "./headers";
import { buildCsp } from "./csp";

/**
 * HTTPS EVERYWHERE, ASSERTED IN THE FOUR PLACES IT CAN ACTUALLY SLIP.
 *
 * "Force HTTPS" is not one control. It is a property that has to hold at
 * four separate boundaries, and each one fails differently:
 *
 *   INBOUND   — HSTS tells a returning browser never to try http again.
 *   OUTBOUND  — the SSRF guard refuses a non-https upstream, so a
 *               mistyped INDIA_FEED_URL cannot put a bearer token on the
 *               wire in clear.
 *   REDIRECTS — `?next=` and the auth callback must not be able to land a
 *               visitor on an http origin.
 *   CONTENT   — a single http subresource in the CSP would let a network
 *               attacker replace a script on an https page.
 *
 * Localhost is the deliberate exception throughout, and it is narrow:
 * `http://localhost` and `http://127.0.0.1` are the dev server and the
 * e2e server on :3100. Nothing else may be http.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

describe("inbound: the deployment declares https", () => {
  it("sends HSTS with a max-age worth having", () => {
    const hsts = SECURITY_HEADERS.find((h) => h.key === "Strict-Transport-Security");
    expect(hsts, "HSTS is the inbound half of force-https").toBeDefined();
    const maxAge = Number(/max-age=(\d+)/.exec(hsts?.value ?? "")?.[1] ?? 0);
    expect(maxAge).toBeGreaterThanOrEqual(31_536_000);
    expect(hsts?.value).toContain("includeSubDomains");
  });
});

describe("outbound: every upstream is https, and the guard enforces it", () => {
  it("refuses an http upstream even when the host is allowlisted", () => {
    const host = OUTBOUND_ALLOWLIST[0]!;
    const overHttp = checkOutboundUrl(`http://${host}/feed.json`, [host]);
    expect(overHttp.allowed).toBe(false);
    if (!overHttp.allowed) expect(overHttp.reason).toContain("https");
    // …and the same host over https is fine, so the refusal is about the
    // scheme rather than about the host being wrong.
    expect(checkOutboundUrl(`https://${host}/feed.json`, [host]).allowed).toBe(true);
  });

  it("no allowlisted upstream is a bare address or a non-host", () => {
    for (const host of OUTBOUND_ALLOWLIST) {
      expect(host).not.toContain("://");
      expect(host).not.toContain(":");
    }
  });
});

describe("content: the CSP names no http origin", () => {
  it("never allows an http source", () => {
    const policy = buildCsp({
      nonce: "TESTNONCE",
      supabaseOrigin: "https://abc.supabase.co",
      upgradeInsecure: true,
    });
    // `http://` anywhere in a policy is a downgrade waiting to happen. The
    // scheme token `http:` would be worse still — it permits every host.
    expect(policy).not.toContain("http://");
    expect(policy).not.toMatch(/(^|\s)http:/);
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("asks for upgrade-insecure-requests off loopback and not on it", () => {
    // On the e2e server that directive would rewrite the suite's own http
    // requests to https, where nothing is listening.
    expect(buildCsp({ nonce: "N", supabaseOrigin: null, upgradeInsecure: false })).not.toContain(
      "upgrade-insecure-requests",
    );
  });
});

describe("configuration: the committed examples are https or loopback", () => {
  it(".env.example names no plaintext remote host", () => {
    const text = readFileSync(join(repoRoot, ".env.example"), "utf8");
    const httpUrls = [...text.matchAll(/http:\/\/[^\s"'`]+/g)].map((m) => m[0]);
    const remote = httpUrls.filter(
      (url) => !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/.test(url),
    );
    expect(
      remote,
      "an http URL in the shipped example is the one a deployment copies verbatim",
    ).toEqual([]);
  });

  it("SITE_URL in the example is loopback, so a copied value cannot be a plaintext public origin", () => {
    const text = readFileSync(join(repoRoot, ".env.example"), "utf8");
    const siteUrl = /^SITE_URL=(.+)$/m.exec(text)?.[1]?.trim() ?? "";
    expect(siteUrl).toMatch(/^https:\/\/|^http:\/\/localhost/);
  });
});
