import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { RemoteError } from "@/backend/error/RemoteErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  SETUP_EXIT_STOPPED,
  RemoteSetupConductor,
} from "./RemoteSetupConductor";
import { SetupReasonError } from "./SetupPairing";

import type {
  RemoteInstallView,
  SetupProgress,
} from "@/definition/RemoteSetup";
import type { SetupConductorDependencies } from "./RemoteSetupConductor";

const delay = vi.hoisted(() => ({ setTimeout: vi.fn() }));

vi.mock("node:timers/promises", () => delay);
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

const PREFIX = "remote.setup.reason.";

function marker(body: string): string {
  return `\u001b]777;pages-setup;${body}\u0007`;
}

function doneMarkers(count: number): string {
  return Array.from({ length: count }, (_, index) =>
    marker(`phase=${index + 1};state=done;step=`),
  ).join("");
}

const PAIRING_MARKER = marker("phase=8;state=waiting;step=pairing");

function viewOf(
  components: Partial<NonNullable<RemoteInstallView["components"]>> | null,
  serviceManager: RemoteInstallView["serviceManager"] = "systemd",
): RemoteInstallView {
  return {
    state: "unknown",
    serviceManager,
    components:
      components === null
        ? null
        : {
            isInstalled: true,
            isServiceQueryable: true,
            isActive: true,
            isAutostart: true,
            isPaired: true,
            isReady: true,
            ...components,
          },
    runnerVersion: null,
    observedAt: null,
    tools: [],
  };
}

interface Fixture {
  readonly conductor: RemoteSetupConductor;
  readonly control: { report: Mock; write: Mock };
  readonly mocks: Record<string, Mock>;
  readonly machine: { connectedAt: string | null };
  readonly calls: string[];
}

function setup(overrides: Record<string, unknown> = {}): Fixture {
  const calls: string[] = [];
  const machine: { connectedAt: string | null } = { connectedAt: null };
  const mocks = {
    requireStart: vi.fn(async () => {
      calls.push("rights");
    }),
    run: vi.fn(async () => {
      calls.push("connection");
    }),
    runnerRequireSetup: vi.fn(async () => undefined),
    transfer: vi.fn(async () => {
      calls.push("upload");
    }),
    verify: vi.fn(async () => {
      calls.push("verification");
    }),
    makeExecutable: vi.fn(async () => {
      calls.push("permissions");
    }),
    connectionRequireSetup: vi.fn(async () => undefined),
    pairing: vi.fn(async () => ({
      endpoint: "wss://e",
      allowInsecureLan: true,
    })),
    authorize: vi.fn(async () => ({ grant: "g" })),
    status: vi.fn(async () => ({ isReady: true })),
    inspect: vi.fn(async () => undefined),
    current: vi.fn(async () => viewOf({})),
    ...overrides,
  };
  const dependencies = {
    userId: "u",
    connectionId: "c",
    pairing: mocks.pairing,
    connections: { requireSetup: mocks.connectionRequireSetup },
    runners: {
      authorize: mocks.authorize,
      requireSetup: mocks.runnerRequireSetup,
      status: mocks.status,
    },
    delivery: {
      transfer: mocks.transfer,
      verify: mocks.verify,
      makeExecutable: mocks.makeExecutable,
      launchCommand: () => "setup.sh",
    },
    sessions: {
      session: () => ({ run: mocks.run }),
      view: () => ({ connectedAt: machine.connectedAt }),
    },
    install: { inspect: mocks.inspect, current: mocks.current },
    requireStart: mocks.requireStart,
  } as unknown as SetupConductorDependencies;
  const control = { report: vi.fn(), write: vi.fn() };
  const conductor = new RemoteSetupConductor(dependencies);
  return { conductor, control, mocks, machine, calls };
}

function lastProgress(control: { report: Mock }): SetupProgress {
  const reports = control.report.mock.calls;
  return reports[reports.length - 1]?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  delay.setTimeout.mockImplementation(async (milliseconds: number) => {
    vi.setSystemTime(Date.now() + milliseconds);
  });
});

