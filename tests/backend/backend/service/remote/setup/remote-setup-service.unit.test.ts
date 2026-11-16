import { expect, it, vi } from "vitest";

import { RemoteSetupService } from "@/backend/service/remote/setup/RemoteSetupService";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { RemoteSetupDependencies } from "@/backend/service/remote/setup/RemoteSetupService";

it("requires current setup rights and rejects installed or registered runners", async () => {
  const requireSetup = vi.fn(async () => ({}));
  const status = vi.fn(async () => ({ isPaired: false }));
  const components = {
    isInstalled: true,
    isActive: true,
    isAutostart: true,
    isPaired: true,
  };
  const service = new RemoteSetupService(
    partial<RemoteSetupDependencies>({
      connections: { requireSetup },
      runners: { status },
      install: { current: async () => ({ components }) },
    }),
  );
  await expect(
    service.requireStart("user", "connection"),
  ).rejects.toMatchObject({ code: "remote_setup_installed" });
  expect(requireSetup).toHaveBeenCalledWith("user", "connection");
  expect(status).not.toHaveBeenCalled();
  const registered = new RemoteSetupService(
    partial<RemoteSetupDependencies>({
      connections: { requireSetup },
      runners: { status: async () => ({ isPaired: true }) },
      install: { current: async () => ({ components: null }) },
    }),
  );
  await expect(
    registered.requireStart("user", "connection"),
  ).rejects.toMatchObject({ code: "remote_setup_registered" });
});

it("allows setup only when no confirmed installation or pairing exists", async () => {
  const service = new RemoteSetupService(
    partial<RemoteSetupDependencies>({
      connections: { requireSetup: async () => ({}) },
      runners: { status: async () => ({ isPaired: false }) },
      install: { current: async () => ({ components: null }) },
    }),
  );
  await expect(
    service.requireStart("user", "connection"),
  ).resolves.toBeUndefined();
});
