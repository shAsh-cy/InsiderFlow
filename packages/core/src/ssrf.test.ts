import { describe, expect, it } from "vitest";

import { OUTBOUND_ALLOWLIST, checkOutboundUrl, classifyAddress, isBlockedAddress } from "./ssrf";

/**
 * The cases here are the ones that exist to defeat a check, not the ones
 * that exist in a network diagram. `10.0.0.1` blocking is table stakes;
 * what matters is that `167772161`, `0xa000001`, `::ffff:10.0.0.1` and
 * `0064:ff9b::a00:1` block too, because those are what an attacker or a
 * confused config actually contains.
 */

const ALLOW = ["upstream.example"];

describe("classifyAddress — IPv4 ranges", () => {
  it.each([
    ["0.0.0.0", "unspecified"],
    ["0.1.2.3", "this-network"],
    ["10.0.0.1", "RFC 1918"],
    ["10.255.255.255", "RFC 1918 upper edge"],
    ["100.64.0.1", "carrier-grade NAT"],
    ["100.127.255.255", "CGNAT upper edge"],
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback is a /8, not a single address"],
    ["169.254.169.254", "AWS/GCP/Azure instance metadata"],
    ["169.254.0.1", "link-local generally"],
    ["172.16.0.1", "RFC 1918 lower edge"],
    ["172.31.255.255", "RFC 1918 upper edge"],
    ["192.0.0.192", "Oracle Cloud metadata"],
    ["192.0.2.1", "TEST-NET-1"],
    ["192.88.99.1", "6to4 relay anycast"],
    ["192.168.1.1", "RFC 1918"],
    ["198.18.0.1", "benchmarking"],
    ["198.19.255.255", "benchmarking upper edge — a /15, not a /16"],
    ["198.51.100.1", "TEST-NET-2"],
    ["203.0.113.1", "TEST-NET-3"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.255", "multicast upper edge"],
    ["240.0.0.1", "reserved"],
    ["255.255.255.255", "broadcast"],
    ["100.100.100.200", "Alibaba Cloud metadata"],
  ])("blocks %s (%s)", (address) => {
    expect(classifyAddress(address).blocked, `${address} must be blocked`).toBe(true);
    expect(classifyAddress(address).reason.length).toBeGreaterThan(0);
  });

  // The neighbours. A range check that is one bit too wide refuses real
  // upstreams and nobody finds out until an ingestion run goes quiet.
  it.each([
    ["9.255.255.255", "just below 10/8"],
    ["11.0.0.1", "just above 10/8"],
    ["100.63.255.255", "just below the CGNAT /10"],
    ["100.128.0.0", "just above the CGNAT /10"],
    ["126.255.255.255", "just below 127/8"],
    ["128.0.0.1", "just above 127/8"],
    ["169.253.255.255", "just below link-local"],
    ["169.255.0.0", "just above link-local"],
    ["172.15.255.255", "just below the /12"],
    ["172.32.0.0", "just above the /12"],
    ["192.0.1.1", "between the two 192.0.x /24s"],
    ["192.167.255.255", "just below 192.168/16"],
    ["192.169.0.0", "just above 192.168/16"],
    ["198.17.255.255", "just below the benchmarking /15"],
    ["198.20.0.0", "just above the benchmarking /15"],
    ["223.255.255.255", "just below multicast"],
    ["8.8.8.8", "a real resolver"],
    ["104.16.0.1", "a real CDN"],
  ])("allows %s (%s)", (address) => {
    expect(classifyAddress(address).blocked, `${address} must not be blocked`).toBe(false);
  });
});

describe("classifyAddress — IPv6", () => {
  it.each([
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["0:0:0:0:0:0:0:1", "loopback, uncompressed"],
    ["fe80::1", "link-local"],
    ["fe80::1%eth0", "link-local with a zone index"],
    ["febf:ffff::1", "link-local upper edge — fe80::/10 covers fe80–febf"],
    ["fc00::1", "unique-local lower edge"],
    ["fdff:ffff::1", "unique-local upper edge — fc00::/7 covers fc and fd"],
    ["fd00:ec2::254", "AWS IMDS over IPv6"],
    ["ff02::1", "multicast"],
    ["2001:db8::1", "documentation"],
    ["100::1", "discard-only"],
    ["[::1]", "bracketed, as a URL carries it"],
  ])("blocks %s (%s)", (address) => {
    expect(classifyAddress(address).blocked, `${address} must be blocked`).toBe(true);
  });

  // The wrapped forms. Each carries a v4 address in its low bits, and the
  // whole point is that the v4 rules must reach inside.
  it.each([
    ["::ffff:127.0.0.1", "IPv4-mapped loopback, dotted tail"],
    ["::ffff:7f00:1", "the same address as the URL parser normalises it"],
    ["::ffff:169.254.169.254", "IPv4-mapped metadata service"],
    ["::ffff:a9fe:a9fe", "the same, in hex"],
    ["::ffff:10.0.0.1", "IPv4-mapped RFC 1918"],
    ["64:ff9b::169.254.169.254", "NAT64-embedded metadata service"],
    ["64:ff9b::a9fe:a9fe", "the same, in hex"],
    ["2002:7f00:1::", "6to4-embedded loopback"],
    ["2002:a9fe:a9fe::1", "6to4-embedded metadata service"],
  ])("blocks %s (%s)", (address) => {
    const verdict = classifyAddress(address);
    expect(verdict.blocked, `${address} must be blocked`).toBe(true);
    expect(verdict.reason, "the reason names how it was wrapped").toMatch(/mapped|NAT64|6to4/i);
  });

  it.each([
    ["2606:4700::1111", "a real public address"],
    ["::ffff:8.8.8.8", "IPv4-mapped public address"],
    ["64:ff9b::8.8.8.8", "NAT64-embedded public address"],
    ["2002:0808:0808::1", "6to4-embedded public address"],
    ["2001:db9::1", "just outside the documentation /32"],
    ["fbff:ffff::1", "just below unique-local"],
    ["fe7f:ffff::1", "just below link-local"],
  ])("allows %s (%s)", (address) => {
    expect(classifyAddress(address).blocked, `${address} must not be blocked`).toBe(false);
  });
});

describe("classifyAddress — things that are not addresses", () => {
  it.each([
    "upstream.example",
    "127.0.0.1.evil.example",
    "10.0.0.1.nip.io",
    "not-an-address",
    "",
    "999.999.999.999",
    "1.2.3",
    "1.2.3.4.5",
    "::gggg",
    "1:2:3:4:5:6:7:8:9",
  ])("reports %s as not an IP literal rather than guessing", (value) => {
    // A hostname is not the address check's business — the allowlist is
    // what refuses it. Answering "blocked" for anything unparseable would
    // report a parse failure as a security verdict, and would make the
    // reason field a lie.
    expect(classifyAddress(value).blocked).toBe(false);
  });

  it("blocks the Alibaba metadata address by range as well as by name", () => {
    // 100.100.100.200 is inside 100.64.0.0/10, so the named entry is
    // belt-and-braces rather than the only thing catching it — which is
    // worth asserting, because a reader who deletes the name should not
    // be able to open a hole by doing so. Its neighbour is blocked too,
    // for the range reason and not the name reason.
    expect(classifyAddress("100.100.100.200").blocked).toBe(true);
    expect(classifyAddress("100.100.100.201").reason).toMatch(/carrier-grade NAT/);
  });

  it("does not accept an octal-looking octet as decimal", () => {
    // `010.0.0.1` is 8.0.0.1 to inet_aton and 10.0.0.1 to Number. A value
    // whose meaning depends on the reader is refused as an address rather
    // than resolved one of the two ways.
    expect(classifyAddress("010.0.0.1").reason).toBe("not an IP literal");
  });
});

describe("checkOutboundUrl — the obfuscated IPv4 forms", () => {
  /*
   * The literal spellings a payload uses. The WHATWG URL parser already
   * normalises every one of these to 127.0.0.1, which is exactly why the
   * allowlist is written as 127.0.0.1 here: the test proves the ADDRESS
   * check refuses them even when the host is explicitly permitted, rather
   * than proving only that an unlisted host is unlisted.
   */
  it.each([
    ["https://2130706433/x", "decimal"],
    ["https://0x7f000001/x", "hex"],
    ["https://0177.0.0.1/x", "octal first octet"],
    ["https://0x7f.0x0.0x0.0x1/x", "hex per octet"],
    ["https://127.1/x", "short form"],
    ["https://127.0.0.1/x", "plain"],
  ])("refuses %s (%s) even when 127.0.0.1 is on the allowlist", (raw) => {
    const decision = checkOutboundUrl(raw, ["127.0.0.1"]);
    expect(decision.allowed, `${raw} must be refused`).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/loopback/);
  });

  it("refuses the metadata service written every way", () => {
    for (const raw of [
      "https://169.254.169.254/latest/meta-data/iam/security-credentials/",
      "https://2852039166/latest/meta-data/",
      "https://0xa9fea9fe/latest/meta-data/",
      "https://[::ffff:169.254.169.254]/latest/meta-data/",
    ]) {
      const decision = checkOutboundUrl(raw, ["169.254.169.254", "[::ffff:169.254.169.254]"]);
      expect(decision.allowed, `${raw} must be refused`).toBe(false);
    }
  });
});

