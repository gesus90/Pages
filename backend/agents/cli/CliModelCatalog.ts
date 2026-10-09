import { readAgentObject } from "@/backend/agents/AgentPayload";
import {
  isCatalogModelId,
  readReasoningEfforts,
  reasoningLevels,
  reasoningWithoutLevels,
} from "@/backend/agents/catalog/CatalogParsing";
import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";

function unexpected(): AgentError {
  return new AgentError("cli_unexpected_output");
}

// The ID rule of stored catalogs applies, so every listed ID can be saved and read back.
function readCliModelId(value: unknown): string {
  if (!isCatalogModelId(value)) throw unexpected();
  return value;
}

function readCodexModel(entry: Record<string, unknown>): AgentCatalogModel {
  const id = readCliModelId(entry.slug);
  const name = entry.display_name;
  const context = entry.context_window;
  const levels: unknown[] = Array.isArray(entry.supported_reasoning_levels)
    ? entry.supported_reasoning_levels
    : [];
  const efforts = readReasoningEfforts(
    levels.map((level) => readAgentObject(level).effort),
  );
  return {
    id,
    name:
      typeof name === "string" && /^[^\p{Cc}]{1,200}$/u.test(name) ? name : id,
    contextWindow:
      typeof context === "number" &&
      Number.isSafeInteger(context) &&
      context > 0
        ? context
        : null,
    promptPrice: null,
    completionPrice: null,
    isFree: false,
    ...(efforts
      ? reasoningLevels(efforts, entry.default_reasoning_level)
      : reasoningWithoutLevels("none")),
  };
}

// Codex orders its model picker by `priority`; entries without one go last.
function readPriority(entry: Record<string, unknown>): number {
  const priority = entry.priority;
  return typeof priority === "number" && Number.isFinite(priority)
    ? priority
    : Number.MAX_VALUE;
}

/**
 * Reads `codex debug models`, the catalog the Codex CLI itself uses.
 *
 * @param stdout - JSON printed by the CLI.
 * @returns The models Codex lists for selection in its own priority order,
 * with their reasoning levels.
 * @throws {AgentError} `cli_unexpected_output` for anything but a model list.
 *
 * @remarks
 * Hidden entries are Codex internals, so only `visibility: "list"` models appear.
 */
export function readCodexModels(stdout: string): readonly AgentCatalogModel[] {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw unexpected();
  }
  const entries = readAgentObject(payload).models;
  if (!Array.isArray(entries) || entries.length > 1000) throw unexpected();
  const models = entries
    .map((entry: unknown) => readAgentObject(entry))
    .filter((entry) => entry.visibility === "list")
    .sort((left, right) => readPriority(left) - readPriority(right))
    .map(readCodexModel);
  if (models.length === 0) throw unexpected();
  return models;
}

function readClaudeModel(model: Record<string, unknown>): AgentCatalogModel {
  const id = readCliModelId(model.resolvedModel ?? model.value);
  const name = model.displayName;
  const efforts = readReasoningEfforts(model.supportedEffortLevels);
  return {
    id,
    name:
      typeof name === "string" && /^[^\p{Cc}]{1,200}$/u.test(name) ? name : id,
    contextWindow: null,
    promptPrice: null,
    completionPrice: null,
    isFree: false,
    ...(model.supportsEffort !== false && efforts
      ? reasoningLevels(efforts, null)
      : reasoningWithoutLevels(
          model.supportsEffort === false ? "none" : "unknown",
        )),
  };
}

/**
 * Reads the Claude SDK initialize response, without a user message or model turn.
 *
 * @remarks
 * Canonical IDs and per-model efforts come from the installed CLI's own picker.
 * Help aliases and global effort flags cannot establish model capabilities.
 * Every enabled picker row becomes a model under its canonical ID, so each
 * listed version and 1M-context variant stays selectable on its own. Rows that
 * resolve to the same model, such as the default row and its family alias,
 * become one entry with the later row's name.
 */
export function readClaudeModels(stdout: string): readonly AgentCatalogModel[] {
  let messages: unknown[];
  try {
    messages = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  } catch {
    throw unexpected();
  }
  const message = messages
    .map(readAgentObject)
    .find(
      (entry) =>
        entry.type === "control_response" &&
        readAgentObject(entry.response).request_id === "pages-model-catalog",
    );
  const response = readAgentObject(message?.response);
  if (response.subtype !== "success") throw unexpected();
  const entries = readAgentObject(response.response).models;
  if (!Array.isArray(entries) || entries.length > 1000) throw unexpected();
  // The CLI marks rows it shows but does not let anyone select as disabled.
  const models = entries
    .map(readAgentObject)
    .filter((entry) => entry.disabled !== true)
    .map(readClaudeModel);
  if (models.length === 0) throw unexpected();
  return [...new Map(models.map((model) => [model.id, model])).values()];
}
