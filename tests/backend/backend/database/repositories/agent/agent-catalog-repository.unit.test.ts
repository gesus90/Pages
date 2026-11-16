import { beforeEach, expect, it, vi } from "vitest";

import { AgentCatalogRepository } from "@/backend/database/repositories/agent/AgentCatalogRepository";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";

const query = vi.fn();
const execute = vi.fn();
const repository = new AgentCatalogRepository(
  partial<DatabaseTransaction>({ query, execute }),
);

beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue([]);
});

it("returns an empty catalog for a missing connection and validates stored cadence", async () => {
  expect((await repository.find("connection")).models).toEqual([]);
  query.mockResolvedValueOnce([[999, null, null, null, null, "[]"]]);
  await expect(repository.find("connection")).rejects.toThrow();
  query.mockResolvedValueOnce([[0, null, null, null, "unknown_error", "[]"]]);
  expect(await repository.find("connection")).toMatchObject({
    intervalHours: 0,
    errorCode: null,
    models: [],
  });
});

it("preserves the last good snapshot on failure and serializes successful models", async () => {
  await repository.save(
    "connection",
    { attemptedAt: "now", errorCode: "catalog_unsupported", models: null },
    "later",
  );
  expect(execute).toHaveBeenLastCalledWith(
    expect.stringContaining("COALESCE($models_json, models_json)"),
    expect.objectContaining({ refreshed_at: null, models_json: null }),
  );
  const model = partial<AgentCatalogModel>({
    id: "model",
    name: "Model",
    contextWindow: null,
    promptPrice: null,
    completionPrice: null,
    reasoning: "none",
    reasoningEfforts: [],
    defaultReasoningEffort: null,
    inputModalities: ["audio"],
  });
  await repository.save(
    "connection",
    { attemptedAt: "now", errorCode: null, models: [model] },
    null,
  );
  const parameters: unknown = execute.mock.calls.at(-1)?.[1];
  if (
    typeof parameters !== "object" ||
    parameters === null ||
    !("models_json" in parameters) ||
    typeof parameters.models_json !== "string"
  )
    throw new Error("Expected models JSON");
  expect(JSON.parse(parameters.models_json)).toMatchObject([
    { id: "model", input_modalities: ["audio"] },
  ]);
});

it("configures refresh timing and returns the next due connection", async () => {
  await repository.configure("connection", 24, "later");
  expect(execute).toHaveBeenLastCalledWith(
    expect.stringContaining("next_refresh_at = $next_refresh_at"),
    { id: "connection", interval: 24, next_refresh_at: "later" },
  );
  query.mockResolvedValueOnce([["connection"]]).mockResolvedValueOnce([]);
  expect(await repository.nextDue("now")).toBe("connection");
  expect(await repository.nextDue("now")).toBeNull();
});