describe("RemoteSetupConductor preparation", () => {
  it("knows its command and whether it started", () => {
    const { conductor, control } = setup();

    expect(conductor.command).toBe("setup.sh");
    expect(conductor.hasStarted()).toBe(false);
    conductor.terminalOpened(control);
    expect(conductor.hasStarted()).toBe(true);
    expect(lastProgress(control).step).toBe("start");
  });

  it("prepares every step in order", async () => {
    const { conductor, control, calls } = setup();

    await conductor.prepare(control);

    expect(calls).toEqual([
      "rights",
      "connection",
      "upload",
      "verification",
      "permissions",
    ]);
    expect(lastProgress(control).step).toBe("console");
    expect(delay.setTimeout).not.toHaveBeenCalled();
  });

  it("waits until a fresh connection is stable", async () => {
    const { conductor, control, machine } = setup();
    machine.connectedAt = new Date(Date.now() - 1000).toISOString();

    await conductor.prepare(control);

    expect(delay.setTimeout).toHaveBeenCalledWith(4000);
  });

  it("does not wait for an old connection", async () => {
    const { conductor, control, machine } = setup();
    machine.connectedAt = new Date(Date.now() - 60_000).toISOString();

    await conductor.prepare(control);

    expect(delay.setTimeout).not.toHaveBeenCalled();
  });

  it("passes a remote error of the runner check on", async () => {
    const error = new RemoteError("remote_setup_running");
    const { conductor, control } = setup({
      runnerRequireSetup: vi.fn(async () => {
        throw error;
      }),
    });

    await expect(conductor.prepare(control)).rejects.toBe(error);
  });

  it("turns any other failure of the runner check into an unstable session", async () => {
    const { conductor, control } = setup({
      runnerRequireSetup: vi.fn(async () => {
        throw new Error("x");
      }),
    });

    await expect(conductor.prepare(control)).rejects.toMatchObject({
      code: "remote_setup_unstable",
    });
  });
});

describe("RemoteSetupConductor output", () => {
  it("reports on the first output only once", () => {
    const { conductor, control } = setup();
    conductor.terminalOpened(control);
    control.report.mockClear();

    expect(conductor.filter("", control)).toBe("");
    expect(control.report).not.toHaveBeenCalled();
    expect(conductor.filter("hello", control)).toBe("hello");
    expect(control.report).toHaveBeenCalledTimes(1);
    conductor.filter("more", control);
    expect(control.report).toHaveBeenCalledTimes(1);
    conductor.filter(marker("phase=1;state=running;step="), control);
    expect(control.report).toHaveBeenCalledTimes(2);
  });

  it("hands the pairing over once", async () => {
    const { conductor, control, mocks } = setup();

    conductor.filter(`${doneMarkers(7)}${PAIRING_MARKER}`, control);
    await vi.waitFor(() => expect(control.write).toHaveBeenCalled());
    conductor.filter(PAIRING_MARKER, control);
    await Promise.resolve();

    expect(control.write).toHaveBeenCalledTimes(1);
    expect(control.write).toHaveBeenCalledWith("wss://e\ng\ntrue\n");
    expect(mocks.pairing).toHaveBeenCalledTimes(1);
  });

  it("ignores markers that are refused or ask for nothing", async () => {
    const { conductor, control, mocks } = setup();

    conductor.filter(marker("phase=3;state=running;step="), control);
    conductor.filter(marker("phase=1;state=done;step=pairing"), control);
    conductor.filter(marker("phase=8;state=running;step=pairing"), control);
    conductor.filter(doneMarkers(7), control);
    conductor.filter(marker("phase=8;state=waiting;step=other"), control);
    await Promise.resolve();

    expect(mocks.connectionRequireSetup).not.toHaveBeenCalled();
  });

  it("gives up the pairing with empty lines when it cannot deliver", async () => {
    const { conductor, control } = setup({
      pairing: vi.fn(async () => {
        throw new SetupReasonError("loopbackAddress");
      }),
    });

    conductor.filter(`${doneMarkers(7)}${PAIRING_MARKER}`, control);
    await vi.waitFor(() =>
      expect(control.write).toHaveBeenCalledWith("\n\n\n"),
    );
    await conductor.finish({ exitCode: 1, isTransportFailure: false }, control);

    expect(logCaughtError).toHaveBeenCalled();
    expect(lastProgress(control).reason).toBe(`${PREFIX}loopbackAddress`);
  });
});

