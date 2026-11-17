import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scopeUnit, stopScope } from "@/scripts/runner/cgroups.mjs";

import type * as ChildProcessModule from "node:child_process";
import type * as FileSystemModule from "node:fs/promises";

const boundary = vi.hoisted(() => ({
  execute:
    vi.fn<(file: string, args: string[]) => Promise<{ stdout: string }>>(),
  readFile: vi.fn<() => Promise<string>>(),
  writeFile: vi.fn<() => Promise<void>>(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof ChildProcessModule>();
  const { promisify: nodePromisify } = await import("node:util");
  return {
    ...original,
    execFile: Object.assign(vi.fn(), {
      [nodePromisify.custom]: boundary.execute,
    }),
  };
});

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof FileSystemModule>()),
  readFile: boundary.readFile,
  writeFile: boundary.writeFile,
}));

const JOB_ID = "d073691d-3a13-4812-adb3-de37ab39eddb";
const UNIT = scopeUnit(JOB_ID);
const CONTROL_GROUP = `/user.slice/user-1000.slice/user@1000.service/app.slice/${UNIT}`;
const SCOPE = { unit: UNIT, path: `/sys/fs/cgroup${CONTROL_GROUP}` };
const POPULATED = "populated 1\nfrozen 0\n";
const EMPTY = "populated 0\nfrozen 0\n";

function failure(code: string | number, stderr = ""): Error {
  return Object.assign(new Error("Controlled boundary failure"), {
    code,
    stderr,
  });
}

function missingUnit(): Error {
  return failure(1, `Failed to kill unit ${UNIT}: Unit ${UNIT} not loaded.\n`);
}

