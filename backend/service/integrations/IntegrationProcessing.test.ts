import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  acquire: vi.fn(),
  lost: null as (() => void) | null,
  logEvent: vi.fn(),
  url: "",
}));

vi.mock(
  "@/backend/database/repositories/integrations/IntegrationOwnerRepository",
  () => ({
    /** Double of the session lock owner. */
    IntegrationOwnerRepository: class {
      public constructor(databaseUrl: string, lost: () => void) {
        state.url = databaseUrl;
        state.lost = lost;
      }
      /** Returns the configured acquisition result. */
      public acquire(): Promise<boolean> {
        return state.acquire();
      }
    },
  }),
);
vi.mock("@/backend/logging/Logger", () => ({ logEvent: state.logEvent }));

import type * as ProcessingModule from "./IntegrationProcessing";
import type { PagesConfig } from "@/backend/config/PagesConfig";

function configOf(overrides: Record<string, unknown> = {}): PagesConfig {
  return {
    firstRun: false,
    databaseUrl: "postgres://x",
    ...overrides,
  } as unknown as PagesConfig;
}

let processing: typeof ProcessingModule;

beforeEach(async () => {
  vi.resetModules();
  state.acquire.mockReset();
  state.logEvent.mockReset();
  processing = await import("./IntegrationProcessing");
});

describe("IntegrationProcessing", () => {
  it("is not an owner initially", () => {
    expect(processing.canProcessIntegrations()).toBe(false);
  });

  it("skips another role", async () => {
    await expect(
      processing.claimIntegrationProcessing(configOf(), "separate"),
    ).resolves.toBe(false);
    await expect(
      processing.claimIntegrationProcessing(
        configOf({ integrationsMode: "separate" }),
        "server",
      ),
    ).resolves.toBe(false);
  });

  it("requires completed setup", async () => {
    await expect(
      processing.claimIntegrationProcessing(
        configOf({ firstRun: true }),
        "server",
      ),
    ).rejects.toThrow("PostgreSQL");
    await expect(
      processing.claimIntegrationProcessing(
        configOf({ databaseUrl: "" }),
        "server",
      ),
    ).rejects.toThrow("PostgreSQL");
  });

  it("acquires ownership once and stops", async () => {
    state.acquire.mockResolvedValue(true);
    await expect(
      processing.claimIntegrationProcessing(configOf(), "server"),
    ).resolves.toBe(true);
    expect(processing.canProcessIntegrations()).toBe(true);
    await expect(
      processing.claimIntegrationProcessing(configOf(), "server"),
    ).resolves.toBe(true);
    expect(state.acquire).toHaveBeenCalledTimes(1);
    processing.stopIntegrationProcessing();
    expect(processing.canProcessIntegrations()).toBe(false);
  });

  it("reports a refused acquisition", async () => {
    state.acquire.mockResolvedValue(false);
    await expect(
      processing.claimIntegrationProcessing(configOf(), "server"),
    ).resolves.toBe(false);
    expect(processing.canProcessIntegrations()).toBe(false);
  });

  it("terminates when ownership is lost", async () => {
    state.acquire.mockResolvedValue(true);
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    await processing.claimIntegrationProcessing(configOf(), "server");
    state.lost?.();
    expect(processing.canProcessIntegrations()).toBe(false);
    expect(state.logEvent).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockRestore();
  });
});
