import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AutomationError } from "@/backend/error/AutomationError";
import {
  AutomationOperationService,
  translateAutomationError,
} from "./AutomationOperationService";

import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { AutomationService } from "./AutomationService";

const mocks = vi.hoisted(() => ({ logCaughtError: vi.fn() }));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
}));

const automations = {
  options: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  runs: vi.fn(),
  run: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  setActive: vi.fn(),
  runNow: vi.fn(),
  delete: vi.fn(),
};

const IDENTITY = { userId: "u1" } as unknown as AgentIdentity;

function service(): AutomationOperationService {
  return new AutomationOperationService({
    automations: automations as unknown as AutomationService,
  });
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  return null;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("translateAutomationError", () => {
  it("passes foreign errors through", () => {
    const error = new Error("x");
    expect(translateAutomationError(error)).toBe(error);
  });

  it.each([
    ["invalid_request", "INVALID_REQUEST"],
    ["forbidden", "FORBIDDEN"],
    ["not_found", "NOT_FOUND"],
    ["conflict", "CONFLICT"],
    ["too_large", "PAYLOAD_TOO_LARGE"],
    ["rate_limited", "INVALID_REQUEST"],
    ["server_unavailable", "INVALID_REQUEST"],
  ] as const)("maps %s to %s", (code, expected) => {
    const result = translateAutomationError(new AutomationError(code));
    expect(result).toBeInstanceOf(AgentOperationError);
    expect(result).toMatchObject({ code: expected, details: undefined });
  });

  it("keeps the revision of a conflict", () => {
    const error = new AutomationError("conflict", { currentRevision: 3 });
    expect(translateAutomationError(error)).toMatchObject({
      details: { currentRevision: 3 },
    });
  });

  it("keeps the problems of a validation", () => {
    const error = new AutomationError("invalid_request", {
      reason: "validation",
      problems: ["a"],
    });
    expect(translateAutomationError(error)).toMatchObject({
      details: { reason: "validation", problems: ["a"] },
    });
  });

  it("names an unavailable workspace", () => {
    const error = new AutomationError("invalid_request", {
      reason: "workspace_unavailable",
    });
    expect(translateAutomationError(error)).toMatchObject({
      details: { reason: "workspace_unavailable" },
    });
  });

  it("names other reasons", () => {
    const error = new AutomationError("forbidden", { reason: "read_only" });
    expect(translateAutomationError(error)).toMatchObject({
      details: { reason: "read_only" },
    });
  });

  it("names a conflict without revision by its reason", () => {
    const error = new AutomationError("conflict", { reason: "run_active" });
    expect(translateAutomationError(error)).toMatchObject({
      details: { reason: "run_active" },
    });
  });
});

describe("handle", () => {
  it("returns null for foreign operations", async () => {
    expect(await service().handle(IDENTITY, "tickets.read", {})).toBeNull();
    expect(await service().handle(IDENTITY, 5, {})).toBeNull();
  });

  it.each([
    ["automations.options.read", "options", false],
    ["automations.list", "list", true],
    ["automations.read", "read", true],
    ["automations.runs.list", "runs", true],
    ["automations.runs.read", "run", true],
  ] as const)("reads %s", async (operation, method, takesInput) => {
    automations[method].mockResolvedValue({ ok: operation });
    const response = await service().handle(IDENTITY, operation, { x: 1 });
    expect(response).toEqual({ apiVersion: "1", result: { ok: operation } });
    expect(automations[method]).toHaveBeenCalledWith(
      ...(takesInput ? ["u1", { x: 1 }] : ["u1"]),
    );
  });

  it.each([
    ["automations.create", "create"],
    ["automations.update", "update"],
    ["automations.setActive", "setActive"],
    ["automations.run", "runNow"],
    ["automations.delete", "delete"],
  ] as const)("writes %s", async (operation, method) => {
    automations[method].mockResolvedValue({ ok: operation });
    const response = await service().handle(IDENTITY, operation, { x: 1 });
    expect(response).toEqual({ apiVersion: "1", result: { ok: operation } });
    expect(automations[method]).toHaveBeenCalledWith("u1", { x: 1 });
  });

  it("refuses an oversized response", async () => {
    automations.list.mockResolvedValue("x".repeat(1_048_577));
    const error = await failureOf(
      service().handle(IDENTITY, "automations.list", {}),
    );
    expect(error).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(mocks.logCaughtError).toHaveBeenCalledWith(
      "AutomationOperationService",
      expect.any(AgentOperationError),
    );
  });

  it("translates a refusal of the service", async () => {
    automations.create.mockRejectedValue(new AutomationError("forbidden"));
    const error = await failureOf(
      service().handle(IDENTITY, "automations.create", {}),
    );
    expect(error).toBeInstanceOf(AgentOperationError);
    expect(error).toMatchObject({ code: "FORBIDDEN" });
  });
});
