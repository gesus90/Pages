import { describe, expect, it } from "vitest";

import { resolveCookieSecure } from "@/app/lib/cookie-security.server";
import {
  destroySessionCookie,
  getSessionToken,
  sessionCookie,
} from "@/app/lib/session.server";
import { SESSION_LIFETIME_SECONDS } from "@/backend/auth/SessionService";

import { SYNTHETIC_ORIGIN } from "./request-fixtures";

function requestWith(
  headers: Record<string, string>,
  url = SYNTHETIC_ORIGIN,
): Request {
  return new Request(`${url}/dashboard`, { headers });
}

function environment(
  secure: string | undefined,
): Parameters<typeof resolveCookieSecure>[1] {
  return secure === undefined ? {} : { PAGES_COOKIE_SECURE: secure };
}

describe("session cookie attributes", () => {
  it("is HttpOnly, SameSite=Lax, site-wide and lives as long as a session", async () => {
    const header = await sessionCookie.serialize("token-1");

    expect(header).toContain("pages_session=");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain(`Max-Age=${SESSION_LIFETIME_SECONDS}`);
  });

  it("carries Secure only when the caller asks for it", async () => {
    const plain = await sessionCookie.serialize("token-1");
    const secure = await sessionCookie.serialize("token-1", { secure: true });

    expect(plain).not.toContain("Secure");
    expect(secure).toContain("Secure");
  });
});

describe("getSessionToken", () => {
  it("reads the token of the session cookie", async () => {
    const serialized = await sessionCookie.serialize("token-1");
    const request = requestWith({ Cookie: serialized.split(";")[0] ?? "" });

    expect(await getSessionToken(request)).toBe("token-1");
  });

  it("answers null without a cookie header", async () => {
    expect(await getSessionToken(requestWith({}))).toBeNull();
  });

  it("ignores other cookies", async () => {
    const request = requestWith({ Cookie: "theme=dark; pages_language=en" });

    expect(await getSessionToken(request)).toBeNull();
  });

  it("answers null for a value that is no encoded token", async () => {
    const request = requestWith({ Cookie: "pages_session=%E0%A4%A" });

    expect(await getSessionToken(request)).toBeNull();
  });

  it("answers null when the cookie does not hold a string", async () => {
    const serialized = await sessionCookie.serialize({ token: "x" });
    const request = requestWith({ Cookie: serialized.split(";")[0] ?? "" });

    expect(await getSessionToken(request)).toBeNull();
  });
});

describe("destroySessionCookie", () => {
  it("expires the cookie at once", async () => {
    const header = await destroySessionCookie(requestWith({}));

    expect(header).toContain("Max-Age=0");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
  });

  it("keeps the Secure attribute of the protocol the client used", async () => {
    const plain = await destroySessionCookie(requestWith({}));
    const proxied = await destroySessionCookie(
      requestWith({ "x-forwarded-proto": "https" }),
    );

    expect(plain).not.toContain("Secure");
    expect(proxied).toContain("Secure");
  });
});

describe("resolveCookieSecure", () => {
  it("follows the protocol of the request by default", () => {
    expect(resolveCookieSecure(requestWith({}), {})).toBe(false);
    expect(
      resolveCookieSecure(requestWith({}, "https://pages.invalid"), {}),
    ).toBe(true);
  });

  it("trusts the first value of the forwarded protocol", () => {
    const secure = requestWith({ "x-forwarded-proto": " HTTPS , http" });
    const insecure = requestWith(
      { "x-forwarded-proto": "http, https" },
      "https://pages.invalid",
    );

    expect(resolveCookieSecure(secure, {})).toBe(true);
    expect(resolveCookieSecure(insecure, {})).toBe(false);
  });

  it("falls back to the URL when the forwarded protocol is blank", () => {
    const request = requestWith(
      { "x-forwarded-proto": "  " },
      "https://pages.invalid",
    );

    expect(resolveCookieSecure(request, {})).toBe(true);
  });

  it.each([
    ["true", true],
    [" TRUE ", true],
    ["false", false],
    ["False", false],
  ])("lets PAGES_COOKIE_SECURE=%j override the request", (value, expected) => {
    const httpsRequest = requestWith({}, "https://pages.invalid");
    const httpRequest = requestWith({});
    const override = environment(value);

    expect(resolveCookieSecure(httpsRequest, override)).toBe(expected);
    expect(resolveCookieSecure(httpRequest, override)).toBe(expected);
  });

  it("ignores an override that is neither true nor false", () => {
    const httpsRequest = requestWith({}, "https://pages.invalid");

    expect(resolveCookieSecure(httpsRequest, environment("yes"))).toBe(true);
    expect(resolveCookieSecure(requestWith({}), environment(""))).toBe(false);
  });
});
