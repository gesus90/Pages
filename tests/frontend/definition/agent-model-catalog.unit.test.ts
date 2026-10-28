import { expect, it } from "vitest";

import {
  emptyModelCatalog,
  isCatalogInterval,
  isModelAliasToken,
  isReasoningEffortToken,
  supportsModelCatalog,
} from "@/definition/AgentModelCatalog";

it("supports catalogs of the fixed providers only", () => {
  expect(supportsModelCatalog("opencode")).toBe(true);
  expect(supportsModelCatalog("openrouter")).toBe(true);
});

it("accepts short picker aliases with an optional variant", () => {
  expect(isModelAliasToken("sonnet")).toBe(true);
  expect(isModelAliasToken("opus[1m]")).toBe(true);
  expect(isModelAliasToken("Opus")).toBe(false);
  expect(isModelAliasToken(3)).toBe(false);
});

it("accepts short lowercase effort tokens", () => {
  expect(isReasoningEffortToken("xhigh")).toBe(true);
  expect(isReasoningEffortToken("very high")).toBe(false);
  expect(isReasoningEffortToken(null)).toBe(false);
});

it("starts an unsaved catalog without models or refresh times", () => {
  expect(emptyModelCatalog()).toEqual({
    models: [],
    intervalHours: 0,
    nextRefreshAt: null,
    attemptedAt: null,
    refreshedAt: null,
    errorCode: null,
  });
});

it("accepts only the administrative refresh cadences", () => {
  expect(isCatalogInterval(24)).toBe(true);
  expect(isCatalogInterval(12)).toBe(false);
});
