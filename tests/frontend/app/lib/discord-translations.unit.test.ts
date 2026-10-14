import { expect, it } from "vitest";

import germanTranslation from "@/language/locales/de/translation.json";
import englishTranslation from "@/language/locales/en/translation.json";

function leafKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) {
    return [prefix];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

it("has every Discord text in German and in English", () => {
  const english = leafKeys({
    discord: englishTranslation.projectDetail.discord,
    discordCard:
      englishTranslation.projectDetail.interfaces.discordCardDescription,
    result: englishTranslation.discordResult,
  });
  const german = leafKeys({
    discord: germanTranslation.projectDetail.discord,
    discordCard:
      germanTranslation.projectDetail.interfaces.discordCardDescription,
    result: germanTranslation.discordResult,
  });

  expect(german).toEqual(english);
  expect(english.length).toBeGreaterThan(80);
});

it("explains every problem and every refusal the server can report", () => {
  const problems = [
    "invalid_credentials",
    "bot_removed",
    "missing_access",
    "missing_permissions",
    "channel_missing",
    "rate_limited",
    "unavailable",
    "unknown",
  ];
  const errors = [
    "not_configured",
    "attempt_invalid",
    "channel_unavailable",
    "not_connected",
    "invalid_events",
    "discord_unavailable",
    "invalid_input",
    "forbidden",
    "not_found",
    "request_failed",
  ];

  for (const translation of [englishTranslation, germanTranslation]) {
    expect(Object.keys(translation.projectDetail.discord.problem)).toEqual(
      problems,
    );
    expect(Object.keys(translation.projectDetail.discord.error)).toEqual(
      errors,
    );
  }
});
