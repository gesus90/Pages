import {
  OPENCODE_FREE_PROVIDER,
  openCodeModelProvider,
} from "@/definition/AgentConnection";

import type { AgentProviderId } from "@/definition/AgentConnection";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { TFunction } from "i18next";

const NAME_ORDER = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/** OpenCode's own models first, then those it reaches through OpenRouter. */
const OPENCODE_SOURCE_ORDER = [OPENCODE_FREE_PROVIDER, "openrouter"];

/** The brand mark that names each tool or API in the model choice. */
const TOOL_MARKS: Readonly<Record<AgentProviderId, string>> = {
  antigravity: "antigravity",
  claude_code: "claude",
  codex_cli: "openai",
  opencode: "opencode",
  openrouter: "openrouter",
  openai: "openai",
  anthropic: "anthropic",
  google_ai_studio: "gemini",
  zai: "zai",
};

/** One model a node can run with, named for the choice. */
export interface PlanModelChoice {
  readonly model: PageAgentModel;
  /** The model's short catalog name, without host or connection. */
  readonly label: string;
  /** The technical model ID, only where another model of the same source has the same name. */
  readonly detail: string | null;
  /** The source badge, only in a tool with several sources. */
  readonly source: string | null;
  /** Whether the catalog states a price of zero for exactly this access. */
  readonly isFree: boolean;
  /** Lower-case words the search matches: name, ID, tool, access and source. */
  readonly searchText: string;
}

/** The models of one source of a tool: an OpenCode provider or one connection. */
export interface PlanModelSource {
  readonly key: string;
  /** The heading above the source's models; `null` in a tool with one source. */
  readonly label: string | null;
  readonly choices: readonly PlanModelChoice[];
}

/** One tool, such as Claude Code or OpenCode, with its sources and models. */
export interface PlanModelGroup {
  readonly key: string;
  readonly label: string;
  /** The short access context of the header, such as "Claude-Abo" or "OpenCode + OpenRouter". */
  readonly context: string;
  readonly mark: string;
  readonly sources: readonly PlanModelSource[];
  readonly count: number;
}

interface SourceDraft {
  readonly key: string;
  readonly name: string;
  readonly models: PageAgentModel[];
}

function shortName(model: PageAgentModel): string {
  return model.modelName ?? model.name;
}

// An OpenCode model belongs to the provider OpenCode runs it with; any other
// model to its connection, so two accounts of one tool stay apart.
function sourceOf(
  model: PageAgentModel,
  translate: TFunction,
): Omit<SourceDraft, "models"> {
  if (model.provider === "opencode") {
    const provider = openCodeModelProvider(model.model);
    return {
      key: provider,
      name: translate(`plans.modelPicker.sources.${provider}`, {
        defaultValue: provider,
      }),
    };
  }
  const key = model.connectionId ?? model.connectionName ?? "";
  return { key, name: model.connectionName ?? key };
}

function compareSources(
  provider: AgentProviderId,
): (first: SourceDraft, second: SourceDraft) => number {
  if (provider !== "opencode")
    return (first, second) => NAME_ORDER.compare(first.name, second.name);
  const rank = (source: SourceDraft): number => {
    const index = OPENCODE_SOURCE_ORDER.indexOf(source.key);
    return index === -1 ? OPENCODE_SOURCE_ORDER.length : index;
  };
  return (first, second) =>
    rank(first) - rank(second) || NAME_ORDER.compare(first.name, second.name);
}

function compareModels(first: PageAgentModel, second: PageAgentModel): number {
  return (
    NAME_ORDER.compare(shortName(first), shortName(second)) ||
    NAME_ORDER.compare(first.model, second.model)
  );
}

function groupContext(
  provider: AgentProviderId,
  sources: readonly SourceDraft[],
  translate: TFunction,
): string {
  if (provider === "opencode")
    return sources.map((source) => source.name).join(" + ");
  return sources.length === 1
    ? translate(`plans.modelPicker.access.${provider}`)
    : translate("plans.modelPicker.accessCount", { count: sources.length });
}

