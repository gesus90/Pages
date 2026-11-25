import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createServerSystemSources } from "./SystemSources";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readdir: vi.fn(), readFile: vi.fn() }));

class FakeChild extends EventEmitter {
  public readonly stdout: (EventEmitter & { setEncoding: () => void }) | null;
  public readonly kill = vi.fn();

  public constructor(hasOutput = true) {
    super();
    this.stdout = hasOutput
      ? Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
      : null;
  }
}

function startChild(child: FakeChild): void {
  vi.mocked(spawn).mockReturnValue(
    child as unknown as ReturnType<typeof spawn>,
  );
}

beforeEach(() => {
  vi.mocked(spawn).mockReset();
  vi.mocked(readFile).mockReset();
  vi.mocked(readdir).mockReset();
});

describe("createServerSystemSources", () => {
  it("reads text and tolerates missing files", async () => {
    vi.mocked(readFile).mockResolvedValueOnce("text");
    vi.mocked(readFile).mockRejectedValueOnce(new Error("missing"));
    const sources = createServerSystemSources();
    expect(await sources.readText("/a")).toBe("text");
    expect(await sources.readText("/b")).toBeNull();
  });

  it("lists directories and tolerates missing ones", async () => {
    vi.mocked(readdir).mockResolvedValueOnce(["x"] as never);
    vi.mocked(readdir).mockRejectedValueOnce(new Error("missing"));
    const sources = createServerSystemSources();
    expect(await sources.listDirectory("/a")).toEqual(["x"]);
    expect(await sources.listDirectory("/b")).toEqual([]);
  });

  it("provides the clock and user id", () => {
    const sources = createServerSystemSources();
    expect(sources.now()).toBeGreaterThan(0);
    expect(sources.userId).toBe(process.getuid?.() ?? null);
  });

  it("falls back to a null user id without getuid", () => {
    const original = process.getuid;
    Object.defineProperty(process, "getuid", {
      value: undefined,
      configurable: true,
    });
    try {
      expect(createServerSystemSources().userId).toBeNull();
    } finally {
      Object.defineProperty(process, "getuid", {
        value: original,
        configurable: true,
      });
    }
  });
});

describe("createServerSystemSources probes", () => {
  it("measures a file system from the child's output", async () => {
    const child = new FakeChild();
    startChild(child);
    const probe = createServerSystemSources().probeFileSystem("/m");
    child.stdout?.emit("data", "1024 10 4 ");
    child.stdout?.emit("data", "6\n");
    child.emit("close", 0);
    expect(await probe.finished).toEqual({
      size: 10240,
      used: 6144,
      free: 6144,
    });
    probe.stop();
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("clamps used space and bounds the collected output", async () => {
    const child = new FakeChild();
    startChild(child);
    const probe = createServerSystemSources().probeFileSystem("/m");
    child.stdout?.emit("data", "1 4 9 2");
    child.stdout?.emit("data", "x".repeat(5000));
    child.stdout?.emit("data", "ignored");
    child.emit("close", 0);
    expect(await probe.finished).toBeNull();
    const second = new FakeChild();
    startChild(second);
    const next = createServerSystemSources().probeFileSystem("/m");
    second.stdout?.emit("data", "1 4 9 2");
    second.emit("close", 0);
    expect(await next.finished).toEqual({ size: 4, used: 0, free: 2 });
  });

  it.each(["1 2 3", "a b c d", "1 -2 3 4"])(
    "rejects the unusable output %s",
    async (output) => {
      const child = new FakeChild();
      startChild(child);
      const probe = createServerSystemSources().probeFileSystem("/m");
      child.stdout?.emit("data", output);
      child.emit("close", 0);
      expect(await probe.finished).toBeNull();
    },
  );

  it("reports a failed or unstartable probe as null", async () => {
    const failed = new FakeChild(false);
    startChild(failed);
    const first = createServerSystemSources().probeFileSystem("/m");
    failed.emit("close", 1);
    expect(await first.finished).toBeNull();
    const broken = new FakeChild();
    startChild(broken);
    const second = createServerSystemSources().probeFileSystem("/m");
    broken.emit("error", new Error("spawn"));
    expect(await second.finished).toBeNull();
  });
});

describe("createServerSystemSources directory measurement", () => {
  it("measures a directory even when du exits with 1", async () => {
    const child = new FakeChild();
    startChild(child);
    const result = createServerSystemSources().measureDirectory("/d", 5);
    child.stdout?.emit("data", "123\t/d\n");
    child.emit("close", 1, null);
    expect(await result).toBe(123);
    expect(vi.mocked(spawn).mock.calls[0]?.[2]).toMatchObject({ timeout: 5 });
  });

  it("returns null for a killed, silent or failed du", async () => {
    const killed = new FakeChild();
    startChild(killed);
    const first = createServerSystemSources().measureDirectory("/d", 5);
    killed.stdout?.emit("data", "123\t/d\n");
    killed.emit("close", null, "SIGKILL");
    expect(await first).toBeNull();
    const silent = new FakeChild(false);
    startChild(silent);
    const second = createServerSystemSources().measureDirectory("/d", 5);
    silent.emit("close", 0, null);
    expect(await second).toBeNull();
    const broken = new FakeChild();
    startChild(broken);
    const third = createServerSystemSources().measureDirectory("/d", 5);
    broken.emit("error", new Error("spawn"));
    expect(await third).toBeNull();
  });
});
