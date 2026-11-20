import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startServiceWatchdog } from "./ServiceWatchdog";

type ExecCallback = (
  error: Error | null,
  result: { stdout: string; stderr: string },
) => void;

const mocks = vi.hoisted(() => ({
  execFile:
    vi.fn<
      (
        file: string,
        args: readonly string[],
        options: object,
        done: ExecCallback,
      ) => void
    >(),
  isProcessStopping: vi.fn(),
  registerShutdownTask: vi.fn(),
  logCaughtError: vi.fn(),
  contexts: [] as string[],
}));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));

vi.mock("@/backend/database/executor/DatabaseWorkContext", () => ({
  withBackgroundDatabaseWork: <Result>(
    origin: string,
    work: () => Promise<Result>,
  ): Promise<Result> => {
    mocks.contexts.push(origin);
    return work();
  },
}));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
}));

vi.mock("./ProcessLifecycle", () => ({
  isProcessStopping: mocks.isProcessStopping,
  registerShutdownTask: mocks.registerShutdownTask,
}));

function notifications(): readonly (readonly string[])[] {
  return mocks.execFile.mock.calls.map((call) => call[1]);
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NOTIFY_SOCKET", "/run/systemd/notify");
  vi.stubEnv("WATCHDOG_USEC", "");
  mocks.contexts.length = 0;
  mocks.isProcessStopping.mockReturnValue(false);
  mocks.execFile.mockImplementation(
    (
      file: string,
      args: readonly string[],
      options: object,
      done: ExecCallback,
    ) => {
      done(null, { stdout: "", stderr: "" });
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startServiceWatchdog", () => {
  it("does nothing without a systemd notify socket", () => {
    vi.stubEnv("NOTIFY_SOCKET", "");
    const probe = vi.fn().mockResolvedValue(true);

    startServiceWatchdog(probe);

    expect(probe).not.toHaveBeenCalled();
    expect(mocks.registerShutdownTask).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("announces readiness with the first successful probe and renews afterwards", async () => {
    const probe = vi.fn().mockResolvedValue(true);

    startServiceWatchdog(probe);
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mocks.contexts).toEqual(["service_watchdog", "service_watchdog"]);
    expect(notifications()).toEqual([
      [`--pid=${process.pid}`, "WATCHDOG=1", "--ready"],
      [`--pid=${process.pid}`, "WATCHDOG=1"],
    ]);
    expect(mocks.execFile).toHaveBeenCalledWith(
      "/usr/bin/systemd-notify",
      expect.any(Array),
      { timeout: 3000 },
      expect.any(Function),
    );
  });

  it("sends no notification while the probe reports that the service cannot work", async () => {
    const probe = vi.fn().mockResolvedValue(false);

    startServiceWatchdog(probe);
    await settle();

    expect(probe).toHaveBeenCalledTimes(1);
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it("sends no notification when the stop began while the probe ran", async () => {
    mocks.isProcessStopping.mockReturnValueOnce(false).mockReturnValue(true);
    const probe = vi.fn().mockResolvedValue(true);

    startServiceWatchdog(probe);
    await settle();

    expect(probe).toHaveBeenCalledTimes(1);
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it("does not probe at all once the process is stopping", async () => {
    mocks.isProcessStopping.mockReturnValue(true);
    const probe = vi.fn().mockResolvedValue(true);

    startServiceWatchdog(probe);
    await settle();

    expect(probe).not.toHaveBeenCalled();
  });

  it("logs a failing probe, keeps the watchdog unarmed and probes again on the next tick", async () => {
    const error = new Error("database unreachable");
    const probe = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(true);

    startServiceWatchdog(probe);
    await settle();
    expect(mocks.logCaughtError).toHaveBeenCalledWith("ServiceWatchdog", error);
    expect(mocks.execFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(notifications()).toEqual([
      [`--pid=${process.pid}`, "WATCHDOG=1", "--ready"],
    ]);
  });
});

describe("startServiceWatchdog failures and overlap", () => {
  it("keeps asking for readiness after a failed notification", async () => {
    const failure = new Error("notify failed");
    mocks.execFile.mockImplementationOnce(
      (
        file: string,
        args: readonly string[],
        options: object,
        done: ExecCallback,
      ) => {
        done(failure, { stdout: "", stderr: "" });
      },
    );
    const probe = vi.fn().mockResolvedValue(true);

    startServiceWatchdog(probe);
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mocks.logCaughtError).toHaveBeenCalledWith(
      "ServiceWatchdog",
      failure,
    );
    expect(notifications()[1]).toContain("--ready");
  });

  it("never runs two probes at the same time", async () => {
    let finishProbe: (canWork: boolean) => void = () => undefined;
    const probe = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishProbe = resolve;
        }),
    );

    startServiceWatchdog(probe);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(probe).toHaveBeenCalledTimes(1);
    finishProbe(false);
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("stops the interval through its shutdown task", async () => {
    const probe = vi.fn().mockResolvedValue(true);
    startServiceWatchdog(probe);
    await settle();
    const [task, options] = mocks.registerShutdownTask.mock.calls[0] as [
      () => Promise<void>,
      { step: string },
    ];

    await task();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(options).toEqual({ step: "service_watchdog" });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("watchdog interval", () => {
  async function ticksAroundInterval(
    watchdogUsec: string,
    intervalMs: number,
  ): Promise<readonly number[]> {
    vi.stubEnv("WATCHDOG_USEC", watchdogUsec);
    const probe = vi.fn().mockResolvedValue(false);
    startServiceWatchdog(probe);
    await settle();
    probe.mockClear();
    await vi.advanceTimersByTimeAsync(intervalMs - 1);
    const before = probe.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1);
    return [before, probe.mock.calls.length];
  }

  it("uses a third of the systemd watchdog period in milliseconds", async () => {
    expect(await ticksAroundInterval("6000000", 2_000)).toEqual([0, 1]);
  });

  it("never ticks faster than every 100 milliseconds", async () => {
    expect(await ticksAroundInterval("30000", 100)).toEqual([0, 1]);
  });

  it("never ticks slower than every 10 seconds", async () => {
    expect(await ticksAroundInterval("600000000", 10_000)).toEqual([0, 1]);
  });

  it.each(["0", "-5", "abc"])(
    "falls back to 10 seconds for the unusable period %s",
    async (period) => {
      expect(await ticksAroundInterval(period, 10_000)).toEqual([0, 1]);
    },
  );
});
