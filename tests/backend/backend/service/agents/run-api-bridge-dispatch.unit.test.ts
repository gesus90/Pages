import { describe, expect, it, vi } from "vitest";

import {
  RunApiBridge,
  runApiSocketPath,
} from "@/backend/service/agents/runs/RunApiBridge";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { RunApiServices } from "@/backend/service/agents/runs/RunApiBridge";

type Handler = (request: unknown) => Promise<unknown>;
const mocks = vi.hoisted(() => ({
  handler: null as Handler | null,
  ownership: vi.fn(),
  listen: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/backend/service/agents/runs/RunsSocket", () => ({
  RunsSocket: class {
    public listen = mocks.listen;
    public close = mocks.close;
    public constructor(path: string, onError: () => void, handler: Handler) {
      void path;
      void onError;
      mocks.handler = handler;
    }
  },
}));
vi.mock("@/backend/runtime/RunsMode", () => ({
  hasRunApiOwnership: mocks.ownership,
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

function fixture(): {
  bridge: RunApiBridge;
  services: RunApiServices;
  handler: Handler;
} {
  mocks.ownership.mockReturnValue(true);
  mocks.listen.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
  const services = partial<RunApiServices>({
    runners: partial({
      availability: vi.fn().mockResolvedValue(null),
      supportsPagesAccess: () => true,
      supportsAssetFiles: () => false,
      supportsLargeAssetFiles: () => false,
      supportsOpenCode: () => true,
      supportsExactResultPayload: () => true,
      supportsContinuation: () => true,
      contact: () => ({ state: "connected", lastContactAt: null }),
      ready: vi.fn().mockResolvedValue("ready"),
      cancel: vi.fn().mockResolvedValue(undefined),
      pauseQueued: vi.fn().mockResolvedValue(undefined),
    }),
    provider: partial({ catalog: vi.fn().mockResolvedValue("catalog") }),
    pages: partial({
      recover: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }),
    cleanup: partial({
      pending: vi.fn().mockResolvedValue([]),
      complete: vi.fn().mockResolvedValue(undefined),
    }),
    runs: partial({ find: vi.fn().mockResolvedValue(null) }),
    planAccess: partial({
      grant: vi.fn().mockResolvedValue({ token: "token", tools: ["one"] }),
      revoke: vi.fn().mockResolvedValue(undefined),
    }),
  });
  const bridge = new RunApiBridge(services, { databasePath: "/virtual/db" });
  if (!mocks.handler) throw new Error("Missing handler");
  return { bridge, services, handler: mocks.handler };
}

describe("run API bridge dispatch", () => {
  it("requires ownership and starts and closes its mocked socket", async () => {
    const { bridge } = fixture();
    expect(runApiSocketPath("/virtual/db")).toBe("/virtual/runs-api/api.sock");
    mocks.ownership.mockReturnValueOnce(false);
    await expect(bridge.start()).rejects.toThrow("ownership");
    await bridge.start();
    await bridge.close();
    expect(mocks.listen).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("dispatches authenticated runner operations and capability cleanup", async () => {
    const { handler, services } = fixture();
    await expect(
      handler({ version: 1, operation: "facts", connectionId: "c" }),
    ).resolves.toMatchObject({ pages: true, assets: false, openCode: true });
    await expect(
      handler({
        version: 1,
        operation: "ready",
        connectionId: "c",
        userId: "u",
      }),
    ).resolves.toBe("ready");
    await expect(
      handler({
        version: 1,
        operation: "providerCatalog",
        connectionId: "c",
        userId: "u",
      }),
    ).resolves.toBe("catalog");
    await handler({
      version: 1,
      operation: "cancel",
      connectionId: "c",
      jobId: "j",
    });
    await handler({
      version: 1,
      operation: "pauseQueued",
      connectionId: "c",
      jobId: "j",
    });
    await handler({
      version: 1,
      operation: "closePages",
      runId: "r",
      stepId: "s",
      attemptId: "a",
    });
    expect(services.cleanup.complete).toHaveBeenCalledWith("a");
    await expect(
      handler({
        version: 1,
        operation: "openPages",
        runId: "r",
        stepId: "s",
        attemptId: "a",
      }),
    ).rejects.toThrow();
  });

  it("opens and closes plan bridge credentials without exposing internal fields", async () => {
    const { handler, services } = fixture();
    await expect(
      handler({
        version: 1,
        operation: "openPlanBridge",
        userId: "u",
        runId: "r",
        stepId: "s",
        instanceId: "i",
        tickets: [],
        lifetimeMs: 1000,
        reach: "read",
      }),
    ).resolves.toEqual({ access: { token: "token", tools: ["one"] } });
    await handler({
      version: 1,
      operation: "closePlanBridge",
      runId: "r",
      stepId: null,
    });
    expect(services.planAccess.revoke).toHaveBeenCalledWith("r", null);
  });
});
