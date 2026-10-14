import { describe, expect, it } from "vitest";

import { readConfiguration } from "../../src/configuration.ts";

describe("readConfiguration", () => {
  it("builds the agent endpoint and keeps the token", () => {
    const configuration = readConfiguration({
      PAGES_URL: "https://pages.example/team/",
      PAGES_TOKEN: "token.value-1~+/==",
    });
    expect(configuration.agentsUrl.href).toBe(
      "https://pages.example/team/api/v1/agents",
    );
    expect(configuration.token).toBe("token.value-1~+/==");
    expect(configuration.credentials).toBeUndefined();
  });

  it.each([undefined, "", "with space", "line\nbreak", "=leading", "a=b"])(
    "rejects the token %j without reflecting it",
    (token) => {
      expect(() =>
        readConfiguration({
          PAGES_URL: "https://pages.example",
          PAGES_TOKEN: token,
        }),
      ).toThrow(
        "PAGES_TOKEN must be a nonempty Bearer credential without whitespace.",
      );
    },
  );

  it("validates the address before the token", () => {
    expect(() =>
      readConfiguration({ PAGES_URL: "http://pages.example" }),
    ).toThrow(/PAGES_URL requires HTTPS/);
  });
});
