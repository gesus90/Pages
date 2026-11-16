import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpRunnerGitHubClient } from "@/backend/service/runner/HttpRunnerGitHubClient";

import type { RunnerGitHubContext } from "@/backend/service/runner/RunnerGitHubContext";

function client(): HttpRunnerGitHubClient {
  const context = {
    repository: vi.fn().mockResolvedValue("owner/repo"),
    token: vi.fn().mockResolvedValue("token"),
  };
  return new HttpRunnerGitHubClient(context as unknown as RunnerGitHubContext);
}

const key = {
  id: 5,
  key: "ssh-ed25519 abc comment",
  title: "runner",
  read_only: true,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => vi.unstubAllGlobals());

describe("runner GitHub HTTP client", () => {
  it("reuses an existing key independent of its comment", async () => {
    const fetch = vi.fn().mockResolvedValue(response([key]));
    vi.stubGlobal("fetch", fetch);
    const result = await client().createKey({
      projectId: "p",
      key: "ssh-ed25519 abc other",
      title: "new",
    });
    expect(result.key?.id).toBe("5");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("creates a read-only key and rejects a mismatched response", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response(key));
    vi.stubGlobal("fetch", fetch);
    const result = await client().createKey({
      projectId: "p",
      key: "ssh-ed25519 abc",
      title: "runner",
    });
    expect(result.key?.readOnly).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ ...key, key: "ssh-ed25519 wrong" }));
    await expect(
      client().createKey({
        projectId: "p",
        key: "ssh-ed25519 abc",
        title: "runner",
      }),
    ).rejects.toThrow("mismatch");
  });

  it("validates identifiers, handles missing keys and propagates errors", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response({}, 403));
    vi.stubGlobal("fetch", fetch);
    await expect(client().checkKey("p", "bad")).rejects.toThrow(
      "Invalid deploy key ID",
    );
    expect((await client().checkKey("p", "9")).key).toBeNull();
    await expect(client().checkKey("p", "9")).rejects.toThrow("403");
  });

  it("checks repository access and key permissions", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ full_name: "OWNER/REPO" }))
      .mockResolvedValueOnce(response([{ ...key, read_only: false }]));
    vi.stubGlobal("fetch", fetch);
    await expect(
      client().checkAccess("p", "ssh-ed25519 abc"),
    ).resolves.toMatchObject({
      accessible: true,
      readAccess: true,
      writeAccess: true,
    });
    fetch.mockResolvedValueOnce(response({ full_name: "other/repo" }));
    await expect(client().checkAccess("p")).resolves.toMatchObject({
      accessible: false,
      readAccess: null,
      writeAccess: null,
    });
  });
});
