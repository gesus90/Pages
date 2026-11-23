import { afterEach, describe, expect, it, vi } from "vitest";

import { setNamespacePaused } from "@/backend/agents/cli/CliNamespacePause";

import type { AcpNamespaceOwner } from "@/definition/AcpResource";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  hasEnded: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("@/backend/agents/cli/CliOwnedNamespace", () => ({
  hasEndedOwnedNamespace: mocks.hasEnded,
}));

const BOOT = "11111111-2222-3333-4444-555555555555";

function owner(unit?: string): AcpNamespaceOwner {
  return { pid: 42, start: 7, uid: 1000, boot: BOOT, unit };
}

afterEach(() => {
  mocks.execFile.mockReset();
  mocks.hasEnded.mockReset();
});

function succeedCommands(): void {
  mocks.hasEnded.mockResolvedValue(false);
  mocks.execFile.mockImplementation(
    (
      file: string,
      args: readonly string[],
      options: unknown,
      callback: (error: Error | null, result: unknown) => void,
    ) => {
      callback(null, { stdout: "", stderr: "" });
    },
  );
}

describe("setNamespacePaused", () => {
  it("does nothing once the namespace has ended", async () => {
    mocks.hasEnded.mockResolvedValue(true);

    await setNamespacePaused(owner(), true);

    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it.each([
    [true, "freeze"],
    [false, "thaw"],
  ] as const)("freezes or thaws a unit (paused %s)", async (paused, verb) => {
    succeedCommands();
    const unit = "pages-acp-abc-12-deadbeef.service";

    await setNamespacePaused(owner(unit), paused);

    expect(mocks.execFile).toHaveBeenCalledWith(
      "/usr/bin/systemctl",
      ["--user", verb, unit],
      {
        timeout: 2_000,
        env: {
          PATH: "/usr/bin:/bin",
          XDG_RUNTIME_DIR: "/run/user/1000",
          DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
        },
      },
      expect.any(Function),
    );
  });

  it("refuses a unit name that does not match a worker unit", async () => {
    mocks.hasEnded.mockResolvedValue(false);

    await expect(
      setNamespacePaused(owner("evil.service"), true),
    ).rejects.toThrow("Invalid worker unit identity");
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it.each([
    [true, "pause"],
    [false, "resume"],
  ] as const)("signals a plain process (paused %s)", async (paused, action) => {
    succeedCommands();

    await setNamespacePaused(owner(), paused);

    const call = mocks.execFile.mock.calls[0];
    expect(call[0]).toBe("python3");
    expect(call[1].slice(0, 1)).toEqual(["-c"]);
    expect(call[1].slice(2)).toEqual(["42", "7", "1000", BOOT, action]);
    expect(call[2]).toEqual({ timeout: 2_000 });
  });
});
