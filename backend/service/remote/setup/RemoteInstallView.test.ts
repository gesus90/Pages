import { describe, expect, it } from "vitest";

import {
  bindingOf,
  installViewOf,
  isInstallConfirmed,
  isSameBinding,
} from "./RemoteInstallView";

import type { HostObservation, InstallFinding } from "@/definition/RemoteSetup";

const LIVE = { isPaired: false, isReady: false };

function findingOf(overrides: Partial<HostObservation> = {}): InstallFinding {
  return {
    binding: {
      host: "h",
      port: 22,
      username: "u",
      hostKeyFingerprint: "fp",
    },
    observedAt: "2026-01-01T00:00:00.000Z",
    observation: {
      isUbuntu: true,
      architecture: "x86_64",
      serviceManager: "systemd",
      canQueryService: true,
      isRunnerInstalled: false,
      runnerVersion: null,
      isServiceInstalled: false,
      isServiceEnabled: false,
      isServiceActive: false,
      tools: [],
      ...overrides,
    },
  };
}

describe("bindingOf", () => {
  it("needs a pinned key and lowercases the host", () => {
    const identity = { host: "HOST", port: 22, username: "u" };

    expect(bindingOf({ ...identity, hostKeyFingerprint: null })).toBeNull();
    expect(bindingOf({ ...identity, hostKeyFingerprint: "fp" })).toEqual({
      host: "host",
      port: 22,
      username: "u",
      hostKeyFingerprint: "fp",
    });
  });
});

describe("isSameBinding", () => {
  const base = {
    host: "h",
    port: 22,
    username: "u",
    hostKeyFingerprint: "fp",
  };

  it("compares every part", () => {
    expect(isSameBinding(base, { ...base })).toBe(true);
    expect(isSameBinding(base, { ...base, host: "x" })).toBe(false);
    expect(isSameBinding(base, { ...base, port: 1 })).toBe(false);
    expect(isSameBinding(base, { ...base, username: "x" })).toBe(false);
    expect(isSameBinding(base, { ...base, hostKeyFingerprint: "x" })).toBe(
      false,
    );
  });
});

describe("isInstallConfirmed", () => {
  const all = {
    isInstalled: true,
    isServiceQueryable: true,
    isActive: true,
    isAutostart: true,
    isPaired: true,
    isReady: false,
  };

  it("needs installed, active, autostart and paired", () => {
    expect(isInstallConfirmed(all)).toBe(true);
    expect(isInstallConfirmed({ ...all, isInstalled: false })).toBe(false);
    expect(isInstallConfirmed({ ...all, isActive: false })).toBe(false);
    expect(isInstallConfirmed({ ...all, isAutostart: false })).toBe(false);
    expect(isInstallConfirmed({ ...all, isPaired: false })).toBe(false);
  });
});

describe("installViewOf", () => {
  it("is unknown or running without a finding", () => {
    expect(
      installViewOf({ finding: null, live: LIVE, isRunning: false }).state,
    ).toBe("unknown");
    const running = installViewOf({
      finding: null,
      live: LIVE,
      isRunning: true,
    });
    expect(running.state).toBe("running");
    expect(running.components).toBeNull();
  });

  it("is running while a setup holds the connection", () => {
    expect(
      installViewOf({ finding: findingOf(), live: LIVE, isRunning: true })
        .state,
    ).toBe("running");
  });

  it("is not installed when nothing exists", () => {
    const view = installViewOf({
      finding: findingOf(),
      live: LIVE,
      isRunning: false,
    });

    expect(view.state).toBe("not_installed");
    expect(view.serviceManager).toBe("systemd");
    expect(view.observedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("is partial when any part exists", () => {
    const state = (overrides: Partial<HostObservation>, live = LIVE): string =>
      installViewOf({
        finding: findingOf(overrides),
        live,
        isRunning: false,
      }).state;

    expect(state({ isRunnerInstalled: true })).toBe("partial");
    expect(state({ isServiceInstalled: true })).toBe("partial");
    expect(state({ isServiceActive: true })).toBe("partial");
    expect(state({ isServiceEnabled: true })).toBe("partial");
    expect(state({}, { isPaired: true, isReady: false })).toBe("partial");
  });

  it("is confirmed when everything holds", () => {
    const view = installViewOf({
      finding: findingOf({
        isRunnerInstalled: true,
        isServiceInstalled: true,
        isServiceActive: true,
        isServiceEnabled: true,
        runnerVersion: "1.0.0",
      }),
      live: { isPaired: true, isReady: true },
      isRunning: false,
    });

    expect(view.state).toBe("confirmed");
    expect(view.runnerVersion).toBe("1.0.0");
  });

  it("counts a runner without a service manager as installed but never confirmed", () => {
    const view = installViewOf({
      finding: findingOf({ isRunnerInstalled: true, serviceManager: "none" }),
      live: { isPaired: true, isReady: true },
      isRunning: false,
    });

    expect(view.components?.isInstalled).toBe(true);
    expect(view.state).toBe("partial");
  });
});
