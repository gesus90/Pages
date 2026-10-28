import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createServerSettingsService,
  handleSystemSettingsAction,
  handleUpdatePort,
} from "@/app/lib/settings-actions/settings-system-actions.server";
import { ServerSettingsDeniedError } from "@/backend/service/ServerSettingsService";

import {
  ACTOR,
  callArgument,
  outcomeOf,
  settingsContext,
  thrownStatus,
} from "./action-fixtures";

import type { MockInstance } from "vitest";
import type { FormFields } from "./action-fixtures";

const holder = vi.hoisted(() => ({
  updatePort: vi.fn(),
  updateAcpResources: vi.fn(),
  updateLogging: vi.fn(),
  created: [] as unknown[][],
}));

vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: async () => ({ configFile: "synthetic-config" }),
}));
vi.mock("@/backend/service/ServerSettingsService", () => {
  class DeniedError extends Error {}

  class ServerSettingsService {
    public readonly updatePort = holder.updatePort;
    public readonly updateAcpResources = holder.updateAcpResources;
    public readonly updateLogging = holder.updateLogging;

    public constructor(...parameters: unknown[]) {
      holder.created.push(parameters);
    }
  }

  return {
    ServerSettingsDeniedError: DeniedError,
    ServerSettingsService,
  };
});

const services = {
  permissionService: { allows: vi.fn() },
  administrationService: { setMode: vi.fn(), getContext: vi.fn() },
};

beforeEach(() => {
  vi.resetAllMocks();
  holder.created.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function updatePort(fields: FormFields): Promise<unknown> {
  return outcomeOf(await handleUpdatePort(settingsContext(services, fields)));
}

function silenceErrors(): MockInstance<typeof console.error> {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("createServerSettingsService", () => {
  it("binds the service to the configuration file and the permissions", async () => {
    await createServerSettingsService({
      services: settingsContext(services, {}).services,
    });

    expect(holder.created).toEqual([
      ["synthetic-config", services.permissionService],
    ]);
  });
});

describe("handleUpdatePort", () => {
  it("stores a numeric port for the signed-in user", async () => {
    holder.updatePort.mockResolvedValue(true);

    expect(await updatePort({ port: " 8080 " })).toMatchObject({
      body: { intent: "update-port", ok: true, port: 8080 },
      status: 200,
    });
    expect(holder.updatePort).toHaveBeenCalledWith(ACTOR, 8080);
  });

  it.each(["80a", "", "-1", "1.5", "0x50", "8080 8081"])(
    "hands %j over as not a number",
    async (port) => {
      holder.updatePort.mockResolvedValue(false);

      await updatePort({ port });

      expect(callArgument(holder.updatePort, 0, 1)).toBeNaN();
    },
  );

  it("hands a missing port over as not a number", async () => {
    holder.updatePort.mockResolvedValue(false);

    await updatePort({});

    expect(callArgument(holder.updatePort, 0, 1)).toBeNaN();
  });

  it("reports a refused port as invalid", async () => {
    holder.updatePort.mockResolvedValue(false);

    expect(await updatePort({ port: "70000" })).toMatchObject({
      body: { intent: "update-port", ok: false, error: "invalidPort" },
      status: 400,
    });
  });

  it("answers 403 for an actor without the right", async () => {
    holder.updatePort.mockRejectedValue(new ServerSettingsDeniedError());

    const status = await thrownStatus(
      handleUpdatePort(settingsContext(services, { port: "8080" })),
    );

    expect(status).toBe(403);
  });

  it("answers 500 for a failure and logs it", async () => {
    const logged = silenceErrors();
    holder.updatePort.mockRejectedValue(new Error("read-only file system"));

    expect(await updatePort({ port: "8080" })).toMatchObject({
      body: { intent: "update-port", ok: false, error: "general" },
      status: 500,
    });
    expect(logged).toHaveBeenCalledOnce();
  });
});

describe("handleSystemSettingsAction", () => {
  it.each(["", "update-profile", "unknown", "constructor", "__proto__"])(
    "answers 400 for the intent %j",
    async (intent) => {
      const status = await thrownStatus(
        handleSystemSettingsAction(
          intent,
          settingsContext(services, { intent }),
        ),
      );

      expect(status).toBe(400);
      expect(holder.updatePort).not.toHaveBeenCalled();
    },
  );

  it("answers 400 for a missing intent", async () => {
    const status = await thrownStatus(
      handleSystemSettingsAction(null, settingsContext(services, {})),
    );

    expect(status).toBe(400);
  });

  it("runs the handler of a known intent", async () => {
    holder.updatePort.mockResolvedValue(true);

    const result = await handleSystemSettingsAction(
      "update-port",
      settingsContext(services, { port: "8081" }),
    );

    expect(await outcomeOf(result)).toMatchObject({
      body: { ok: true, port: 8081 },
    });
  });

  it("offers the mode switch in the system area", async () => {
    const result = await handleSystemSettingsAction(
      "set-mode",
      settingsContext(services, { mode: "role" }),
    );

    expect(await outcomeOf(result)).toMatchObject({
      body: { intent: "set-mode", ok: true },
    });
    expect(services.administrationService.setMode).toHaveBeenCalledWith(
      ACTOR.id,
      "role",
    );
  });

  it("dispatches the log retention form to the system settings service", async () => {
    services.administrationService.getContext.mockResolvedValue({
      isActive: true,
      isAdmin: true,
      mode: "admin",
    });
    holder.updateLogging.mockResolvedValue(true);

    const result = await handleSystemSettingsAction(
      "update-logging",
      settingsContext(services, { logRetentionDays: "30" }),
    );

    expect(await outcomeOf(result)).toMatchObject({
      body: { intent: "update-logging", ok: true, retentionDays: 30 },
    });
    expect(holder.updateLogging).toHaveBeenCalledWith(ACTOR, 30);
    expect(holder.created).toEqual([
      ["synthetic-config", services.permissionService],
    ]);
  });

  it("dispatches the ACP limit form to the existing system settings service", async () => {
    services.administrationService.getContext.mockResolvedValue({
      isActive: true,
      isAdmin: true,
      mode: "admin",
    });
    holder.updateAcpResources.mockResolvedValue({
      ok: false,
      error: "invalidSetting",
    });
    const result = await handleSystemSettingsAction(
      "update-acp-resources",
      settingsContext(services, { maxConcurrentAcpSessions: "invalid" }),
    );
    expect(await outcomeOf(result)).toMatchObject({
      status: 400,
      body: {
        intent: "update-acp-resources",
        ok: false,
        error: "invalidSetting",
      },
    });
    expect(holder.updateAcpResources).toHaveBeenCalledWith(
      ACTOR,
      Number.NaN,
      undefined,
    );
  });
});
