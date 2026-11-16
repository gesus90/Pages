import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createServerSystemSources } from "@/backend/service/system/SystemSources";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
  readdir: mocks.readdir,
}));

function child(): EventEmitter & {
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
} {
  return Object.assign(new EventEmitter(), {
    stdout: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    kill: vi.fn(),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("system measurement sources", () => {
  it("reads available files and safely handles unavailable ones", async () => {
    const sources = createServerSystemSources();
    mocks.readFile
      .mockResolvedValueOnce("value")
      .mockRejectedValueOnce(new Error("missing"));
    mocks.readdir
      .mockResolvedValueOnce(["a"])
      .mockRejectedValueOnce(new Error("missing"));
    await expect(sources.readText("/virtual")).resolves.toBe("value");
    await expect(sources.readText("/virtual")).resolves.toBeNull();
    await expect(sources.listDirectory("/virtual")).resolves.toEqual(["a"]);
    await expect(sources.listDirectory("/virtual")).resolves.toEqual([]);
  });

  it("parses filesystem usage and handles invalid and failed probes", async () => {
    const sources = createServerSystemSources();
    for (const [output, expected] of [
      ["4096 100 30 20", { size: 409600, used: 286720, free: 81920 }],
      ["bad", null],
      ["-1 2 3 4", null],
    ] as const) {
      const process = child();
      mocks.spawn.mockReturnValueOnce(process);
      const probe = sources.probeFileSystem("/virtual");
      process.stdout.emit("data", output);
      process.emit("close", 0);
      await expect(probe.finished).resolves.toEqual(expected);
      probe.stop();
      expect(process.kill).toHaveBeenCalledWith("SIGKILL");
    }
    const process = child();
    mocks.spawn.mockReturnValueOnce(process);
    const probe = sources.probeFileSystem("/virtual");
    process.emit("error", new Error("missing"));
    await expect(probe.finished).resolves.toBeNull();
  });

  it("uses bounded directory totals and rejects interrupted output", async () => {
    const sources = createServerSystemSources();
    const process = child();
    mocks.spawn.mockReturnValueOnce(process);
    const result = sources.measureDirectory("/virtual", 1000);
    process.stdout.emit("data", "123 /virtual\n");
    process.emit("close", 1, null);
    await expect(result).resolves.toBe(123);
    const interrupted = child();
    mocks.spawn.mockReturnValueOnce(interrupted);
    const failed = sources.measureDirectory("/virtual", 1000);
    interrupted.emit("close", null, "SIGKILL");
    await expect(failed).resolves.toBeNull();
  });
});