describe("RemoteSetupConductor finish", () => {
  it("fails on a lost transport", async () => {
    const { conductor, control } = setup();

    await conductor.finish({ exitCode: 0, isTransportFailure: true }, control);

    expect(lastProgress(control)).toMatchObject({
      outcome: "failed",
      reason: "remote.failure.transport_lost",
    });
  });

  it("confirms only when Pages verifies the installation", async () => {
    const { conductor, control, mocks } = setup();

    await conductor.finish({ exitCode: 0, isTransportFailure: false }, control);

    expect(mocks.inspect).toHaveBeenCalled();
    expect(lastProgress(control)).toMatchObject({
      outcome: "confirmed",
      reason: null,
    });
  });

  it("keeps waiting for the heartbeat before it gives up as partial", async () => {
    const { conductor, control, mocks } = setup();
    mocks.status
      .mockResolvedValueOnce({ isReady: false })
      .mockResolvedValue({ isReady: true });

    await conductor.finish({ exitCode: 0, isTransportFailure: false }, control);

    expect(delay.setTimeout).toHaveBeenCalledWith(3000);
    expect(lastProgress(control).outcome).toBe("confirmed");
  });

  it.each([
    [null, "single", `${PREFIX}notObserved`],
    [{ isInstalled: false }, "systemd", `${PREFIX}notInstalled`],
    [{}, "none", `${PREFIX}noServiceManager`],
    [{ isServiceQueryable: false }, "systemd", `${PREFIX}serviceNotQueryable`],
    [{ isActive: false }, "systemd", `${PREFIX}serviceNotRunning`],
    [{ isAutostart: false }, "systemd", `${PREFIX}serviceNotRunning`],
    [{ isPaired: false }, "systemd", `${PREFIX}notPaired`],
    [{ isReady: false }, "systemd", `${PREFIX}notReady`],
  ] as const)("ends partial for %j", async (components, manager, reason) => {
    const { conductor, control, mocks } = setup();
    mocks.current.mockResolvedValue(
      viewOf(components, manager === "single" ? "systemd" : manager),
    );
    mocks.status.mockResolvedValue({ isReady: false });

    await conductor.finish({ exitCode: 0, isTransportFailure: false }, control);

    expect(lastProgress(control)).toMatchObject({ outcome: "partial", reason });
  });

  it("reports a stopped script as partial", async () => {
    const { conductor, control } = setup();

    await conductor.finish(
      { exitCode: SETUP_EXIT_STOPPED, isTransportFailure: false },
      control,
    );

    expect(lastProgress(control)).toMatchObject({
      outcome: "partial",
      reason: `${PREFIX}stopped`,
    });
  });

  it("fails on another exit status and logs a failed probe", async () => {
    const { conductor, control } = setup({
      inspect: vi.fn(async () => {
        throw new Error("probe");
      }),
    });

    await conductor.finish({ exitCode: 2, isTransportFailure: false }, control);

    expect(logCaughtError).toHaveBeenCalled();
    expect(lastProgress(control)).toMatchObject({
      outcome: "failed",
      reason: `${PREFIX}scriptFailed`,
    });
  });
});

describe("RemoteSetupConductor abort", () => {
  it.each([
    [new SetupReasonError("addressUnknown"), `${PREFIX}addressUnknown`],
    [
      new RemoteError("remote_setup_installed"),
      "remote.error.remote_setup_installed",
    ],
    [new Error("native"), "remote.error.remote_setup_failed"],
  ])("names the reason of %s", (error, reason) => {
    const { conductor, control } = setup();

    conductor.abort(error, control);

    expect(lastProgress(control)).toMatchObject({ outcome: "failed", reason });
  });
});
