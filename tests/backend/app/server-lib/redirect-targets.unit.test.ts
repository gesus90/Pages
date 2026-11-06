import { describe, expect, it } from "vitest";

import { resolveLocalRedirect } from "@/app/lib/redirect.server";

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
