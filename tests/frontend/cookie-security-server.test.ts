import { describe, expect, it } from "vitest";

import { resolveCookieSecure } from "@/app/lib/cookie-security.server";

describe("resolveCookieSecure", () => {
  it("is secure in production by default", () => {
    expect(resolveCookieSecure({ NODE_ENV: "production" })).toBe(true);
  });

  it("is not secure outside production by default", () => {
    expect(resolveCookieSecure({ NODE_ENV: "development" })).toBe(false);
    expect(resolveCookieSecure({})).toBe(false);
  });

  it("lets PAGES_COOKIE_SECURE=false disable it in production", () => {
    expect(
      resolveCookieSecure({
        NODE_ENV: "production",
        PAGES_COOKIE_SECURE: "false",
      }),
    ).toBe(false);
  });

  it("lets PAGES_COOKIE_SECURE=true enable it elsewhere", () => {
    expect(
      resolveCookieSecure({
        NODE_ENV: "development",
        PAGES_COOKIE_SECURE: " TRUE ",
      }),
    ).toBe(true);
  });

  it("ignores unknown values", () => {
    expect(
      resolveCookieSecure({
        NODE_ENV: "production",
        PAGES_COOKIE_SECURE: "maybe",
      }),
    ).toBe(true);
  });
});