describe("checkOutboundUrl — scheme, credentials, port, allowlist", () => {
  it("accepts a plain https URL on an allowlisted host", () => {
    const decision = checkOutboundUrl("https://upstream.example/feed.json?a=1", ALLOW);
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.url.hostname).toBe("upstream.example");
  });

  it.each([
    ["http://upstream.example/x", "plaintext"],
    ["file:///etc/passwd", "file"],
    ["gopher://upstream.example/x", "gopher"],
    ["ftp://upstream.example/x", "ftp"],
    ["data:text/plain,hello", "data"],
    ["//upstream.example/x", "protocol-relative, which is not absolute"],
    ["/just/a/path", "a path"],
  ])("refuses %s (%s)", (raw) => {
    expect(checkOutboundUrl(raw, ALLOW).allowed).toBe(false);
  });

  it("refuses credentials in the URL, which read as one host and resolve as another", () => {
    const decision = checkOutboundUrl("https://upstream.example@evil.example/x", ALLOW);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/credentials/);
    // …and the reason it matters: the host really is the attacker's.
    expect(new URL("https://upstream.example@evil.example/x").hostname).toBe("evil.example");
  });

  it("refuses a non-default port on an allowlisted host", () => {
    expect(checkOutboundUrl("https://upstream.example:8080/x", ALLOW).allowed).toBe(false);
    expect(checkOutboundUrl("https://upstream.example:6379/x", ALLOW).allowed).toBe(false);
    expect(checkOutboundUrl("https://upstream.example:443/x", ALLOW).allowed).toBe(true);
  });

  it.each([
    "https://evil.example/x",
    "https://upstream.example.evil.example/x",
    "https://evil-upstream.example/x",
    "https://notupstream.example/x",
    "https://upstream.example.co/x",
  ])("refuses %s — the allowlist is exact, never a suffix", (raw) => {
    const decision = checkOutboundUrl(raw, ALLOW);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/allowlist/);
  });

  it("matches the allowlist case-insensitively and ignores a trailing root dot", () => {
    expect(checkOutboundUrl("https://UPSTREAM.example/x", ALLOW).allowed).toBe(true);
    expect(checkOutboundUrl("https://upstream.example./x", ALLOW).allowed).toBe(true);
  });

  it("refuses everything when the allowlist is empty — misconfiguration fails closed", () => {
    const decision = checkOutboundUrl("https://upstream.example/x", []);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/no outbound allowlist/);
  });

  it("refuses garbage without throwing", () => {
    for (const raw of ["", "   ", "https://", "https://[", "::::"]) {
      expect(() => checkOutboundUrl(raw, ALLOW)).not.toThrow();
      expect(checkOutboundUrl(raw, ALLOW).allowed).toBe(false);
    }
  });
});

describe("OUTBOUND_ALLOWLIST", () => {
  it("is https-clean: every entry is a bare host, not a URL", () => {
    for (const host of OUTBOUND_ALLOWLIST) {
      expect(host, `${host} must be a host, not a URL`).not.toMatch(/[/:]/);
      expect(host, `${host} must be lowercase`).toBe(host.toLowerCase());
    }
  });

  it("contains no address that the range check would refuse anyway", () => {
    for (const host of OUTBOUND_ALLOWLIST) {
      expect(isBlockedAddress(host), `${host} is a blocked address`).toBe(false);
    }
  });

  it("is sorted and free of duplicates, so a merge conflict is the only way to lose one", () => {
    expect([...OUTBOUND_ALLOWLIST]).toEqual([...new Set(OUTBOUND_ALLOWLIST)].sort());
  });
});
