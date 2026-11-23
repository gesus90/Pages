import { expect, it, vi, type Mock } from "vitest";

import { AgentCatalogRepository } from "./AgentCatalogRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: DatabaseTransaction;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () => rows);
  return { database: { execute, query }, execute, query };
}

const PLAIN_MODEL: AgentCatalogModel = {
  id: "m1",
  name: "Model 1",
  contextWindow: 1000,
  promptPrice: "1",
  completionPrice: "2",
  isFree: false,
  reasoning: "none",
  reasoningEfforts: [],
  defaultReasoningEffort: null,
};

const RICH_MODEL: AgentCatalogModel = {
  ...PLAIN_MODEL,
  id: "m2",
  supportsImages: true,
  aliases: ["short"],
  isToolCapable: true,
  inputModalities: ["text"],
  outputModalities: ["audio"],
  supportedVoices: ["alloy"],
};

function savedModels(execute: Mock<DatabaseTransaction["execute"]>): unknown {
  const json = execute.mock.calls[1]?.[1]?.models_json;
  return typeof json === "string" ? JSON.parse(json) : json;
}

it("returns the empty catalog without a stored row", async () => {
  const { database } = databaseOf();
  const catalog = await new AgentCatalogRepository(database).find("c1");
  expect(catalog.models).toEqual([]);
  expect(catalog.refreshedAt).toBeNull();
});

it("reads the stored catalog projection", async () => {
  const { database, query } = databaseOf([
    [24, "next", "attempt", "refresh", "provider_bad_response", "[]"],
  ]);
  await expect(
    new AgentCatalogRepository(database).find("c1"),
  ).resolves.toEqual({
    intervalHours: 24,
    nextRefreshAt: "next",
    attemptedAt: "attempt",
    refreshedAt: "refresh",
    errorCode: "provider_bad_response",
    models: [],
  });
  expect(query.mock.calls[0]?.[1]).toEqual({ id: "c1" });
});

it("drops an unknown stored error code", async () => {
  const { database } = databaseOf([[0, null, null, null, "nope", "[]"]]);
  const catalog = await new AgentCatalogRepository(database).find("c1");
  expect(catalog.errorCode).toBeNull();
});

it("rejects a stored interval outside the supported cadences", async () => {
  const { database } = databaseOf([[5, null, null, null, null, "[]"]]);
  await expect(
    new AgentCatalogRepository(database).find("c1"),
  ).rejects.toMatchObject({ code: "catalog_interval_invalid" });
});

it("configures the cadence after ensuring the row", async () => {
  const { database, execute } = databaseOf();
  await new AgentCatalogRepository(database).configure("c1", 6, "next");
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[1]?.[1]).toEqual({
    id: "c1",
    interval: 6,
    next_refresh_at: "next",
  });
});

it("publishes a snapshot with every optional model field", async () => {
  const { database, execute } = databaseOf();
  await new AgentCatalogRepository(database).save(
    "c1",
    {
      attemptedAt: "t",
      errorCode: null,
      models: [PLAIN_MODEL, RICH_MODEL],
    },
    "next",
  );
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    attempted_at: "t",
    refreshed_at: "t",
    error_code: null,
    next_refresh_at: "next",
  });
  expect(savedModels(execute)).toEqual([
    {
      id: "m1",
      name: "Model 1",
      context_length: 1000,
      pricing: { prompt: "1", completion: "2" },
      reasoning_support: "none",
      reasoning: { supported_efforts: [], default_effort: null },
    },
    {
      image_input: true,
      id: "m2",
      name: "Model 1",
      context_length: 1000,
      pricing: { prompt: "1", completion: "2" },
      reasoning_support: "none",
      reasoning: { supported_efforts: [], default_effort: null },
      aliases: ["short"],
      tool_call: true,
      input_modalities: ["text"],
      output_modalities: ["audio"],
      supported_voices: ["alloy"],
    },
  ]);
});

it("omits empty aliases from the stored snapshot", async () => {
  const { database, execute } = databaseOf();
  await new AgentCatalogRepository(database).save(
    "c1",
    {
      attemptedAt: "t",
      errorCode: null,
      models: [{ ...PLAIN_MODEL, aliases: [] }],
    },
    null,
  );
  expect(JSON.stringify(savedModels(execute))).not.toContain("aliases");
});

it("records a failure and keeps the last good snapshot", async () => {
  const { database, execute } = databaseOf();
  await new AgentCatalogRepository(database).save(
    "c1",
    { attemptedAt: "t", errorCode: "provider_bad_response", models: null },
    null,
  );
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    refreshed_at: null,
    models_json: null,
    error_code: "provider_bad_response",
  });
});

it("chooses the next due connection", async () => {
  const { database, query } = databaseOf([["c7"]]);
  await expect(
    new AgentCatalogRepository(database).nextDue("now"),
  ).resolves.toBe("c7");
  expect(query.mock.calls[0]?.[1]).toEqual({ now: "now" });
});

it("returns null when no connection is due", async () => {
  const { database } = databaseOf();
  await expect(
    new AgentCatalogRepository(database).nextDue("now"),
  ).resolves.toBeNull();
});

it("invalidates the catalog of a connection", async () => {
  const { database, execute } = databaseOf();
  await new AgentCatalogRepository(database).invalidate("c1");
  expect(execute.mock.calls[0]?.[1]).toEqual({ id: "c1" });
});

it("removes the catalog of a connection", async () => {
  const { database, execute } = databaseOf();
  await new AgentCatalogRepository(database).remove("c1");
  expect(execute.mock.calls[0]?.[1]).toEqual({ id: "c1" });
});
