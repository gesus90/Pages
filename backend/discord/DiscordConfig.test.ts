import { expect, it, vi } from "vitest";

import {
  describeDiscordInstance,
  readDiscordApplication,
  resolvePublicBaseUrl,
} from "./DiscordConfig";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
}));

const valid = {
  PAGES_DISCORD_APPLICATION_ID: " 12345 ",
  PAGES_DISCORD_BOT_TOKEN: " token ",
  PAGES_DISCORD_CLIENT_SECRET: " secret ",
};

it("validates and describes application settings without exposing secrets", () => {
  expect(readDiscordApplication(valid)).toEqual({
    applicationId: "12345",
    botToken: "token",
    clientSecret: "secret",
  });
  expect(describeDiscordInstance(valid)).toEqual({
    isConfigured: true,
    missingSettings: [],
  });
  expect(readDiscordApplication({})).toBeNull();
  expect(
    readDiscordApplication({ ...valid, PAGES_DISCORD_APPLICATION_ID: "abc" }),
  ).toBeNull();
  expect(
    readDiscordApplication({ ...valid, PAGES_DISCORD_CLIENT_SECRET: "a b" }),
  ).toBeNull();
  expect(
    readDiscordApplication({ ...valid, PAGES_DISCORD_BOT_TOKEN: "" }),
  ).toBeNull();
  expect(describeDiscordInstance({})).toEqual({
    isConfigured: false,
    missingSettings: [
      "PAGES_DISCORD_APPLICATION_ID",
      "PAGES_DISCORD_CLIENT_SECRET",
      "PAGES_DISCORD_BOT_TOKEN",
    ],
  });
  expect(
    describeDiscordInstance({ ...valid, PAGES_DISCORD_APPLICATION_ID: "bad" })
      .missingSettings,
  ).toEqual(["PAGES_DISCORD_APPLICATION_ID"]);
  vi.stubEnv("PAGES_DISCORD_APPLICATION_ID", "12345");
  vi.stubEnv("PAGES_DISCORD_CLIENT_SECRET", "secret");
  vi.stubEnv("PAGES_DISCORD_BOT_TOKEN", "token");
  expect(readDiscordApplication()).not.toBeNull();
  expect(describeDiscordInstance().isConfigured).toBe(true);
});

it("chooses valid public HTTP origins and falls back for invalid settings", () => {
  const origin = "http://internal:3000/path";
  expect(
    resolvePublicBaseUrl(origin, {
      PAGES_PUBLIC_URL: " https://example.com/path ",
    }),
  ).toBe("https://example.com");
  expect(
    resolvePublicBaseUrl(origin, { PAGES_PUBLIC_URL: "http://example.com" }),
  ).toBe("http://example.com");
  expect(
    resolvePublicBaseUrl(origin, { PAGES_PUBLIC_URL: "ftp://example.com" }),
  ).toBe("http://internal:3000");
  expect(resolvePublicBaseUrl(origin, { PAGES_PUBLIC_URL: "bad" })).toBe(
    "http://internal:3000",
  );
  expect(resolvePublicBaseUrl(origin, {})).toBe("http://internal:3000");
  vi.stubEnv("PAGES_PUBLIC_URL", "https://example.com");
  expect(resolvePublicBaseUrl(origin)).toBe("https://example.com");
});
