import { expect, it, vi } from "vitest";

import { RemoteSetupConductor } from "@/backend/service/remote/setup/RemoteSetupConductor";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { ConductorControl } from "@/backend/service/remote/RemoteConsoleConductor";
import type { SetupConductorDependencies } from "@/backend/service/remote/setup/RemoteSetupConductor";

it("reports preparation and refuses before delivery when rights fail", async () => {
  const transfer = vi.fn();
  const report = vi.fn();
  const conductor = new RemoteSetupConductor(
    partial<SetupConductorDependencies>({
      delivery: { launchCommand: () => "setup", transfer },
      requireStart: async () => {
        throw new Error("denied");
      },
    }),
  );
  const control = partial<ConductorControl>({ report });
  await expect(conductor.prepare(control)).rejects.toThrow("denied");
  expect(report).toHaveBeenCalled();
  expect(transfer).not.toHaveBeenCalled();
  expect(conductor.hasStarted()).toBe(false);
});

it("marks a transport failure and records opening only once", async () => {
  const report = vi.fn();
  const conductor = new RemoteSetupConductor(
    partial<SetupConductorDependencies>({
      delivery: { launchCommand: () => "setup" },
    }),
  );
  const control = partial<ConductorControl>({ report });
  conductor.terminalOpened(control);
  expect(conductor.hasStarted()).toBe(true);
  await conductor.finish(partial({ isTransportFailure: true }), control);
  expect(report).toHaveBeenLastCalledWith(
    expect.objectContaining({ reason: "remote.failure.transport_lost" }),
  );
});