function choicesOf(
  source: SourceDraft,
  input: {
    readonly group: string;
    readonly context: string;
    readonly badge: string | null;
    readonly translate: TFunction;
  },
): PlanModelChoice[] {
  const names = new Map<string, number>();
  for (const model of source.models)
    names.set(shortName(model), (names.get(shortName(model)) ?? 0) + 1);
  return source.models.toSorted(compareModels).map((model) => ({
    model,
    label: shortName(model),
    detail: (names.get(shortName(model)) ?? 0) > 1 ? model.model : null,
    source: input.badge,
    isFree: model.isFree === true,
    searchText: [
      shortName(model),
      model.model,
      input.group,
      input.context,
      source.name,
      model.connectionName ?? "",
      input.translate(`settings.agents.provider.${model.provider}`),
    ]
      .join(" ")
      .toLowerCase(),
  }));
}

function buildGroup(
  provider: AgentProviderId,
  models: readonly PageAgentModel[],
  translate: TFunction,
): PlanModelGroup {
  const drafts = new Map<string, SourceDraft>();
  for (const model of models) {
    const source = sourceOf(model, translate);
    const draft = drafts.get(source.key) ?? { ...source, models: [] };
    draft.models.push(model);
    drafts.set(source.key, draft);
  }
  const ordered = [...drafts.values()].toSorted(compareSources(provider));
  const label = translate(`plans.modelPicker.tools.${provider}`);
  const context = groupContext(provider, ordered, translate);
  const hasSeveral = ordered.length > 1;
  return {
    key: provider,
    label,
    context,
    mark: TOOL_MARKS[provider],
    count: models.length,
    sources: ordered.map((source) => ({
      key: source.key,
      label: hasSeveral ? source.name : null,
      choices: choicesOf(source, {
        group: label,
        // OpenCode's context names all its sources; each model matches only its own.
        context: provider === "opencode" ? "" : context,
        badge: hasSeveral ? source.name : null,
        translate,
      }),
    })),
  };
}

/**
 * Orders the models a node may use under their tool and source.
 *
 * @remarks
 * Models keep their technical identity: a model reached through two sources
 * or connections is offered once per source, and only an entry with the
 * very same selection key is offered once. Tools follow their names.
 *
 * @param models - The models of the node's execution target.
 * @param translate - Translates tool, access and source names.
 * @returns One group per tool that offers at least one model.
 */
export function planModelGroups(
  models: readonly PageAgentModel[],
  translate: TFunction,
): readonly PlanModelGroup[] {
  const unique = new Map(models.map((model) => [model.id, model]));
  const byTool = new Map<AgentProviderId, PageAgentModel[]>();
  for (const model of unique.values()) {
    const members = byTool.get(model.provider) ?? [];
    members.push(model);
    byTool.set(model.provider, members);
  }
  return [...byTool]
    .map(([provider, members]) => buildGroup(provider, members, translate))
    .toSorted((first, second) => NAME_ORDER.compare(first.label, second.label));
}

/**
 * Keeps the models whose name, ID, tool, access or source contain every word of the query.
 *
 * @param groups - All groups of the choice, collapsed ones included.
 * @param query - The typed search, matched without regard to case.
 * @returns The groups and sources with at least one match, counting only the matches.
 */
export function filterPlanModelGroups(
  groups: readonly PlanModelGroup[],
  query: string,
): readonly PlanModelGroup[] {
  const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return groups;
  return groups.flatMap((group) => {
    const sources = group.sources.flatMap((source) => {
      const choices = source.choices.filter((choice) =>
        terms.every((term) => choice.searchText.includes(term)),
      );
      return choices.length === 0 ? [] : [{ ...source, choices }];
    });
    const count = sources.reduce(
      (sum, source) => sum + source.choices.length,
      0,
    );
    return count === 0 ? [] : [{ ...group, sources, count }];
  });
}

/**
 * Finds the listed choice of a model.
 *
 * @param groups - The groups of the choice.
 * @param id - The model's selection key.
 * @returns The group and choice, or `null` when no group lists the model.
 */
export function findPlanModelChoice(
  groups: readonly PlanModelGroup[],
  id: string,
): { readonly group: PlanModelGroup; readonly choice: PlanModelChoice } | null {
  for (const group of groups)
    for (const source of group.sources) {
      const choice = source.choices.find((entry) => entry.model.id === id);
      if (choice) return { group, choice };
    }
  return null;
}
