import { describe, expect, it } from "vitest";

import { GET, SECURITY_TXT_EXPIRES } from "./route";

/**
 * RFC 9116 conformance, plus the renewal reminder.
 *
 * The expiry test is the one that earns its place. §2.5.5 says a
 * researcher should treat an expired file as no longer valid, so an
 * expired security.txt is worse than having none: it tells somebody
 * holding a working exploit that nobody is listening. A date in a static
 * file expires silently. This fails the build 30 days before it does.
 */
describe("/.well-known/security.txt", () => {
  const body = () => GET().text();

  it("is served as text/plain; charset=utf-8", async () => {
    const res = GET();
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("carries every field RFC 9116 requires or recommends", async () => {
    const text = await body();
    // Contact and Expires are the two MUSTs (§2.5.3, §2.5.5).
    expect(text, "Contact is required").toMatch(/^Contact: mailto:\S+@\S+$/m);
    expect(text, "Expires is required").toMatch(/^Expires: \S+$/m);
    // Canonical and Policy are SHOULDs, and both are load-bearing here:
    // Canonical is what stops a copy served from another host being
    // treated as ours, Policy is what points at the scope and the rules.
    expect(text, "Canonical is recommended").toMatch(
      /^Canonical: https:\/\/\S+\/\.well-known\/security\.txt$/m,
    );
    expect(text, "Policy is recommended").toMatch(/^Policy: https:\/\/\S+$/m);
    expect(text).toMatch(/^Preferred-Languages: en$/m);
  });

  it("uses one field per line, with no field repeated except Contact", async () => {
    // §2.4: Contact may repeat; Expires and Canonical may not.
    const fields = (await body())
      .split("\n")
      .filter((line) => /^[A-Za-z-]+:/.test(line))
      .map((line) => line.split(":")[0]!);
    for (const single of ["Expires", "Canonical", "Policy", "Preferred-Languages"]) {
      expect(
        fields.filter((f) => f === single).length,
        `${single} appears once`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it("has an Expires that is a real date, in the future, and under a year out", async () => {
    const expires = new Date(SECURITY_TXT_EXPIRES);
    expect(Number.isNaN(expires.getTime()), "Expires parses").toBe(false);

    const now = Date.now();
    const daysOut = (expires.getTime() - now) / 86_400_000;

    // §2.5.5: under a year, so the file cannot outlive the contact.
    expect(
      daysOut,
      `Expires is ${Math.round(daysOut)} days out; the RFC caps it at 365`,
    ).toBeLessThan(366);

    // …and the reminder. Failing at 30 days leaves a month to renew, and
    // fails while the file is still valid rather than after.
    expect(
      daysOut,
      `security.txt expires in ${Math.round(daysOut)} days — update SECURITY_TXT_EXPIRES in route.ts. ` +
        "An expired security.txt tells a researcher nobody is listening.",
    ).toBeGreaterThan(30);
  });

  it("points at the same address SECURITY.md does", async () => {
    // Two documents naming two different mailboxes is how a report ends up
    // somewhere nobody reads.
    const text = await body();
    expect(text).toContain("security@insiderflow.dev");
  });
});
