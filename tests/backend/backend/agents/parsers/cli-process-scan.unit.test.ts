import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  endTaggedProcesses,
  findTaggedProcesses,
  readScopeSince,
  readServerScope,
} from "@/backend/agents/cli/CliProcessScan";

const boundary = vi.hoisted(() => ({
  stopWorkerUnits: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock("@/backend/agents/cli/CliWorkerUnit", () => ({
  stopWorkerUnits: boundary.stopWorkerUnits,
}));
vi.mock("node:fs/promises", () => ({ readFile: boundary.readFile }));

beforeEach(() => {
  boundary.stopWorkerUnits.mockReset().mockResolvedValue(0);
  boundary.readFile.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("legacy process ownership", () => {
  it("never reads process environments or signals PIDs for an unproven tag", async () => {
    const kill = vi.spyOn(process, "kill");
    await expect(
      findTaggedProcesses("run-a", { earliestStart: 100 }),
    ).rejects.toThrow("ownership is unverified");
    expect(boundary.readFile).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  });

  it.each([0, 1])(
    "does not treat %i stopped units as proof for a legacy session",
    async (count) => {
      boundary.stopWorkerUnits.mockResolvedValue(count);
      const kill = vi.spyOn(process, "kill");
      await expect(endTaggedProcesses("run-a")).rejects.toThrow(
        "ownership is unverified",
      );
      expect(boundary.stopWorkerUnits).toHaveBeenCalledExactlyOnceWith("run-a");
      expect(boundary.readFile).not.toHaveBeenCalled();
      expect(kill).not.toHaveBeenCalled();
    },
  );

  it("retains uncertainty if the service manager cannot stop the unit", async () => {
    boundary.stopWorkerUnits.mockRejectedValue(new Error("no service manager"));
    await expect(endTaggedProcesses("run-a")).rejects.toThrow(
      "ownership is unverified",
    );
    expect(boundary.readFile).not.toHaveBeenCalled();
  });
});

describe("process start scopes", () => {
  it("reads the server start without inspecting an environment", async () => {
    boundary.readFile.mockResolvedValue(
      "self (a) b) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 4200 0 0\n",
    );
    await expect(readServerScope()).resolves.toEqual({ earliestStart: 4200 });
  });

  it("refuses an unknown server start", async () => {
    boundary.readFile.mockRejectedValue(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
    await expect(readServerScope()).rejects.toThrow("no start time");
  });

  it("bounds a recorded start and retains conservative clock tolerance", async () => {
    const now = Date.parse("2026-10-16T12:00:00.000Z");
    vi.useFakeTimers({ now });
    boundary.readFile.mockResolvedValue("1000.00 4.00\n");
    const before = (seconds: number): string =>
      new Date(now - seconds * 1000).toISOString();
    await expect(readScopeSince(before(400))).resolves.toEqual({
      earliestStart: 54000,
    });
    await expect(readScopeSince(before(2000))).resolves.toEqual({
      earliestStart: Infinity,
    });
    await expect(readScopeSince(before(1030))).resolves.toEqual({
      earliestStart: 0,
    });
    await expect(readScopeSince(before(-10))).resolves.toEqual({
      earliestStart: 0,
    });
    await expect(readScopeSince("yesterday")).rejects.toThrow(
      "Invalid session start",
    );
  });
});
