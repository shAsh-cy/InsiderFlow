import { describe, expect, it } from "vitest";

import { NEXT_INTERNAL_REQUEST_HEADERS, findForbiddenInternalHeader } from "./internal-headers";

/**
 * The header check behind the CVE-2025-29927 guard.
 *
 * The e2e spec drives this over a real request and is the proof that the
 * control is wired up. This file covers the shapes an HTTP client can
 * produce that are awkward to send through a browser — repeated fields,
 * empty values, casing — deterministically and without a server.
 */
describe("findForbiddenInternalHeader", () => {
  const headers = (init: Record<string, string>) => new Headers(init);

  it("passes an ordinary request through", () => {
    expect(
      findForbiddenInternalHeader(
        headers({ accept: "text/html", cookie: "locale=en", "user-agent": "Mozilla/5.0" }),
      ),
    ).toBeNull();
  });

  it("catches the header whatever case it arrives in", () => {
    for (const name of [
      "x-middleware-subrequest",
      "X-Middleware-Subrequest",
      "X-MIDDLEWARE-SUBREQUEST",
    ]) {
      expect(findForbiddenInternalHeader(headers({ [name]: "middleware" })), name).toBe(
        "x-middleware-subrequest",
      );
    }
  });

  it("matches on presence, not on the payload", () => {
    // The published proof of concept used `middleware`; a later variant
    // repeated it once per path segment. A guard keyed to either spelling
    // is a guard against one exploit rather than against the class, so
    // every value — including an empty one — must trip it.
    for (const value of [
      "middleware",
      "src/middleware",
      "middleware:middleware:middleware:middleware:middleware",
      "",
      "anything at all",
    ]) {
      expect(
        findForbiddenInternalHeader(headers({ "x-middleware-subrequest": value })),
        JSON.stringify(value),
      ).toBe("x-middleware-subrequest");
    }
  });

  it("catches a repeated header, which arrives as one joined value", () => {
    const h = new Headers();
    h.append("x-middleware-subrequest", "middleware");
    h.append("x-middleware-subrequest", "src/middleware");
    expect(h.get("x-middleware-subrequest")).toContain(",");
    expect(findForbiddenInternalHeader(h)).toBe("x-middleware-subrequest");
  });

  it("is not a prefix match — an unrelated header is not the forbidden one", () => {
    // A guard that rejects anything starting with the name would take the
    // site down for traffic that never attacked it, and would look
    // identical to a working guard until it did.
    expect(
      findForbiddenInternalHeader(headers({ "x-middleware-subrequest-audit": "1" })),
    ).toBeNull();
    expect(
      findForbiddenInternalHeader(headers({ "prefix-x-middleware-subrequest": "1" })),
    ).toBeNull();
  });

  it("declares the header the advisory names, and only headers a client never sends", () => {
    // Spelled out rather than inferred: if this list ever grows, the entry
    // has to be one no legitimate client sends, or the guard starts
    // rejecting real traffic.
    expect([...NEXT_INTERNAL_REQUEST_HEADERS]).toEqual(["x-middleware-subrequest"]);
    for (const name of NEXT_INTERNAL_REQUEST_HEADERS) {
      expect(name, `${name} must be lower-case for the Headers lookup`).toBe(name.toLowerCase());
    }
  });
});
