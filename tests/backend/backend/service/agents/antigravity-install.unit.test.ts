import { Writable } from "node:stream";

import { beforeEach, expect, it, vi } from "vitest";

import { installAntigravityRelease } from "@/backend/service/agents/tools/AntigravityRelease";
import { AgentToolFiles } from "@/backend/service/agents/tools/AgentToolFiles";

import type * as CryptoModule from "node:crypto";
import type * as FileSystemModule from "node:fs";
import type * as FilePromisesModule from "node:fs/promises";

const boundary = vi.hoisted(() => ({
  digest: "baf31b7a97602dee359cf2a43f72b6e11c6bf354be874987d80660cd3526bb6a",
  chmod: vi.fn(async () => {}),
  rm: vi.fn(async () => {}),
  update: vi.fn(),
}));
vi.mock("node:crypto", async (original) => ({
  ...(await original<typeof CryptoModule>()),
  createHash: () => ({
    update: boundary.update,
    digest: () => boundary.digest,
  }),
}));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof FileSystemModule>()),
  createWriteStream: () =>
    new Writable({
      write(chunk, encoding, callback) {
        callback();
      },
    }),
}));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof FilePromisesModule>()),
  chmod: boundary.chmod,
  rm: boundary.rm,
}));

function dependencies(): Parameters<typeof installAntigravityRelease>[0] {
  const files = new AgentToolFiles("/synthetic/tools");
  vi.spyOn(files, "home").mockResolvedValue({
    root: "/synthetic/probe",
    home: "/synthetic/probe/home",
    config: "/synthetic/probe/config",
    work: "/synthetic/probe/work",
  });
  return {
    candidate: {
      file: "/synthetic/release/agy_acp_server.par",
      release: "/synthetic/release",
      source: "managed",
      version: "1.4.4",
    },
    files,
    locator: {
      locate: vi.fn(async () => ({ path: "/usr/bin/unzip", found: true })),
    },
    runner: {
      run: vi.fn(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        errorCode: null,
      })),
    },
  };
}

beforeEach(() => {
  boundary.digest =
    "baf31b7a97602dee359cf2a43f72b6e11c6bf354be874987d80660cd3526bb6a";
  boundary.chmod.mockClear();
  boundary.rm.mockClear();
  boundary.update.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
  );
});

it("fetches only the pinned official archive and installs both runtime parts before publication", async () => {
  const input = dependencies();
  await installAntigravityRelease(input, new AbortController().signal);
  expect(fetch).toHaveBeenCalledWith(
    "https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-1.4.4-linux-x86_64.zip",
    expect.objectContaining({ redirect: "error" }),
  );
  expect(boundary.update).toHaveBeenCalled();
  expect(input.runner.run).toHaveBeenCalledWith(
    expect.objectContaining({
      arguments: [
        "-j",
        "/synthetic/release/adapter.zip",
        "agy_acp_server.par",
        "localharness_external",
        "-d",
        "/synthetic/release",
      ],
    }),
  );
  expect(boundary.chmod.mock.calls).toEqual([
    ["/synthetic/release/agy_acp_server.par", 448],
    ["/synthetic/release/localharness_external", 448],
  ]);
  expect(boundary.rm).toHaveBeenCalledWith("/synthetic/release/adapter.zip", {
    force: true,
  });
});

it("refuses a checksum mismatch before executing extraction and removes its own archive", async () => {
  boundary.digest = "mismatch";
  const input = dependencies();
  await expect(
    installAntigravityRelease(input, new AbortController().signal),
  ).rejects.toThrow("integrity mismatch");
  expect(input.runner.run).not.toHaveBeenCalled();
  expect(boundary.chmod).not.toHaveBeenCalled();
  expect(boundary.rm).toHaveBeenCalledOnce();
});

it("does not silently use another download or model when the official release is unavailable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 503 })),
  );
  const input = dependencies();
  await expect(
    installAntigravityRelease(input, new AbortController().signal),
  ).rejects.toThrow("archive unavailable");
  expect(input.runner.run).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledOnce();
});
