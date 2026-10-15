import { describe, expect, it } from "vitest";

import {
  languageCookie,
  resolveAnonymousLanguage,
  resolveSetupLanguage,
} from "@/app/lib/language.server";
import { LANGUAGE } from "@/language/Language";

import { SYNTHETIC_ORIGIN } from "./request-fixtures";

async function requestWithLanguage(
  language: unknown,
  acceptLanguage?: string,
): Promise<Request> {
  const serialized = await languageCookie.serialize(language);
  const headers: Record<string, string> = {
    Cookie: serialized.split(";")[0] ?? "",
  };

  if (acceptLanguage !== undefined) {
    headers["Accept-Language"] = acceptLanguage;
  }

  return new Request(`${SYNTHETIC_ORIGIN}/login`, { headers });
}

describe("languageCookie", () => {
  it("lives a year and stays out of reach of scripts", async () => {
    const header = await languageCookie.serialize(LANGUAGE.ENGLISH);

    expect(header).toContain("pages_language=");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain(`Max-Age=${60 * 60 * 24 * 365}`);
  });
});

describe("resolveAnonymousLanguage", () => {
  it("prefers the language the visitor selected", async () => {
    const request = await requestWithLanguage(LANGUAGE.ENGLISH, "de-DE");

    expect(await resolveAnonymousLanguage(request)).toBe(LANGUAGE.ENGLISH);
  });

  it("derives the language from the browser without a selection", async () => {
    const request = new Request(`${SYNTHETIC_ORIGIN}/login`, {
      headers: { "Accept-Language": "fr;q=0.9,de-AT;q=0.8" },
    });

    expect(await resolveAnonymousLanguage(request)).toBe(LANGUAGE.GERMAN);
  });

  it("ignores a stored value that is no supported language", async () => {
    const request = await requestWithLanguage("klingon", "de-DE");

    expect(await resolveAnonymousLanguage(request)).toBe(LANGUAGE.GERMAN);
  });

  it("survives a damaged cookie value", async () => {
    const request = new Request(`${SYNTHETIC_ORIGIN}/login`, {
      headers: { Cookie: "pages_language=%E0%A4%A", "Accept-Language": "de" },
    });

    expect(await resolveAnonymousLanguage(request)).toBe(LANGUAGE.GERMAN);
  });
});

describe("resolveSetupLanguage", () => {
  it("uses the selected language", async () => {
    const request = await requestWithLanguage(LANGUAGE.ENGLISH);

    expect(await resolveSetupLanguage(request)).toBe(LANGUAGE.ENGLISH);
  });

  it("defaults to German and ignores the browser header", async () => {
    const request = new Request(`${SYNTHETIC_ORIGIN}/setup`, {
      headers: { "Accept-Language": "en-US" },
    });

    expect(await resolveSetupLanguage(request)).toBe(LANGUAGE.GERMAN);
  });
});
