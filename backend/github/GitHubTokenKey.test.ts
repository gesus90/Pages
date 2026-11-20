import { beforeEach, expect, it, vi } from "vitest";

import { resolveGitHubTokenKey } from "./GitHubTokenKey";

const files = vi.hoisted(() => ({
  read: vi.fn(),
  mkdir: vi.fn(),
  write: vi.fn(),
}));
vi.mock("node:fs", () => ({
  readFileSync: files.read,
  mkdirSync: files.mkdir,
  writeFileSync: files.write,
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

beforeEach(() => {
  vi.stubEnv("PAGES_GITHUB_TOKEN_KEY", "");
  files.read.mockReset();
  files.mkdir.mockReset();
  files.write.mockReset();
});

it("uses a configured key and rejects invalid configuration", () => {
  vi.stubEnv("PAGES_GITHUB_TOKEN_KEY", "ab".repeat(32));
  expect(resolveGitHubTokenKey("/synthetic/db")).toEqual(
    Buffer.alloc(32, 0xab),
  );
  expect(files.read).not.toHaveBeenCalled();
  vi.stubEnv("PAGES_GITHUB_TOKEN_KEY", "invalid");
  expect(() => resolveGitHubTokenKey("/synthetic/db")).toThrow(
    /64 hexadecimal/,
  );
});

it("reads a private stored key and rejects malformed content", () => {
  files.read.mockReturnValueOnce(`  ${"12".repeat(32)}\n`);
  expect(resolveGitHubTokenKey("/synthetic/db")).toEqual(
    Buffer.alloc(32, 0x12),
  );
  files.read.mockReturnValueOnce("broken");
  expect(() => resolveGitHubTokenKey("/synthetic/db")).toThrow(/invalid/);
});

it("creates a key only when allowed and propagates other read errors", () => {
  files.read.mockImplementation(() => {
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  });
  expect(() =>
    resolveGitHubTokenKey("/synthetic/db", { allowCreate: false }),
  ).toThrow(/existing/);
  const key = resolveGitHubTokenKey("/synthetic/db");
  expect(key).toHaveLength(32);
  expect(files.write).toHaveBeenCalledWith(
    "/synthetic/github-token.key",
    `${key.toString("hex")}\n`,
    { mode: 0o600 },
  );
  files.read.mockImplementation(() => {
    throw new Error("permission");
  });
  expect(() => resolveGitHubTokenKey("/synthetic/db")).toThrow("permission");
});
