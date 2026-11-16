import { expect, it } from "vitest";

import {
  bindingOf,
  installViewOf,
  isInstallConfirmed,
  isSameBinding,
} from "@/backend/service/remote/setup/RemoteInstallView";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { InstallFinding } from "@/definition/RemoteSetup";

it("binds observations to host, account and confirmed key", () => {
  expect(
    bindingOf({
      host: "HOST",
      port: 22,
      username: "user",
      hostKeyFingerprint: null,
    }),
  ).toBeNull();
  const binding = bindingOf({
    host: "HOST",
    port: 22,
    username: "user",
    hostKeyFingerprint: "key",
  });
  expect(binding).toEqual({
    host: "host",
    port: 22,
    username: "user",
    hostKeyFingerprint: "key",
  });
  if (!binding) throw new Error("Expected binding");
  expect(isSameBinding(binding, { ...binding, port: 23 })).toBe(false);
  expect(isSameBinding(binding, { ...binding })).toBe(true);
});

it("distinguishes unknown, partial and confirmed installation facts", () => {
  const live = { isPaired: true, isReady: false };
  expect(installViewOf({ finding: null, live, isRunning: false }).state).toBe(
    "unknown",
  );
  const finding = partial<InstallFinding>({
    observation: {
      isRunnerInstalled: true,
      isServiceInstalled: true,
      serviceManager: "systemd",
      canQueryService: true,
      isServiceActive: true,
      isServiceEnabled: true,
      tools: [],
    },
  });
  const confirmed = installViewOf({ finding, live, isRunning: false });
  expect(confirmed.state).toBe("confirmed");
  expect(confirmed.components && isInstallConfirmed(confirmed.components)).toBe(
    true,
  );
  expect(
    installViewOf({
      finding,
      live: { isPaired: false, isReady: false },
      isRunning: false,
    }).state,
  ).toBe("partial");
  expect(installViewOf({ finding, live, isRunning: true }).state).toBe(
    "running",
  );
});
