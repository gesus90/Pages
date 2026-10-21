import { isLanguage, resolveLanguage } from "@/i18n/language";
import { de } from "@/i18n/locales/de";
import { en } from "@/i18n/locales/en";

function collectKeys(tree: object, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, entry]: [string, unknown]) =>
    typeof entry === "object" && entry !== null
      ? collectKeys(entry, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

function collectPlaceholders(tree: object): string[] {
  return Object.values(tree).flatMap((entry: unknown) => {
    if (typeof entry === "object" && entry !== null) {
      return collectPlaceholders(entry);
    }

    return [
      String(entry)
        .match(/\{\{\w+\}\}/g)
        ?.join(",") ?? "",
    ];
  });
}

describe("languages", () => {
  it("German and English have the same keys and placeholders", () => {
    expect(collectKeys(de)).toEqual(collectKeys(en));
    expect(collectPlaceholders(de)).toEqual(collectPlaceholders(en));
  });

  it("has no empty text", () => {
    for (const texts of [de, en]) {
      expect(collectKeys(texts).length).toBeGreaterThan(40);
      expect(JSON.stringify(texts)).not.toContain('""');
    }
  });

  it("narrows a language code", () => {
    expect(isLanguage("de")).toBe(true);
    expect(isLanguage("fr")).toBe(false);
    expect(isLanguage(undefined)).toBe(false);
  });

  it("uses a chosen language, then the device language, then English", () => {
    expect(resolveLanguage("de", "en")).toBe("de");
    expect(resolveLanguage("system", "de")).toBe("de");
    expect(resolveLanguage("system", "fr")).toBe("en");
    expect(resolveLanguage("system", null)).toBe("en");
  });
});
