import { describe, expect, it } from "vitest";

import germanTranslation from "@/language/locales/de/translation.json";
import englishTranslation from "@/language/locales/en/translation.json";

type TranslationEntries = ReadonlyMap<string, string>;

/** Flattens nested translation objects into dotted keys with their text. */
function flatten(value: unknown, prefix = ""): TranslationEntries {
  const entries = new Map<string, string>();

  if (typeof value === "string") {
    entries.set(prefix, value);

    return entries;
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      for (const [path, text] of flatten(
        child,
        prefix ? `${prefix}.${key}` : key,
      )) {
        entries.set(path, text);
      }
    }
  }

  return entries;
}

function readPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*(\w+)[^}]*\}\}/gu)]
    .map((match) => match[1] ?? "")
    .sort();
}

const german = flatten(germanTranslation);
const english = flatten(englishTranslation);

describe("translations", () => {
  it("define the same keys in German and English", () => {
    const missingInEnglish = [...german.keys()].filter(
      (key) => !english.has(key),
    );
    const missingInGerman = [...english.keys()].filter(
      (key) => !german.has(key),
    );

    expect(missingInEnglish).toEqual([]);
    expect(missingInGerman).toEqual([]);
  });

  it("contain no empty texts", () => {
    const empty = [...german, ...english]
      .filter(([, text]) => text.trim() === "")
      .map(([key]) => key);

    expect(empty).toEqual([]);
  });

  it("use the same interpolation placeholders in both languages", () => {
    const mismatches = [...german]
      .filter(([key, text]) => {
        const englishText = english.get(key);

        return (
          englishText !== undefined &&
          readPlaceholders(text).join() !== readPlaceholders(englishText).join()
        );
      })
      .map(([key]) => key);

    expect(mismatches).toEqual([]);
  });

  it("are not trivially small", () => {
    expect(german.size).toBeGreaterThan(500);
  });
});
