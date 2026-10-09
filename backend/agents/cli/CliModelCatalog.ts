import { readAgentObject } from "@/backend/agents/AgentPayload";
import {
  readReasoningEfforts,
  reasoningLevels,
  reasoningWithoutLevels,
} from "@/backend/agents/catalog/CatalogParsing";
import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";

// Same rule as stored catalogs, so every listed ID can be saved and read back.
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

function unexpected(): AgentError {
  return new AgentError("cli_unexpected_output");
}

function readCodexModel(entry: Record<string, unknown>): AgentCatalogModel {
  const id = entry.slug;
  if (typeof id !== "string" || !MODEL_ID.test(id)) throw unexpected();
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

// An option's description continues on deeper-indented lines until the next option or section.
function optionText(help: string, option: string): string {
  const lines = help.split("\n");
  const start = lines.findIndex((line) =>
    line.trimStart().startsWith(`${option} `),
  );
  if (start === -1) return "";
  const block = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s{6,}\S/.test(line)) break;
    block.push(line);
  }
  return block.join(" ").replace(/\s+/g, " ");
}

/**
 * Reads model aliases and effort levels from `claude --help`.
 *
 * @param help - Help text printed by the installed Claude Code.
 * @returns One entry per alias the CLI names, each with the CLI's effort levels.
 * @throws {AgentError} `cli_unexpected_output` when either list is missing.
 *
 * @remarks
 * Claude Code has no model listing command. Its help names the aliases and the
 * accepted `--effort` levels; per its documentation, a level a model lacks
 * falls back to the highest supported one below it.
 */
export function readClaudeModels(help: string): readonly AgentCatalogModel[] {
  const effortList = /\(([a-z0-9_, -]+)\)/.exec(optionText(help, "--effort"));
  const efforts = readReasoningEfforts(
    effortList ? effortList[1].split(",").map((level) => level.trim()) : [],
  );
  const aliases = [
    ...new Set(
      [
        ...optionText(help, "--model").matchAll(/'([a-z][a-z0-9-]{0,63})'/g),
      ].map((match) => match[1]),
    ),
  ];
  if (!efforts || aliases.length === 0) throw unexpected();
  return aliases.map((alias) => ({
    id: alias,
    name: alias,
    contextWindow: null,
    promptPrice: null,
    completionPrice: null,
    isFree: false,
    ...reasoningLevels(efforts, null),
  }));
}
