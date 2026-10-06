import { describe, expect, it } from "vitest";

import { resolveCookieSecure } from "@/app/lib/cookie-security.server";

function createRequest(url: string, headers: HeadersInit = {}): Request {
  return new Request(url, { headers });
}

describe("resolveCookieSecure", () => {
  it("is secure for a request over HTTPS", () => {
    expect(
      resolveCookieSecure(createRequest("https://pages.invalid/"), {}),
    ).toBe(true);
  });

  it("is not secure for a request over plain HTTP", () => {
    expect(
      resolveCookieSecure(createRequest("http://10.0.0.2:3000/"), {}),
    ).toBe(false);
  });

  it("follows the protocol a reverse proxy reports", () => {
    expect(
      resolveCookieSecure(
        createRequest("http://pages.invalid/", {
          "X-Forwarded-Proto": "https, http",
        }),
        {},
      ),
    ).toBe(true);
    expect(
      resolveCookieSecure(
        createRequest("https://pages.invalid/", {
          "X-Forwarded-Proto": "http",
        }),
        {},
      ),
    ).toBe(false);
  });

  it("ignores an empty proxy protocol", () => {
    expect(
      resolveCookieSecure(
        createRequest("https://pages.invalid/", { "X-Forwarded-Proto": " " }),
        {},
      ),
    ).toBe(true);
  });

  it("lets PAGES_COOKIE_SECURE=false disable it over HTTPS", () => {
    expect(
      resolveCookieSecure(createRequest("https://pages.invalid/"), {
        PAGES_COOKIE_SECURE: "false",
      }),
    ).toBe(false);
  });

  it("lets PAGES_COOKIE_SECURE=true enable it over HTTP", () => {
    expect(
      resolveCookieSecure(createRequest("http://pages.invalid/"), {
        PAGES_COOKIE_SECURE: " TRUE ",
      }),
    ).toBe(true);
  });

  it("ignores unknown values", () => {
    expect(
      resolveCookieSecure(createRequest("http://pages.invalid/"), {
        PAGES_COOKIE_SECURE: "maybe",
      }),
    ).toBe(false);
  });
});
