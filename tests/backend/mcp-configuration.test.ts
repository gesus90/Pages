import { describe, expect, it } from "vitest";

import { readConfiguration } from "../../mcp/src/configuration";

describe("MCP local configuration", () => {
  it.each([
    undefined,
    "",
    " ",
    " https://pages.invalid",
    "invalid",
    "ftp://pages.invalid",
    "http://pages.invalid",
    "https://user@pages.invalid",
    "https://:secret@pages.invalid",
    "https://pages.invalid?token=secret",
    "https://pages.invalid#secret",
  ])("rejects unsafe PAGES_URL (%s) with a fixed diagnostic", (pagesUrl) => {
    expect(() =>
      readConfiguration({ PAGES_URL: pagesUrl, PAGES_TOKEN: "secret" }),
    ).toThrow(/PAGES_URL/);
  });

  it.each([
    undefined,
    "",
    " ",
    "secret with spaces",
    "secret\n",
    "secret:invalid",
  ])("rejects unusable PAGES_TOKEN (%s)", (token) => {
    expect(() =>
      readConfiguration({
        PAGES_URL: "https://pages.invalid",
        PAGES_TOKEN: token,
      }),
    ).toThrow(/PAGES_TOKEN/);
  });

  it.each([
    ["https://pages.invalid", "https://pages.invalid/api/v1/agents"],
    [
      "https://pages.invalid/company/",
      "https://pages.invalid/company/api/v1/agents",
    ],
    ["http://localhost:3000", "http://localhost:3000/api/v1/agents"],
    ["http://127.0.0.1:3000", "http://127.0.0.1:3000/api/v1/agents"],
    ["http://[::1]:3000", "http://[::1]:3000/api/v1/agents"],
  ])("preserves the instance prefix for %s", (pagesUrl, expectedUrl) => {
    const configuration = readConfiguration({
      PAGES_URL: pagesUrl,
      PAGES_TOKEN: "opaque+/token==",
      UNRELATED_SETTING: "ignored",
    });
    expect(configuration.agentsUrl.href).toBe(expectedUrl);
    expect(configuration.token).toBe("opaque+/token==");
  });
});
