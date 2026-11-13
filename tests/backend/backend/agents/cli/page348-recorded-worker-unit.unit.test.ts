import { describe, expect, it, vi } from "vitest";

import { settleRecordedWorkerUnit } from "@/backend/agents/cli/CliWorkerUnit";

describe("recorded worker unit closeout", () => {
  it("stops the recorded unit and checks its state afterwards", async () => {
    const command = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "loaded\n" })
      .mockResolvedValueOnce({ stdout: "" })
      .mockResolvedValueOnce({ stdout: "inactive\n" });
    const name = "pages-acp-session-123abcde.service";

    await expect(
      settleRecordedWorkerUnit("session", name, command),
    ).resolves.toBe(0);
    expect(command.mock.calls.map((call) => call[1])).toEqual([
      ["--user", "show", "--property=LoadState", "--value", name],
      ["--user", "stop", name],
      ["--user", "show", "--property=ActiveState", "--value", name],
    ]);
  });

  it("keeps a unit that is still stopping", async () => {
    const command = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "loaded" })
      .mockResolvedValueOnce({ stdout: "" })
      .mockResolvedValueOnce({ stdout: "deactivating" });

    await expect(
      settleRecordedWorkerUnit(
        "session",
        "pages-acp-session-123abcde.service",
        command,
      ),
    ).resolves.toBe(1);
  });

  it("checks the active state even when the unit is not loaded", async () => {
    const command = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "not-found" })
      .mockResolvedValueOnce({ stdout: "active" });

    await expect(
      settleRecordedWorkerUnit(
        "session",
        "pages-acp-session-123abcde.service",
        command,
      ),
    ).resolves.toBe(1);
  });

  it("refuses a unit belonging to another session", async () => {
    const command = vi.fn();
    await expect(
      settleRecordedWorkerUnit(
        "session",
        "pages-acp-other-123abcde.service",
        command,
      ),
    ).rejects.toThrow();
    expect(command).not.toHaveBeenCalled();
  });
});
