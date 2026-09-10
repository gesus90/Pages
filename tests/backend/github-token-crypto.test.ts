import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  decryptGitHubToken,
  encryptGitHubToken,
} from "@/backend/github/GitHubTokenCrypto";
import { resolveGitHubTokenKey } from "@/backend/github/GitHubTokenKey";

describe("GitHub token crypto", () => {
  const key = randomBytes(32);

  it("round-trips tokens without exposing plaintext", () => {
    const encrypted = encryptGitHubToken("ghp-secret-token", key);

    expect(encrypted).not.toContain("ghp-secret-token");
    expect(decryptGitHubToken(encrypted, key)).toBe("ghp-secret-token");
  });

  it("rejects malformed payloads", () => {
    expect(() => decryptGitHubToken("not-a-payload", key)).toThrow(
      "unexpected format",
    );
    expect(() => decryptGitHubToken("a:b:c", key)).toThrow();
  });

  it("rejects tokens encrypted with another key", () => {
    const encrypted = encryptGitHubToken("ghp-secret-token", key);

    expect(() => decryptGitHubToken(encrypted, randomBytes(32))).toThrow();
  });
});

describe("GitHub token key resolution", () => {
  let directory = "";
  const environment = { ...process.env };

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "pages-github-key-"));
    process.env = { ...environment };
    delete process.env.PAGES_GITHUB_TOKEN_KEY;
  });

  afterEach(() => {
    process.env = environment;
    rmSync(directory, { force: true, recursive: true });
    vi.unstubAllEnvs();
  });

  it("prefers an explicitly configured key", () => {
    const hex = randomBytes(32).toString("hex");
    vi.stubEnv("PAGES_GITHUB_TOKEN_KEY", hex);

    expect(
      resolveGitHubTokenKey(path.join(directory, "pages.db")).toString("hex"),
    ).toBe(hex);
  });

  it("rejects malformed configured keys", () => {
    vi.stubEnv("PAGES_GITHUB_TOKEN_KEY", "short");

    expect(() =>
      resolveGitHubTokenKey(path.join(directory, "pages.db")),
    ).toThrow("64 hexadecimal characters");
  });

  it("generates and reuses a key file beside the database", () => {
    const databasePath = path.join(directory, "data", "pages.db");

    const first = resolveGitHubTokenKey(databasePath);
    const second = resolveGitHubTokenKey(databasePath);

    expect(first).toHaveLength(32);
    expect(second.equals(first)).toBe(true);
  });

  it("rethrows unexpected key file failures", () => {
    mkdirSync(path.join(directory, "github-token.key"));

    expect(() =>
      resolveGitHubTokenKey(path.join(directory, "pages.db")),
    ).toThrow();
  });

  it("refuses invalid stored keys instead of replacing them", () => {
    const databasePath = path.join(directory, "pages.db");
    const resolved = resolveGitHubTokenKey(databasePath);

    expect(resolved).toHaveLength(32);

    writeFileSync(
      path.join(directory, "github-token.key"),
      "invalid-content\n",
    );

    expect(() => resolveGitHubTokenKey(databasePath)).toThrow(
      "refusing to use it",
    );
  });
});
