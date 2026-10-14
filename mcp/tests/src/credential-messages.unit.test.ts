import { describe, expect, it } from "vitest";

import { credentialMessages } from "../../src/credential-messages.ts";

const GERMAN_CANCELLED = "Pairing abgebrochen.";
const ENGLISH_CANCELLED = "Pairing cancelled.";

describe("credentialMessages", () => {
  it.each([
    {
      locale: "LC_ALL wins over LC_MESSAGES and LANG",
      environment: { LC_ALL: "de_DE.UTF-8", LC_MESSAGES: "en_US", LANG: "en" },
      expected: GERMAN_CANCELLED,
    },
    {
      locale: "an English LC_ALL overrides a German LANG",
      environment: { LC_ALL: "en_GB.UTF-8", LANG: "de_DE.UTF-8" },
      expected: ENGLISH_CANCELLED,
    },
    {
      locale: "LC_MESSAGES applies when LC_ALL is empty",
      environment: { LC_ALL: "", LC_MESSAGES: "de_AT", LANG: "en_US" },
      expected: GERMAN_CANCELLED,
    },
    {
      locale: "LANG applies when no other variable is set",
      environment: { LANG: "DE_ch.UTF-8" },
      expected: GERMAN_CANCELLED,
    },
    {
      locale: "an unrelated locale selects English",
      environment: { LANG: "fr_FR.UTF-8" },
      expected: ENGLISH_CANCELLED,
    },
    {
      locale: "a missing locale selects English",
      environment: {},
      expected: ENGLISH_CANCELLED,
    },
  ])("$locale", ({ environment, expected }) => {
    expect(credentialMessages(environment).cancelled).toBe(expected);
  });

  it("offers the same message keys in both languages", () => {
    const german = credentialMessages({ LANG: "de_DE" });
    const english = credentialMessages({ LANG: "en_US" });

    expect(Object.keys(german)).toEqual(Object.keys(english));
    expect(german.unlimited).toBe("unbegrenzt");
    expect(english.unlimited).toBe("unlimited");
  });
});
