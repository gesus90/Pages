import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  endTaggedProcesses,
  findTaggedProcesses,
  readScopeSince,
  readServerScope,
  RUN_INSTANCE_VARIABLE,
} from "@/backend/agents/cli/CliProcessScan";

/** Environ contents of a fake process file system, by directory entry. */
const processTable = vi.hoisted(() => ({
  entries: new Map<string, string | Error>(),
  /** Start of a process in clock ticks after boot, by directory entry. */
  starts: new Map<string, number>(),
  /** Seconds since boot. */
  uptime: 1_000,
  isRootReadable: true,
  foreign: new Set<string>(),
}));

vi.mock("node:fs/promises", () => ({
  readdir: async (): Promise<string[]> => {
    if (!processTable.isRootReadable) throw new Error("ENOENT");
    return [...processTable.entries.keys()];
  },
  stat: async (file: string) => ({
    uid: processTable.foreign.has(file.split("/").at(-1) ?? "")
      ? (process.getuid?.() ?? 0) + 1
      : (process.getuid?.() ?? 0),
  }),
  readFile: async (file: string): Promise<string> => {
    const [entry = "", name] = file.split("/").slice(-2);
    if (name === "uptime") return `${processTable.uptime.toFixed(2)} 4.00\n`;
    if (name === "stat") {
      const start = processTable.starts.get(entry);
      if (start === undefined)
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      // The name may contain spaces and parentheses; the start is field 22.
      return `${entry} (a) b) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 ${start} 0 0\n`;
    }
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

/** The error of an environment the kernel withholds, as for a non-dumpable process. */
function withheld(): Error {
  return Object.assign(new Error("EACCES"), { code: "EACCES" });
}

beforeEach(() => {
  processTable.entries.clear();
  processTable.starts.clear();
  processTable.foreign.clear();
  processTable.uptime = 1_000;
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

  it("skips unreadable processes owned by other accounts", async () => {
    processTable.entries.set("4001", new Error("EACCES"));
    processTable.foreign.add("4001");
    processTable.entries.set("4002", tagged("run-a"));
    await expect(findTaggedProcesses("run-a")).resolves.toEqual([4002]);
  });

  it("refuses to confirm absence when its own processes cannot be read", async () => {
    processTable.entries.set("4001", new Error("EACCES"));
    await expect(findTaggedProcesses("run-a")).rejects.toThrow("EACCES");
  });

  it("refuses to confirm absence where no process file system exists", async () => {
    processTable.isRootReadable = false;
    await expect(findTaggedProcesses("run-a")).rejects.toThrow("ENOENT");
  });
});

describe("findTaggedProcesses within the scope of a session", () => {
  const scope = { earliestStart: 1_000 };

  it("skips an unreadable own process that started before the session", async () => {
    processTable.entries.set("4001", withheld());
    processTable.starts.set("4001", 999);
    processTable.entries.set("4002", tagged("run-a"));
    await expect(findTaggedProcesses("run-a", scope)).resolves.toEqual([4002]);
  });

  it.each([1_000, 1_500])(
    "refuses to confirm absence for an unreadable own process that started at tick %i",
    async (start) => {
      processTable.entries.set("4001", withheld());
      processTable.starts.set("4001", start);
      await expect(findTaggedProcesses("run-a", scope)).rejects.toThrow(
        "EACCES",
      );
    },
  );

  it("skips an unreadable process that ended before its start was read", async () => {
    processTable.entries.set("4001", withheld());
    await expect(findTaggedProcesses("run-a", scope)).resolves.toEqual([]);
  });

  it("keeps any other read error of an old own process unconfirmed", async () => {
    processTable.entries.set(
      "4001",
      Object.assign(new Error("EIO"), { code: "EIO" }),
    );
    processTable.starts.set("4001", 10);
    await expect(findTaggedProcesses("run-a", scope)).rejects.toThrow("EIO");
  });
});

describe("readServerScope", () => {
  it("starts the scope with this server process", async () => {
    processTable.starts.set("self", 4_200);
    await expect(readServerScope()).resolves.toEqual({ earliestStart: 4_200 });
  });

  it("refuses a scope when the start of this server is unknown", async () => {
    await expect(readServerScope()).rejects.toThrow("no start time");
  });
});

describe("readScopeSince", () => {
  const now = Date.parse("2026-10-16T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers({ now });
  });

  function secondsBefore(seconds: number): string {
    return new Date(now - seconds * 1_000).toISOString();
  }

  it("starts a minute before a start recorded in this boot", async () => {
    // Recorded 400 s ago with 1000 s uptime: 600 s after boot, less the tolerance.
    await expect(readScopeSince(secondsBefore(400))).resolves.toEqual({
      earliestStart: 54_000,
    });
  });

  it("rules out every unreadable process for a session of an earlier boot", async () => {
    await expect(readScopeSince(secondsBefore(2_000))).resolves.toEqual({
      earliestStart: Number.POSITIVE_INFINITY,
    });
  });

  it.each([
    { moment: "close to the boot", seconds: 1_030 },
    { moment: "in the future", seconds: -10 },
  ])("rules nothing out for a start $moment", async ({ seconds }) => {
    await expect(readScopeSince(secondsBefore(seconds))).resolves.toEqual({
      earliestStart: 0,
    });
  });

  it("refuses an unreadable start", async () => {
    await expect(readScopeSince("yesterday")).rejects.toThrow(
      "Invalid session start",
    );
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

  it("ends the tagged processes beside an older unreadable one within a scope", async () => {
    processTable.entries.set("4001", withheld());
    processTable.starts.set("4001", 10);
    processTable.entries.set("4002", tagged("run-a"));
    vi.spyOn(process, "kill").mockImplementation((id) => {
      processTable.entries.delete(String(id));
      return true;
    });
    const closeout = endTaggedProcesses("run-a", { earliestStart: 100 });
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(closeout).resolves.toEqual({ found: 1, remaining: 0 });
    expect(processTable.entries.has("4001")).toBe(true);
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
