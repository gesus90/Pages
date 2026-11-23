import { afterEach, describe, expect, it, vi } from "vitest";

import { controlOwnedNamespace } from "@/backend/agents/cli/CliNamespaceControl";

import type { AcpNamespaceOwner } from "@/definition/AcpResource";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  readFile: vi.fn(),
  hasEnded: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("@/backend/agents/cli/CliOwnedNamespace", () => ({
  hasEndedOwnedNamespace: mocks.hasEnded,
}));
vi.mock("@/backend/agents/local/LocalSessionOwnership", () => ({
  localManagerEnvironment: () => ({ PATH: "/usr/bin:/bin" }),
}));

const unitOwner = {
  pid: 10,
  unit: "pages-acp-abc.service",
} as unknown as AcpNamespaceOwner;
const processOwner = { pid: 100 } as unknown as AcpNamespaceOwner;

function systemError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

afterEach(() => {
  mocks.execFile.mockReset();
  mocks.readFile.mockReset();
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

describe("controlOwnedNamespace with a worker unit", () => {
  it("does nothing once the namespace has ended", async () => {
    mocks.hasEnded.mockResolvedValue(true);

    await controlOwnedNamespace(unitOwner, "pause");

    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it.each([
    ["pause", "freeze"],
    ["resume", "thaw"],
  ] as const)("%s runs systemctl %s", async (action, verb) => {
    succeedCommands();

    await controlOwnedNamespace(unitOwner, action);

    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    expect(mocks.execFile).toHaveBeenCalledWith(
      "/usr/bin/systemctl",
      ["--user", verb, "pages-acp-abc.service"],
      { env: { PATH: "/usr/bin:/bin" }, timeout: 2000 },
      expect.any(Function),
    );
  });

  it("thaws and then kills the unit on stop", async () => {
    succeedCommands();

    await controlOwnedNamespace(unitOwner, "stop");

    expect(mocks.execFile.mock.calls.map((call) => call[1])).toEqual([
      ["--user", "thaw", "pages-acp-abc.service"],
      [
        "--user",
        "kill",
        "--signal=SIGKILL",
        "--kill-whom=all",
        "pages-acp-abc.service",
      ],
    ]);
  });
});

describe("controlOwnedNamespace without a unit", () => {
  it("stops the supervisor first and signals descendants in reverse", async () => {
    mocks.hasEnded.mockResolvedValue(false);
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    mocks.readFile.mockImplementation(async (file: string) => {
      if (file === "/proc/100/task/100/children") return "101 102 0 101\n";
      if (file === "/proc/101/task/101/children") return "";
      return "103";
    });

    await controlOwnedNamespace(processOwner, "pause");

    expect(kill.mock.calls).toEqual([
      [100, "SIGSTOP"],
      [101, "SIGSTOP"],
      [102, "SIGSTOP"],
      [103, "SIGSTOP"],
      [103, "SIGSTOP"],
      [102, "SIGSTOP"],
      [101, "SIGSTOP"],
      [100, "SIGSTOP"],
    ]);
  });

  it("sends the resume and stop signals without pre-suspending", async () => {
    mocks.hasEnded.mockResolvedValue(false);
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    mocks.readFile.mockResolvedValue("");

    await controlOwnedNamespace(processOwner, "resume");
    await controlOwnedNamespace(processOwner, "stop");

    expect(kill.mock.calls).toEqual([
      [100, "SIGCONT"],
      [100, "SIGKILL"],
    ]);
  });

  it("tolerates vanished tasks and processes", async () => {
    mocks.hasEnded.mockResolvedValue(false);
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw systemError("ESRCH");
    });
    mocks.readFile.mockRejectedValue(systemError("ENOENT"));

    await expect(
      controlOwnedNamespace(processOwner, "stop"),
    ).resolves.toBeUndefined();
    expect(kill).toHaveBeenCalledWith(100, "SIGKILL");
  });

  it("rethrows an unexpected read error", async () => {
    mocks.hasEnded.mockResolvedValue(false);
    vi.spyOn(process, "kill").mockReturnValue(true);
    mocks.readFile.mockRejectedValue(systemError("EACCES"));

    await expect(controlOwnedNamespace(processOwner, "stop")).rejects.toThrow(
      "EACCES",
    );
  });

  it("rethrows a read failure that is no error with a code", async () => {
    mocks.hasEnded.mockResolvedValue(false);
    mocks.readFile.mockRejectedValue("broken");

    await expect(controlOwnedNamespace(processOwner, "stop")).rejects.toBe(
      "broken",
    );
  });

  it("rethrows a plain error without a code", async () => {
    mocks.hasEnded.mockResolvedValue(false);
    mocks.readFile.mockRejectedValue(new Error("plain"));

    await expect(controlOwnedNamespace(processOwner, "stop")).rejects.toThrow(
      "plain",
    );
  });

  it("rethrows an unexpected signal error", async () => {
    mocks.hasEnded.mockResolvedValue(false);
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw systemError("EPERM");
    });
    mocks.readFile.mockResolvedValue("");

    await expect(controlOwnedNamespace(processOwner, "stop")).rejects.toThrow(
      "EPERM",
    );
  });

  it("rethrows a signal failure that is no error with a code", async () => {
    mocks.hasEnded.mockResolvedValue(false);
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("plain");
    });
    mocks.readFile.mockResolvedValue("");

    await expect(controlOwnedNamespace(processOwner, "stop")).rejects.toThrow(
      "plain",
    );
  });
});
