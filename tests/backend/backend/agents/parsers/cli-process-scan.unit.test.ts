import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  endTaggedProcesses,
  findTaggedProcesses,
  RUN_INSTANCE_VARIABLE,
} from "@/backend/agents/cli/CliProcessScan";

/** Environ contents of a fake process file system, by directory entry. */
const processTable = vi.hoisted(() => ({
  entries: new Map<string, string | Error>(),
  isRootReadable: true,
}));

vi.mock("node:fs/promises", () => ({
  readdir: async (): Promise<string[]> => {
    if (!processTable.isRootReadable) throw new Error("ENOENT");
    return [...processTable.entries.keys()];
  },
  readFile: async (file: string): Promise<string> => {
    const entry = file.split("/").at(-2) ?? "";
    const content = processTable.entries.get(entry);
    if (content === undefined || content instanceof Error)
      throw content ?? new Error("ENOENT");
    return content;
  },
}));

function environ(...variables: readonly string[]): string {
  return `${variables.join("\0")}\0`;
}

function tagged(tag: string): string {
  return environ("PATH=/usr/bin", `${RUN_INSTANCE_VARIABLE}=${tag}`, "HOME=/h");
}

beforeEach(() => {
  processTable.entries.clear();
  processTable.isRootReadable = true;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("findTaggedProcesses", () => {
  it("finds the processes that carry the exact tag", async () => {
    processTable.entries.set("4001", tagged("run-a"));
    processTable.entries.set("4002", tagged("run-b"));
    processTable.entries.set("4003", tagged("run-a"));
    await expect(findTaggedProcesses("run-a")).resolves.toEqual([4001, 4003]);
  });

  it("does not match a tag that only starts with the requested one", async () => {
    processTable.entries.set("4001", tagged("run-abc"));
    await expect(findTaggedProcesses("run-a")).resolves.toEqual([]);
  });

  it("ignores entries that are not process directories", async () => {
    processTable.entries.set("self", tagged("run-a"));
    processTable.entries.set("cpuinfo", tagged("run-a"));
    processTable.entries.set("12x", tagged("run-a"));
    await expect(findTaggedProcesses("run-a")).resolves.toEqual([]);
  });

  it("never reports its own process", async () => {
    processTable.entries.set(String(process.pid), tagged("run-a"));
    await expect(findTaggedProcesses("run-a")).resolves.toEqual([]);
  });

  it("skips processes it cannot read", async () => {
    processTable.entries.set("4001", new Error("EACCES"));
    processTable.entries.set("4002", tagged("run-a"));
    await expect(findTaggedProcesses("run-a")).resolves.toEqual([4002]);
  });

  it("returns nothing where no process file system exists", async () => {
    processTable.isRootReadable = false;
    await expect(findTaggedProcesses("run-a")).resolves.toEqual([]);
  });
});

describe("endTaggedProcesses", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("reports an empty closeout without signalling or waiting", async () => {
    const kill = vi.spyOn(process, "kill");
    await expect(endTaggedProcesses("run-a")).resolves.toEqual({
      found: 0,
      remaining: 0,
    });
    expect(kill).not.toHaveBeenCalled();
  });

  it("ends processes with SIGTERM and confirms that none remains", async () => {
    processTable.entries.set("4001", tagged("run-a"));
    processTable.entries.set("4002", tagged("run-a"));
    const signals: Parameters<typeof process.kill>[] = [];
    vi.spyOn(process, "kill").mockImplementation((id, signal) => {
      signals.push([id, signal]);
      processTable.entries.delete(String(id));
      return true;
    });
    const closeout = endTaggedProcesses("run-a");
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(closeout).resolves.toEqual({ found: 2, remaining: 0 });
    expect(signals).toEqual([
      [4001, "SIGTERM"],
      [4002, "SIGTERM"],
    ]);
  });

  it("kills a process that ignored SIGTERM and counts one that survives", async () => {
    processTable.entries.set("4001", tagged("run-a"));
    processTable.entries.set("4002", tagged("run-a"));
    const signals: string[] = [];
    vi.spyOn(process, "kill").mockImplementation((id, signal) => {
      signals.push(`${id}:${String(signal)}`);
      // 4001 ignores SIGTERM but dies on SIGKILL; 4002 cannot be ended at all.
      if (id === 4001 && signal === "SIGKILL")
        processTable.entries.delete("4001");
      return true;
    });
    const closeout = endTaggedProcesses("run-a");
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(500);
    await expect(closeout).resolves.toEqual({ found: 2, remaining: 1 });
    expect(signals).toEqual([
      "4001:SIGTERM",
      "4002:SIGTERM",
      "4001:SIGKILL",
      "4002:SIGKILL",
    ]);
  });

  it("treats a process that ended before the signal as ended", async () => {
    processTable.entries.set("4001", tagged("run-a"));
    vi.spyOn(process, "kill").mockImplementation((id) => {
      processTable.entries.delete(String(id));
      throw new Error("ESRCH");
    });
    const closeout = endTaggedProcesses("run-a");
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(closeout).resolves.toEqual({ found: 1, remaining: 0 });
  });
});
