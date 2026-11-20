import { expect, it, vi } from "vitest";

import { probeGitHubWriteAccess } from "./GitHubGitAccess";
import { extractRepoName } from "./GitHubRepositoryName";
import { decryptGitHubToken, encryptGitHubToken } from "./GitHubTokenCrypto";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

it("extracts only supported repository addresses", () => {
  expect(extractRepoName("https://github.com/owner/repo.git")).toBe(
    "owner/repo",
  );
  expect(extractRepoName("https://github.com/owner/repo/")).toBe("owner/repo");
  expect(extractRepoName("https://example.com/owner/repo")).toBeNull();
});

it("encrypts tokens with fresh nonces and rejects invalid payloads and keys", () => {
  const key = Buffer.alloc(32, 1);
  const encrypted = encryptGitHubToken("synthetic token", key);
  expect(encryptGitHubToken("synthetic token", key)).not.toBe(encrypted);
  expect(decryptGitHubToken(encrypted, key)).toBe("synthetic token");
  expect(() => decryptGitHubToken("invalid", key)).toThrow();
  expect(() => decryptGitHubToken("AA==:AA==:AA==", key)).toThrow();
  expect(() => decryptGitHubToken(encrypted, Buffer.alloc(32, 2))).toThrow();
});

it("maps push permission responses and closes the response body", async () => {
  const cancel = vi.fn().mockResolvedValue(undefined);
  const request = vi.fn().mockResolvedValue({ status: 200, body: { cancel } });
  expect(await probeGitHubWriteAccess("owner/repo", "synthetic", request)).toBe(
    "verified",
  );
  expect(request).toHaveBeenCalledWith(
    "https://github.com/owner/repo.git/info/refs?service=git-receive-pack",
    expect.objectContaining({ redirect: "error" }),
  );
  expect(cancel).toHaveBeenCalledOnce();
  for (const [status, result] of [
    [401, "rejected"],
    [403, "denied"],
    [404, "denied"],
    [500, "unknown"],
  ] as const) {
    expect(
      await probeGitHubWriteAccess("owner/repo", "synthetic", async () => ({
        status,
      })),
    ).toBe(result);
  }
  expect(
    await probeGitHubWriteAccess("owner/repo", "synthetic", async () => {
      throw new Error("offline");
    }),
  ).toBe("unknown");
});
