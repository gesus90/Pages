import { describe, expect, it } from "vitest";

import { resolveLocalRedirect } from "@/app/lib/redirect.server";

describe("resolveLocalRedirect", () => {
  it.each(["/", "/login", "/projekte/abc?tab=team", "/tasks#top"])(
    "keeps the local path %s",
    (target) => {
      expect(resolveLocalRedirect(target)).toBe(target);
    },
  );

  it.each([
    "//evil.example",
    "//evil.example/path",
    "/\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "login",
    "",
    "/ok\r\nSet-Cookie: x=1",
    "/tab\there",
  ])("falls back for the unsafe target %j", (target) => {
    expect(resolveLocalRedirect(target)).toBe("/");
  });

  it("falls back for values that are not strings", () => {
    expect(resolveLocalRedirect(null)).toBe("/");
    expect(resolveLocalRedirect(undefined)).toBe("/");
    expect(resolveLocalRedirect(42)).toBe("/");
  });

  it("uses a custom fallback", () => {
    expect(resolveLocalRedirect("//evil.example", "/login")).toBe("/login");
  });
});
