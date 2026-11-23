import { expect, it } from "vitest";

import {
  CONNECTION_COLUMNS,
  RETIRED_PROVIDER_SQL_LIST,
  readAgentConnection,
} from "./AgentConnectionRows";

import type { DatabaseValue } from "@/backend/database/Database";

function rowOf(overrides: Record<number, DatabaseValue> = {}): DatabaseValue[] {
  const row: DatabaseValue[] = [
    "c1",
    "Main",
    "openrouter",
    1,
    "model",
    "2026-01-01",
    "label",
    "2026-01-02",
    "high",
    0,
    '{"gpt-5":"openai/gpt-5"}',
    '{"claude-x":"anthropic/claude-x"}',
    '{"a":"b","c":3}',
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

it("lists the retired providers and the selected columns", () => {
  expect(RETIRED_PROVIDER_SQL_LIST).toBe("'zai'");
  expect(CONNECTION_COLUMNS).toContain("secret_encrypted IS NOT NULL");
});

it("maps every column of a connection", () => {
  expect(readAgentConnection(rowOf())).toEqual({
    isActive: false,
    codexPriceMappings: { "gpt-5": "openai/gpt-5" },
    claudePriceModels: { "claude-x": "anthropic/claude-x" },
    id: "c1",
    name: "Main",
    provider: "openrouter",
    hasApiKey: true,
    testModel: "model",
    cliLoggedInAt: "2026-01-01",
    cliAccountLabel: "label",
    updatedAt: "2026-01-02",
    reasoningEffort: "high",
    openRouterModelIds: { a: "b" },
  });
});

it("falls back to empty price tables when none are stored", () => {
  const record = readAgentConnection(rowOf({ 10: null, 11: null }));
  expect(record.codexPriceMappings).toEqual({});
  expect(record.claudePriceModels).toEqual({});
});

it("rejects an unsupported stored provider", () => {
  expect(() => readAgentConnection(rowOf({ 2: "zai" }))).toThrow(
    expect.objectContaining({ code: "provider_invalid" }),
  );
});

it("rejects model ids that are not an object", () => {
  for (const text of ["[]", "null", "5"])
    expect(() => readAgentConnection(rowOf({ 12: text }))).toThrow(
      expect.objectContaining({ code: "profile_invalid" }),
    );
});
