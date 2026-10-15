import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  decryptGitHubToken,
  encryptGitHubToken,
} from "@/backend/github/GitHubTokenCrypto";
import { resolveGitHubTokenKey } from "@/backend/github/GitHubTokenKey";

const files = vi.hoisted(() => ({
  content: new Map<string, string>(),
  modes: new Map<string, number>(),
  directories: [] as string[],
  readError: null as Error | null,
}));

vi.mock("node:fs", () => {
  const functions = {
    mkdirSync: (location: string) => {
      files.directories.push(location);
    },
    readFileSync: (location: string) => {
      if (files.readError) throw files.readError;
      const content = files.content.get(location);
      if (content === undefined) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
      return content;
    },
    writeFileSync: (
      location: string,
      content: string,
      options: { mode: number },
    ) => {
      files.content.set(location, content);
      files.modes.set(location, options.mode);
    },
  };
  return { ...functions, default: functions };
});

beforeEach(() => {
  files.content.clear();
  files.modes.clear();
  files.directories.length = 0;
  files.readError = null;
  vi.stubEnv("PAGES_GITHUB_TOKEN_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("token encryption", () => {
  const key = randomBytes(32);

  it("round-trips a token without storing it in clear text", () => {
    const payload = encryptGitHubToken("ghp_secret", key);

    expect(payload.split(":")).toHaveLength(3);
    expect(payload).not.toContain("ghp_secret");
    expect(decryptGitHubToken(payload, key)).toBe("ghp_secret");
  });

  it("uses a fresh nonce for every encryption", () => {
    expect(encryptGitHubToken("same", key)).not.toBe(
      encryptGitHubToken("same", key),
    );
  });

  it("refuses payloads of the wrong format", () => {
    for (const payload of ["", "a:b", "a:b:c:d"]) {
      expect(() => decryptGitHubToken(payload, key)).toThrow(
        "unexpected format",
      );
    }
    expect(() => decryptGitHubToken("AAAA:Zm9v:Zm9v", key)).toThrow(
      "unexpected format",
    );
  });

  it("refuses a wrong key and tampered content", () => {
    const payload = encryptGitHubToken("ghp_secret", key);
    const [nonce, ciphertext, tag] = payload.split(":");
    const tampered = Buffer.from(ciphertext, "base64");
    tampered[0] ^= 0xff;

    expect(() => decryptGitHubToken(payload, randomBytes(32))).toThrow();
    expect(() =>
      decryptGitHubToken(
        [nonce, tampered.toString("base64"), tag].join(":"),
        key,
      ),
    ).toThrow();
  });
});

describe("resolveGitHubTokenKey", () => {
  const databasePath = "/srv/pages/data/pages.duckdb";
  const keyPath = "/srv/pages/data/github-token.key";

  it("prefers the configured key", () => {
    vi.stubEnv("PAGES_GITHUB_TOKEN_KEY", "ab".repeat(32));

    expect(resolveGitHubTokenKey(databasePath)).toEqual(
      Buffer.from("ab".repeat(32), "hex"),
    );
    expect(files.content.size).toBe(0);
  });

  it("rejects a configured key of the wrong shape", () => {
    vi.stubEnv("PAGES_GITHUB_TOKEN_KEY", "short");

    expect(() => resolveGitHubTokenKey(databasePath)).toThrow(
      "64 hexadecimal characters",
    );
  });

  it("generates a key once, stores it privately and reuses it", () => {
    const generated = resolveGitHubTokenKey(databasePath);

    expect(generated).toHaveLength(32);
    expect(files.modes.get(keyPath)).toBe(0o600);
    expect(files.directories).toEqual(["/srv/pages/data"]);
    expect(resolveGitHubTokenKey(databasePath)).toEqual(generated);
  });

  it("refuses to use a stored key that is invalid", () => {
    files.content.set(keyPath, "not-a-key\n");

    expect(() => resolveGitHubTokenKey(databasePath)).toThrow(
      /is invalid, refusing to use it/u,
    );
  });

  it("does not hide other read errors behind a new key", () => {
    files.readError = Object.assign(new Error("denied"), { code: "EACCES" });

    expect(() => resolveGitHubTokenKey(databasePath)).toThrow("denied");
    expect(files.content.size).toBe(0);
  });
});
