import { beforeEach, describe, expect, it, vi } from "vitest";

import { credentialMessages } from "../../mcp/src/credential-messages";
import { verifyPages } from "../../mcp/src/verification";

const configuration = {
  agentsUrl: new URL("https://pages.invalid/api/v1/agents"),
  token: "a".repeat(43),
};
const identity = { userId: "user-1", isAdmin: false, permissions: [] };

function answerWith(credential: unknown): void {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ apiVersion: "1", identity, tools: [], credential }),
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("terminal message language", () => {
  it("falls back to English without any locale variable", () => {
    expect(credentialMessages({}).paired).toBe("Paired with");
    expect(credentialMessages({ LC_ALL: "", LANG: "" }).paired).toBe(
      "Paired with",
    );
  });

  it("uses the first non-empty locale variable in POSIX precedence", () => {
    expect(credentialMessages({ LC_ALL: "de_DE.UTF-8" }).paired).toBe(
      "Gekoppelt mit",
    );
    expect(credentialMessages({ LC_MESSAGES: "DE_AT" }).paired).toBe(
      "Gekoppelt mit",
    );
    expect(credentialMessages({ LC_ALL: "", LANG: "de" }).paired).toBe(
      "Gekoppelt mit",
    );
    expect(credentialMessages({ LC_ALL: "en_US", LANG: "de" }).paired).toBe(
      "Paired with",
    );
  });
});

describe("verified credential details", () => {
  it.each([
    ["a string", "token"],
    ["a number", 5],
    ["an object without id", { name: "n", expiresAt: null }],
    ["a numeric id", { id: 1, name: "n", expiresAt: null }],
    ["an object without name", { id: "i", expiresAt: null }],
    ["a numeric name", { id: "i", name: 2, expiresAt: null }],
    ["an object without expiry", { id: "i", name: "n" }],
    ["a textual expiry", { id: "i", name: "n", expiresAt: "soon" }],
    [
      "an object without rotation flag",
      { id: "i", name: "n", expiresAt: null },
    ],
    [
      "a textual rotation flag",
      { id: "i", name: "n", expiresAt: 1, rotationRequested: "yes" },
    ],
  ])("rejects %s", async (_label, credential) => {
    answerWith(credential);
    await expect(verifyPages(configuration)).rejects.toThrow(
      "Pages verification failed.",
    );
  });

  it("accepts absent details and well-formed details with or without expiry", async () => {
    answerWith(undefined);
    expect(await verifyPages(configuration)).toEqual({ identity, tools: [] });
    answerWith(null);
    expect(await verifyPages(configuration)).toEqual({ identity, tools: [] });
    for (const expiresAt of [null, 1_800_000_000_000]) {
      const credential = {
        id: "credential-id",
        name: "Client",
        expiresAt,
        rotationRequested: false,
      };
      answerWith({ ...credential, unknown: "dropped" });
      expect(await verifyPages(configuration)).toEqual({
        identity,
        tools: [],
        credential,
      });
    }
  });
});
