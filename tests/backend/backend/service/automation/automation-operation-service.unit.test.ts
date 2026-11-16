import { expect, it, vi } from "vitest";

import { AutomationError } from "@/backend/error/AutomationError";
import {
  AutomationOperationService,
  translateAutomationError,
} from "@/backend/service/automation/AutomationOperationService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AutomationOperationDependencies } from "@/backend/service/automation/AutomationOperationService";
import type { AgentIdentity } from "@/definition/McpAuthorization";

const options = vi.fn();
const list = vi.fn();
const read = vi.fn();
const runs = vi.fn();
const run = vi.fn();
const create = vi.fn();
const update = vi.fn();
const setActive = vi.fn();
const runNow = vi.fn();
const remove = vi.fn();
const service = new AutomationOperationService(
  partial<AutomationOperationDependencies>({
    automations: {
      options,
      list,
      read,
      runs,
      run,
      create,
      update,
      setActive,
      runNow,
      delete: remove,
    },
  }),
);
const identity = partial<AgentIdentity>({ userId: "user" });

it.each([
  ["automations.list", list],
  ["automations.read", read],
  ["automations.runs.list", runs],
  ["automations.runs.read", run],
  ["automations.create", create],
  ["automations.update", update],
  ["automations.setActive", setActive],
  ["automations.run", runNow],
  ["automations.delete", remove],
] as const)(
  "dispatches %s with the authenticated user",
  async (operation, handler) => {
    handler.mockReset().mockResolvedValue({ id: "result" });
    expect(await service.handle(identity, operation, { id: "input" })).toEqual({
      apiVersion: "1",
      result: { id: "result" },
    });
    expect(handler).toHaveBeenCalledWith("user", { id: "input" });
  },
);

it("handles options and ignores unrelated operations", async () => {
  options.mockResolvedValue({});
  expect(
    await service.handle(identity, "automations.options.read", {}),
  ).toEqual({ apiVersion: "1", result: {} });
  expect(options).toHaveBeenCalledWith("user");
  expect(await service.handle(identity, "unknown", {})).toBeNull();
});

it("translates automation errors and preserves unexpected failures", async () => {
  const error = new AutomationError("conflict", { currentRevision: 4 });
  expect(translateAutomationError(error)).toMatchObject({
    code: "CONFLICT",
    details: { currentRevision: 4 },
  });
  const unexpected = new Error("storage");
  expect(translateAutomationError(unexpected)).toBe(unexpected);
  list.mockRejectedValueOnce(new AutomationError("forbidden"));
  await expect(
    service.handle(identity, "automations.list", {}),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
