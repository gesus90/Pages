import { describe, expect, it } from "vitest";

import { LANGUAGE, resolveLanguage } from "@/language/Language";

describe("resolveLanguage", () => {
  it("defaults to English when no preference is given", () => {
    expect(resolveLanguage(undefined)).toBe(LANGUAGE.ENGLISH);
  });

  it("defaults to English for an empty preference", () => {
    expect(resolveLanguage("")).toBe(LANGUAGE.ENGLISH);
  });

  it.each(["de", "DE", "De", "de-DE", "de-at", "de-CH"])(
    "selects German for preference %p",
    (preference) => {
      expect(resolveLanguage(preference)).toBe(LANGUAGE.GERMAN);
    },
  );

  it.each(["en", "EN", "en-US", "en-gb", "en-AU"])(
    "selects English for preference %p",
    (preference) => {
      expect(resolveLanguage(preference)).toBe(LANGUAGE.ENGLISH);
    },
  );

  it("prefers the first supported language in a weighted list", () => {
    expect(resolveLanguage("fr, de;q=0.9, en;q=0.8")).toBe(LANGUAGE.GERMAN);
    expect(resolveLanguage("fr, es;q=0.9, en;q=0.8")).toBe(LANGUAGE.ENGLISH);
  });

  it("ignores quality values when matching languages", () => {
    expect(resolveLanguage("de;q=0.5")).toBe(LANGUAGE.GERMAN);
    expect(resolveLanguage("en;q=0.1")).toBe(LANGUAGE.ENGLISH);
  });

  it("handles whitespace around list entries", () => {
    expect(resolveLanguage("  de  , en;q=0.9")).toBe(LANGUAGE.GERMAN);
    expect(resolveLanguage("fr ; q=0.9 , en")).toBe(LANGUAGE.ENGLISH);
  });

  it("defaults to English for unsupported languages", () => {
    expect(resolveLanguage("fr")).toBe(LANGUAGE.ENGLISH);
    expect(resolveLanguage("es, fr;q=0.9, it;q=0.8")).toBe(LANGUAGE.ENGLISH);
    expect(resolveLanguage("ja-JP")).toBe(LANGUAGE.ENGLISH);
  });

  it("is case-insensitive for region variants", () => {
    expect(resolveLanguage("DE-de")).toBe(LANGUAGE.GERMAN);
    expect(resolveLanguage("EN-us")).toBe(LANGUAGE.ENGLISH);
  });

  it("skips empty entries in the preference list", () => {
    expect(resolveLanguage(" , , de")).toBe(LANGUAGE.GERMAN);
    expect(resolveLanguage(",,,")).toBe(LANGUAGE.ENGLISH);
  });

  it("matches German when it appears after unsupported entries", () => {
    expect(resolveLanguage("zh, ko;q=0.9, de-DE;q=0.8")).toBe(LANGUAGE.GERMAN);
  });

  it("treats whitespace-only preferences as unsupported", () => {
    expect(resolveLanguage("   ")).toBe(LANGUAGE.ENGLISH);
  });
});