beforeEach(() => {
  boundary.readFile.mockReset().mockResolvedValue(EMPTY);
  boundary.writeFile.mockReset().mockResolvedValue();
  boundary.execute.mockReset().mockImplementation((file, args) => {
    if (args.includes("--property=LoadState"))
      return Promise.resolve({ stdout: "not-found\n" });
    return Promise.resolve({ stdout: `${CONTROL_GROUP}\n` });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("host cgroup closeout", () => {
  it("confirms a scope that was already empty", async () => {
    expect(await stopScope(SCOPE, JOB_ID)).toBe("confirmed");
    expect(boundary.execute).not.toHaveBeenCalled();
  });

  it("confirms a scope collected between the kernel read and the manager query", async () => {
    boundary.readFile.mockResolvedValueOnce(POPULATED);
    boundary.execute.mockResolvedValueOnce({ stdout: "\n" });
    expect(await stopScope(SCOPE, JOB_ID)).toBe("confirmed");
    expect(boundary.readFile).toHaveBeenLastCalledWith(
      `${SCOPE.path}/cgroup.events`,
      "utf8",
    );
    expect(boundary.writeFile).not.toHaveBeenCalled();
  });

  it("confirms collection while the fallback kill request is in flight", async () => {
    boundary.readFile
      .mockResolvedValueOnce(POPULATED)
      .mockResolvedValueOnce(POPULATED);
    boundary.writeFile.mockRejectedValueOnce(failure("EACCES"));
    boundary.execute
      .mockResolvedValueOnce({ stdout: `${CONTROL_GROUP}\n` })
      .mockRejectedValueOnce(missingUnit())
      .mockResolvedValueOnce({ stdout: "\n" });
    expect(await stopScope(SCOPE, JOB_ID)).toBe("confirmed");
  });

  it("kills remaining descendants before it confirms emptiness", async () => {
    boundary.readFile.mockResolvedValueOnce(POPULATED);
    expect(await stopScope(SCOPE, JOB_ID)).toBe("confirmed");
    expect(boundary.writeFile).toHaveBeenCalledWith(
      `${SCOPE.path}/cgroup.kill`,
      "1",
    );
  });

  it("uses the manager to kill descendants when cgroup.kill is read-only", async () => {
    boundary.readFile
      .mockResolvedValueOnce(POPULATED)
      .mockResolvedValueOnce(POPULATED);
    boundary.writeFile.mockRejectedValueOnce(failure("EACCES"));
    expect(await stopScope(SCOPE, JOB_ID)).toBe("confirmed");
    expect(boundary.execute).toHaveBeenCalledWith(
      "/usr/bin/systemctl",
      ["--user", "kill", "--kill-who=all", "--signal=SIGKILL", UNIT],
      expect.anything(),
    );
  });

  it("refuses to confirm descendants that survive the kill deadline", async () => {
    vi.useFakeTimers();
    boundary.readFile.mockResolvedValue(POPULATED);
    const closeout = stopScope(SCOPE, JOB_ID);
    await vi.runAllTimersAsync();
    expect(await closeout).toBe("failed");
  });

  it("accepts an absent saved cgroup only after the manager proves collection", async () => {
    boundary.readFile
      .mockResolvedValueOnce(POPULATED)
      .mockRejectedValueOnce(failure("ENOENT"));
    boundary.execute.mockResolvedValueOnce({ stdout: "\n" });
    expect(await stopScope(SCOPE, JOB_ID)).toBe("confirmed");
  });
});

describe("host cgroup closeout failures", () => {
  it("does not accept a missing unit while its saved cgroup is populated", async () => {
    boundary.readFile.mockResolvedValue(POPULATED);
    boundary.execute.mockResolvedValueOnce({ stdout: "\n" });
    expect(await stopScope(SCOPE, JOB_ID)).toBe("failed");
  });

  it("does not accept an empty ControlGroup for a loaded unit", async () => {
    boundary.readFile.mockResolvedValueOnce(POPULATED);
    boundary.execute.mockResolvedValue({ stdout: "\n" });
    expect(await stopScope(SCOPE, JOB_ID)).toBe("failed");
  });

  it("keeps a denied manager query as a failure even if the cgroup later empties", async () => {
    boundary.readFile.mockResolvedValueOnce(POPULATED);
    boundary.execute.mockRejectedValueOnce(failure("EACCES"));
    expect(await stopScope(SCOPE, JOB_ID)).toBe("failed");
  });

  it("keeps a denied kill request as a failure even if the cgroup later empties", async () => {
    boundary.readFile
      .mockResolvedValueOnce(POPULATED)
      .mockResolvedValueOnce(POPULATED);
    boundary.writeFile.mockRejectedValueOnce(failure("EACCES"));
    boundary.execute
      .mockResolvedValueOnce({ stdout: `${CONTROL_GROUP}\n` })
      .mockRejectedValueOnce(failure(1, "Access denied"));
    expect(await stopScope(SCOPE, JOB_ID)).toBe("failed");
  });

  it("refuses changed ownership even if the old cgroup later empties", async () => {
    boundary.readFile.mockResolvedValueOnce(POPULATED);
    boundary.execute.mockResolvedValueOnce({
      stdout: `/other.slice/${UNIT}\n`,
    });
    expect(await stopScope(SCOPE, JOB_ID)).toBe("failed");
  });

  it("refuses a foreign unit and a path outside the saved cgroup boundary", async () => {
    expect(await stopScope({ ...SCOPE, unit: "foreign.scope" }, JOB_ID)).toBe(
      "failed",
    );
    expect(await stopScope({ ...SCOPE, path: "/unowned" }, JOB_ID)).toBe(
      "failed",
    );
  });

  it("refuses an unreadable saved cgroup after the unit disappears", async () => {
    boundary.readFile
      .mockResolvedValueOnce(POPULATED)
      .mockRejectedValueOnce(failure("EACCES"));
    boundary.execute.mockResolvedValueOnce({ stdout: "\n" });
    expect(await stopScope(SCOPE, JOB_ID)).toBe("failed");
  });

  it("rechecks the kernel boundary on every repeated observation", async () => {
    expect(await stopScope(SCOPE, JOB_ID)).toBe("confirmed");
    boundary.readFile.mockRejectedValueOnce(failure("EACCES"));
    expect(await stopScope(SCOPE, JOB_ID)).toBe("failed");
    expect(await stopScope(SCOPE, JOB_ID)).toBe("confirmed");
  });
});
