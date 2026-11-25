import { beforeEach, describe, expect, it, vi } from "vitest";

import { logCaughtError } from "@/backend/logging/Logger";

import { RemoteInstallService } from "./RemoteInstallService";

import type { RemoteInstallFindingRepository } from "@/backend/database/repositories/remote/RemoteInstallFindingRepository";
import type { RemoteConnectionRepository } from "@/backend/database/repositories/remote/RemoteConnectionRepository";
import type { RemoteSessionRegistry } from "@/backend/remote/RemoteSessionRegistry";
import type { InstallFinding } from "@/definition/RemoteSetup";
import type { RemoteInstallLinks } from "./RemoteInstallService";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

interface Identity {
  id: string;
  host: string;
  port: number;
  username: string;
  hostKey: { algorithm: string; key: string; fingerprint: string } | null;
}

function identityOf(overrides: Partial<Identity> = {}): Identity {
  return {
    id: "c1",
    host: "Host",
    port: 22,
    username: "u",
    hostKey: { algorithm: "a", key: "k", fingerprint: "fp" },
    ...overrides,
  };
}

function findingOf(): InstallFinding {
  return {
    binding: {
      host: "host",
      port: 22,
      username: "u",
      hostKeyFingerprint: "fp",
    },
    observedAt: "2026-01-01T00:00:00.000Z",
    observation: {
      isUbuntu: null,
      architecture: null,
      serviceManager: "systemd",
      canQueryService: true,
      isRunnerInstalled: true,
      runnerVersion: null,
      isServiceInstalled: true,
      isServiceEnabled: true,
      isServiceActive: true,
      tools: [],
    },
  };
}

function setup(): {
  service: RemoteInstallService;
  find: ReturnType<typeof vi.fn>;
  stored: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
} {
  const find = vi.fn(async () => identityOf());
  const stored = vi.fn(async () => findingOf());
  const save = vi.fn(async () => undefined);
  const run = vi.fn(async () => ({ exitCode: 0, stdout: "probe=complete" }));
  const service = new RemoteInstallService({
    findings: {
      find: stored,
      save,
    } as unknown as RemoteInstallFindingRepository,
    connections: { find } as unknown as Pick<
      RemoteConnectionRepository,
      "find"
    >,
    sessions: {
      session: () => ({ run }),
    } as unknown as RemoteSessionRegistry,
  });
  return { service, find, stored, save, run };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RemoteInstallService.inspect", () => {
  it("stores the finding of a probe", async () => {
    const { service, save } = setup();

    await service.inspect("c1");

    expect(save).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({
        binding: {
          host: "host",
          port: 22,
          username: "u",
          hostKeyFingerprint: "fp",
        },
      }),
    );
  });

  it("shares one probe between concurrent calls", async () => {
    const { service, run } = setup();

    await Promise.all([service.inspect("c1"), service.inspect("c1")]);
    await service.inspect("c1");

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a connection or a pinned key", async () => {
    const { service, find, run } = setup();
    find.mockResolvedValueOnce(null);
    await service.inspect("c1");
    find.mockResolvedValueOnce(identityOf({ hostKey: null }));
    await service.inspect("c1");

    expect(run).not.toHaveBeenCalled();
  });

  it("fails when the probe fails", async () => {
    const { service, run } = setup();
    run.mockResolvedValueOnce({ exitCode: 1, stdout: "" });

    await expect(service.inspect("c1")).rejects.toThrow("Install probe failed");
  });

  it("drops a result when the connection changed or vanished meanwhile", async () => {
    const { service, find, save } = setup();
    find
      .mockResolvedValueOnce(identityOf())
      .mockResolvedValueOnce(identityOf({ host: "other" }));
    await service.inspect("c1");
    find.mockResolvedValueOnce(identityOf()).mockResolvedValueOnce(null);
    await service.inspect("c1");

    expect(save).not.toHaveBeenCalled();
  });
});

describe("RemoteInstallService.inspectAfterConnect", () => {
  it("logs a failure instead of throwing", async () => {
    const { service, run } = setup();
    run.mockRejectedValueOnce(new Error("boom"));

    service.inspectAfterConnect("c1");

    await vi.waitFor(() => expect(logCaughtError).toHaveBeenCalled());
  });

  it("probes quietly on success", async () => {
    const { service, save } = setup();

    service.inspectAfterConnect("c1");

    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    expect(logCaughtError).not.toHaveBeenCalled();
  });
});

describe("RemoteInstallService views", () => {
  const links: RemoteInstallLinks = {
    runnerStatus: async () => ({ isPaired: true, isReady: true }),
    isSetupRunning: () => false,
  };

  it("believes a finding that matches the connection", async () => {
    const { service } = setup();
    service.attach(links);

    const views = await service.views([identityOf()]);

    expect(views.c1?.state).toBe("confirmed");
  });

  it("is unknown without links and when the binding changed", async () => {
    const { service, stored } = setup();

    const unlinked = await service.views([identityOf()]);
    const changed = await service.views([identityOf({ port: 2222 })]);
    const unpinned = await service.views([identityOf({ hostKey: null })]);
    stored.mockResolvedValueOnce(null);
    const missing = await service.views([identityOf()]);

    expect(unlinked.c1?.state).toBe("partial");
    expect(changed.c1?.state).toBe("unknown");
    expect(unpinned.c1?.state).toBe("unknown");
    expect(missing.c1?.state).toBe("unknown");
  });

  it("reports a running setup", async () => {
    const { service } = setup();
    service.attach({ ...links, isSetupRunning: () => true });

    expect((await service.current("c1")).state).toBe("running");
  });

  it("is unknown for a connection that does not exist", async () => {
    const { service, find } = setup();
    find.mockResolvedValueOnce(null);

    expect((await service.current("c1")).state).toBe("unknown");
  });
});
