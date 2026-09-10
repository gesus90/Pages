import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  languageCookie,
  resolveAnonymousLanguage,
} from "@/app/lib/language.server";
import { LANGUAGE } from "@/language/Language";

function createRequest(cookieHeader: string | null): Request {
  const headers = new Headers();

  if (cookieHeader !== null) {
    headers.set("Cookie", cookieHeader);
  }

  return new Request("http://pages.invalid/login", { headers });
}

describe("resolveAnonymousLanguage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the language stored in the cookie", async () => {
    const header = await languageCookie.serialize(LANGUAGE.GERMAN);
    const cookieHeader = header.split(";")[0] ?? "";

    await expect(
      resolveAnonymousLanguage(createRequest(cookieHeader)),
    ).resolves.toBe(LANGUAGE.GERMAN);
  });

  it("returns English choices stored in the cookie", async () => {
    const header = await languageCookie.serialize(LANGUAGE.ENGLISH);
    const cookieHeader = header.split(";")[0] ?? "";

    await expect(
      resolveAnonymousLanguage(createRequest(cookieHeader)),
    ).resolves.toBe(LANGUAGE.ENGLISH);
  });

  it("derives the language from the browser preference without a cookie", async () => {
    const request = new Request("http://pages.invalid/login", {
      headers: { "Accept-Language": "de-DE,de;q=0.9" },
    });

    await expect(resolveAnonymousLanguage(request)).resolves.toBe(
      LANGUAGE.GERMAN,
    );
  });

  it("defaults to English without any preference", async () => {
    await expect(resolveAnonymousLanguage(createRequest(null))).resolves.toBe(
      LANGUAGE.ENGLISH,
    );
  });

  it("ignores unrelated cookies", async () => {
    const request = new Request("http://pages.invalid/login", {
      headers: {
        "Accept-Language": "de",
        Cookie: "other=value",
      },
    });

    await expect(resolveAnonymousLanguage(request)).resolves.toBe(
      LANGUAGE.GERMAN,
    );
  });

  it("falls back to the browser preference when cookie parsing fails", async () => {
    const parse = vi
      .spyOn(languageCookie, "parse")
      .mockRejectedValueOnce(new Error("Cookie broken"));
    const request = new Request("http://pages.invalid/login", {
      headers: {
        "Accept-Language": "de",
        Cookie: "pages_language=broken",
      },
    });

    await expect(resolveAnonymousLanguage(request)).resolves.toBe(
      LANGUAGE.GERMAN,
    );
    expect(parse).toHaveBeenCalledTimes(1);
  });
});

describe("languageCookie", () => {
  it("persists the choice for a year as an HttpOnly Lax cookie", async () => {
    const header = await languageCookie.serialize(LANGUAGE.GERMAN);

    expect(languageCookie.name).toBe("pages_language");
    expect(header).toContain("pages_language=");
    expect(header).toContain(`Max-Age=${60 * 60 * 24 * 365}`);
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
  });
});
