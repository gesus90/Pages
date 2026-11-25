import { describe, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { RemoteSetupService } from "./RemoteSetupService";

import type { RemoteInstallView } from "@/definition/RemoteSetup";
import type { RemoteSetupDependencies } from "./RemoteSetupService";

function marker(body: string): string {
  return `\u001b]777;pages-setup;${body}\u0007`;
}

const CONFIRMED_COMPONENTS = {
  isInstalled: true,
  isServiceQueryable: true,
  isActive: true,
  isAutostart: true,
  isPaired: true,
  isReady: true,
};

function viewOf(isConfirmed: boolean | null): RemoteInstallView {
  return {
    state: "unknown",
    serviceManager: null,
    components:
      isConfirmed === null
        ? null
        : { ...CONFIRMED_COMPONENTS, isActive: isConfirmed },
    runnerVersion: null,
    observedAt: null,
    tools: [],
  };
}

interface Fixture {
  readonly service: RemoteSetupService;
  readonly requireSetup: Mock;
  readonly session: { id: string };
  readonly pairing: Mock;
}

function setup(
  view: RemoteInstallView = viewOf(null),
  isPaired = false,
): Fixture {
  const requireSetup = vi.fn(async () => ({ host: "ssh.example" }));
  const session = { id: "session", run: vi.fn(async () => undefined) };
  const pairing = vi.fn(async () => ({
    endpoint: "wss://x",
    allowInsecureLan: false,
  }));
  const dependencies = {
    connections: { requireSetup },
    runners: {
      status: vi.fn(async () => ({ isPaired })),
      requireSetup: vi.fn(async () => undefined),
      authorize: vi.fn(async () => ({ grant: "grant" })),
    },
    delivery: {
      launchCommand: () => "run-setup",
      transfer: vi.fn(async () => undefined),
      verify: vi.fn(async () => undefined),
      makeExecutable: vi.fn(async () => undefined),
    },
    sessions: {
      session: vi.fn(() => session),
      view: () => ({ connectedAt: null }),
    },
    install: { current: vi.fn(async () => view) },
    maintenance: { pairing },
  } as unknown as RemoteSetupDependencies;
  return {
    service: new RemoteSetupService(dependencies),
    requireSetup,
    session,
    pairing,
  };
}

describe("RemoteSetupService", () => {
  it("checks the access rights", async () => {
    const { service, requireSetup } = setup();

    await service.requireAccess("u", "c");

    expect(requireSetup).toHaveBeenCalledWith("u", "c");
  });

  it("allows a start with nothing installed", async () => {
    await expect(
      setup().service.requireStart("u", "c"),
    ).resolves.toBeUndefined();
  });

  it("refuses a start after a confirmed installation", async () => {
    await expect(
      setup(viewOf(true)).service.requireStart("u", "c"),
    ).rejects.toMatchObject({ code: "remote_setup_installed" });
  });

  it("refuses a start while a registration exists", async () => {
    await expect(
      setup(viewOf(false), true).service.requireStart("u", "c"),
    ).rejects.toMatchObject({ code: "remote_setup_registered" });
  });

  it("builds a target whose conductor checks the start and asks for the pairing", async () => {
    const { service, session, pairing } = setup();
    const control = { report: vi.fn(), write: vi.fn() };

    const target = await service.target("u", "c", { origin: "https://o" });
    await target.conductor?.prepare(control);
    const phases = [1, 2, 3, 4, 5, 6, 7]
      .map((phase) => marker(`phase=${phase};state=done;step=`))
      .join("");
    target.conductor?.filter(
      `${phases}${marker("phase=8;state=waiting;step=pairing")}`,
      control,
    );

    expect(target.session).toBe(session);
    expect(target.path).toBeNull();
    expect(target.conductor?.command).toBe("run-setup");
    await vi.waitFor(() =>
      expect(control.write).toHaveBeenCalledWith("wss://x\ngrant\nfalse\n"),
    );
    expect(pairing).toHaveBeenCalledWith("c", "https://o", "ssh.example");
  });
});
