import { beforeEach, expect, it, vi } from "vitest";

import { handleRunnerProviderRequest } from "@/app/lib/settings-actions/settings-runner-provider.server";

import { ACTOR, formOf, servicesOf } from "./action-fixtures";

import type { SettingsActionContext } from "@/app/lib/settings-actions/settings-action-support.server";
import type { FormFields } from "./action-fixtures";

const execute = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
});

function context(
  fields: FormFields,
  origin: string | null = "http://pages.invalid",
): SettingsActionContext {
  return {
    formData: formOf(fields),
    request: new Request("http://pages.invalid/settings/agents", {
      headers: origin === null ? {} : { Origin: origin },
      method: "POST",
    }),
    services: servicesOf({ runnerOpenRouterService: { execute } }),
    user: ACTOR,
  };
}

async function submit(
  fields: FormFields,
  origin?: string | null,
): Promise<Response> {
  return handleRunnerProviderRequest(context(fields, origin), "connection-1");
}

it.each([
  ["another origin", "http://evil.invalid"],
  ["no origin", null],
])("refuses a request from %s", async (caseName, origin) => {
  const response = await submit({ provider: "openrouter" }, origin);

  expect(response.status).toBe(403);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ ok: false });
  expect(execute).not.toHaveBeenCalled();
});

it("refuses every provider but OpenRouter", async () => {
  const response = await submit({ provider: "anthropic" });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ ok: false });
  expect(execute).not.toHaveBeenCalled();
});

it("stores a provider key through the runner of the connection", async () => {
  execute.mockResolvedValue({ ok: true, synced: true });

  const response = await submit({
    provider: "openrouter",
    intent: "store-provider-key",
    apiKey: "sk-synthetic",
  });

  expect(execute).toHaveBeenCalledExactlyOnceWith(ACTOR.id, "connection-1", {
    operation: "sync",
    apiKey: "sk-synthetic",
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    ok: true,
    intent: "store-provider-key",
    result: { ok: true, synced: true },
  });
});

it("synchronizes without sending a key", async () => {
  execute.mockResolvedValue({ ok: false, reason: "offline" });

  const response = await submit({
    provider: "openrouter",
    intent: "sync-provider",
    apiKey: "ignored",
  });

  expect(execute).toHaveBeenCalledWith(ACTOR.id, "connection-1", {
    operation: "sync",
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    ok: false,
    intent: "sync-provider",
    result: { ok: false, reason: "offline" },
  });
});

it("checks the named model", async () => {
  execute.mockResolvedValue({ ok: true });

  await submit({
    provider: "openrouter",
    intent: "check-provider",
    model: "openrouter/synthetic",
  });

  expect(execute).toHaveBeenCalledWith(ACTOR.id, "connection-1", {
    operation: "check",
    model: "openrouter/synthetic",
  });
});

it("checks the free model when the form names none", async () => {
  execute.mockResolvedValue({ ok: true });

  await submit({ provider: "openrouter" });

  expect(execute).toHaveBeenCalledWith(ACTOR.id, "connection-1", {
    operation: "check",
    model: "openrouter/free",
  });
});
