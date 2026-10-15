import { describe, expect, it } from "vitest";

import { loginDestination } from "@/app/lib/login-destination.server";
import { resolveLocalRedirect } from "@/app/lib/redirect.server";

import { SYNTHETIC_ORIGIN } from "./request-fixtures";

function loginRequest(returnTo: string | null): Request {
  const url = new URL(`${SYNTHETIC_ORIGIN}/login`);

  if (returnTo !== null) {
    url.searchParams.set("returnTo", returnTo);
  }

  return new Request(url);
}

describe("resolveLocalRedirect", () => {
  it.each(["/", "/projekte", "/wiki/page?tab=2#top", "/%2F/not-a-host"])(
    "keeps the local path %j",
    (target) => {
      expect(resolveLocalRedirect(target, "/fallback")).toBe(target);
    },
  );

  it.each([
    "//evil.invalid",
    "/\\evil.invalid",
    "https://evil.invalid/",
    "http:evil.invalid",
    "javascript:alert(1)",
    "evil.invalid/path",
    "",
    "projekte",
  ])("replaces the foreign or relative target %j", (target) => {
    expect(resolveLocalRedirect(target, "/fallback")).toBe("/fallback");
  });

  it.each([
    "/a\r\nSet-Cookie: x=1",
    "/a\tb",
    "/\t/evil.invalid",
    "/a\u0000b",
    "/a\u007fb",
  ])("refuses control characters in %j", (target) => {
    expect(resolveLocalRedirect(target, "/fallback")).toBe("/fallback");
  });

  it.each([null, undefined, 42, {}, ["/ok"]])(
    "refuses the non-text value %j",
    (target) => {
      expect(resolveLocalRedirect(target, "/fallback")).toBe("/fallback");
    },
  );

  it("falls back to the site root by default", () => {
    expect(resolveLocalRedirect("//evil.invalid")).toBe("/");
  });
});

describe("loginDestination", () => {
  it("returns to the pairing page", () => {
    expect(loginDestination(loginRequest("/pair"))).toBe("/pair");
  });

  it("keeps a well-formed pairing code", () => {
    expect(loginDestination(loginRequest("/pair?code=BCDFGHJK"))).toBe(
      "/pair?code=BCDFGHJK",
    );
  });

  it.each([
    null,
    "",
    "/projekte",
    "//evil.invalid",
    "https://evil.invalid/pair",
    "/pair?code=bcdfghjk",
    "/pair?code=AEIOUAEI",
    "/pair?code=BCDFGHJ",
    "/pair?code=BCDFGHJKL",
    "/pair?code=BCDFGHJK&next=//evil.invalid",
    "/pair/extra",
    "/pair\n",
    "/pair?code=BCDFGHJK\n",
  ])("falls back to the dashboard for %j", (target) => {
    expect(loginDestination(loginRequest(target))).toBe("/dashboard");
  });
});
