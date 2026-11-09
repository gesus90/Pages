import {
  AGENT_PROVIDERS,
  OPENCODE_FREE_PROVIDER,
  linkedApiProviderOf,
  openCodeModelProvider,
} from "@/definition/AgentConnection";

import type { AgentProviderId } from "@/definition/AgentConnection";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { TFunction } from "i18next";

const NAME_ORDER = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/** The tools every model choice lists first, in this order; others follow by name. */
const TOOL_ORDER: readonly AgentProviderId[] = [
  "claude_code",
  "codex_cli",
  "antigravity",
  "opencode",
  "openrouter",
  "zai",
];

/**
 * Tools whose models form one list, whichever access reaches them: OpenCode
 * with a linked key or the direct API connection. Each model appears once.
 */
const MERGED_TOOLS: ReadonlySet<AgentProviderId> = new Set([
  "openrouter",
  "zai",
]);

/** OpenCode's own models first, then those of other linked providers. */
const OPENCODE_SOURCE_ORDER = [OPENCODE_FREE_PROVIDER];

/** The execution target of models on this host. */
const LOCAL_TARGET = "local";

/** The one source of a merged tool. */
const MERGED_SOURCE = "models";

// A trailing "Free", such as in "GLM-5.3-Flash Free" or "Model (free)"; the
// badge says it instead.
const TRAILING_FREE = /(?:[\s:_-]+\(?|\()free\)?$/iu;

/** One model a consumer can choose, named for the choice. */
export interface ModelChoice {
  readonly model: PageAgentModel;
  /** The model's short catalog name, without host, connection or a trailing "Free". */
  readonly label: string;
  /** The technical model ID, only where another model of the same source has the same name. */
  readonly detail: string | null;
  /** The source badge, only in a tool with several sources. */
  readonly source: string | null;
  /** Whether the catalog states a price of zero for exactly this access. */
  readonly isFree: boolean;
  /** Why this place cannot use the model; the row stays listed but cannot be chosen. */
  readonly refusal: string | null;
  /** Lower-case words the search matches: name, ID, tool, access, source, target and "free". */
  readonly searchText: string;
}

/** The models of one source of a tool: an OpenCode provider or one connection. */
export interface ModelSource {
  readonly key: string;
  /** The heading above the source's models; `null` in a tool with one source. */
  readonly label: string | null;
  readonly choices: readonly ModelChoice[];
}

/** One tool, such as Claude Code or OpenRouter, on one execution target, with its sources and models. */
export interface ModelGroup {
  readonly key: string;
  readonly label: string;
  /** The short access context of the header, such as "Claude-Abo" or "API-Key". */
  readonly context: string;
  /** The mark key registered for the tool. */
  readonly mark: string;
  readonly sources: readonly ModelSource[];
  readonly count: number;
}

/** How a place names and limits the shared catalog. */
export interface ModelGroupOptions {
  readonly translate: TFunction;
  /** The reason a listed model cannot be chosen here, such as a group of another runner. */
  readonly refusalOf?: (model: PageAgentModel) => string | null;
  /** The chosen model, which stays the listed entry where one model has several accesses. */
  readonly selectedId?: string;
}

interface SourceDraft {
  readonly key: string;
  readonly name: string;
  readonly models: PageAgentModel[];
}

interface GroupDraft {
  readonly key: string;
  readonly tool: AgentProviderId;
  /** The remote target's name; `null` on this host. */
  readonly targetName: string | null;
  readonly models: PageAgentModel[];
}

function catalogName(model: PageAgentModel): string {
  return model.modelName ?? model.name;
}

function shortName(model: PageAgentModel): string {
  const name = catalogName(model);
  const shortened = name.replace(TRAILING_FREE, "").trim();
  return shortened === "" ? name : shortened;
}

function targetKey(model: PageAgentModel): string {
  return model.runnerRoute?.workspaceId ?? LOCAL_TARGET;
}

/**
 * The tool a model is listed under.
 *
 * @remarks
 * OpenCode runs the models of OpenRouter and Z.AI with their linked keys;
 * the choice lists them under OpenRouter and Z.AI, beside the models of the
 * direct API connections. Execution stays as the model's entry says.
 */
function toolOf(model: PageAgentModel): AgentProviderId {
  if (model.provider !== "opencode") return model.provider;
  const linked = linkedApiProviderOf(openCodeModelProvider(model.model));
  return linked !== null && MERGED_TOOLS.has(linked) ? linked : "opencode";
}

// The model behind an entry, without the OpenCode provider in front, so the
// same model of OpenCode and of the direct API connection is recognised.
function sameModelKey(model: PageAgentModel): string {
  if (model.provider !== "opencode") return model.model;
  return model.model.slice(model.model.indexOf("/") + 1);
}

// The chosen entry stays; otherwise one the place can use, preferably run by
// OpenCode, which executes these tools' models.
function entryRank(model: PageAgentModel, options: ModelGroupOptions): number {
  if (model.id === options.selectedId) return 0;
  if ((options.refusalOf?.(model) ?? null) !== null) return 3;
  return model.provider === "opencode" ? 1 : 2;
}

function withoutDuplicates(
  models: readonly PageAgentModel[],
  options: ModelGroupOptions,
): PageAgentModel[] {
  const kept = new Map<string, PageAgentModel>();
  for (const model of models) {
    const key = sameModelKey(model);
    const current = kept.get(key);
    if (!current || entryRank(model, options) < entryRank(current, options))
      kept.set(key, model);
  }
  return [...kept.values()];
}

/**
 * The name of a tool, from the provider registry, for its group header.
 *
 * @param provider - The provider of the tool's connections.
 * @param translate - Translates the registered names.
 * @returns The short tool name, such as "Codex"; a provider without one keeps
 * its registered connection name.
 */
export function modelToolLabel(
  provider: AgentProviderId,
  translate: TFunction,
): string {
  return translate(`plans.modelPicker.tools.${provider}`, {
    defaultValue: translate(AGENT_PROVIDERS[provider].labelKey, {
      defaultValue: provider,
    }),
  });
}

// An OpenCode model belongs to the provider OpenCode runs it with; a merged
// tool holds one list; any other model belongs to its connection, so two
// accounts of one tool stay apart.
function sourceOf(
  model: PageAgentModel,
  tool: AgentProviderId,
  translate: TFunction,
): Omit<SourceDraft, "models"> {
  if (MERGED_TOOLS.has(tool))
    return { key: MERGED_SOURCE, name: modelToolLabel(tool, translate) };
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
  tool: AgentProviderId,
): (first: SourceDraft, second: SourceDraft) => number {
  if (tool !== "opencode")
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

function groupAccess(
  draft: GroupDraft,
  sources: readonly SourceDraft[],
  translate: TFunction,
): string {
  if (MERGED_TOOLS.has(draft.tool))
    return translate(`plans.modelPicker.access.${draft.tool}`);
  if (draft.tool === "opencode") {
    // Without an OpenCode key the catalog holds only OpenCode's free models.
    if (draft.models.every((model) => model.isFree === true))
      return translate("plans.modelPicker.access.opencodeFree");
    return sources.length > 1
      ? sources.map((source) => source.name).join(" + ")
      : translate("plans.modelPicker.access.opencode");
  }
  if (sources.length === 1)
    return translate(`plans.modelPicker.access.${draft.tool}`, {
      defaultValue: sources[0].name,
    });
  return translate("plans.modelPicker.accessCount", { count: sources.length });
}

function groupContext(
  draft: GroupDraft,
  sources: readonly SourceDraft[],
  translate: TFunction,
): string {
  const access = groupAccess(draft, sources, translate);
  // A remote target names its host once in the header, never in each row.
  return draft.targetName === null ? access : `${draft.targetName} · ${access}`;
}

function choicesOf(
  source: SourceDraft,
  input: {
    readonly group: string;
    readonly context: string;
    readonly badge: string | null;
    readonly options: ModelGroupOptions;
  },
): ModelChoice[] {
  const { translate, refusalOf } = input.options;
  const names = new Map<string, number>();
  for (const model of source.models)
    names.set(shortName(model), (names.get(shortName(model)) ?? 0) + 1);
  return source.models.toSorted(compareModels).map((model) => ({
    model,
    label: shortName(model),
    detail: (names.get(shortName(model)) ?? 0) > 1 ? model.model : null,
    source: input.badge,
    isFree: model.isFree === true,
    refusal: refusalOf?.(model) ?? null,
    searchText: [
      catalogName(model),
      model.model,
      input.group,
      input.context,
      source.name,
      model.connectionName ?? "",
      model.targetName ?? "",
      translate(AGENT_PROVIDERS[model.provider].labelKey),
      model.isFree === true
        ? `free ${translate("plans.modelPicker.free")}`
        : "",
    ]
      .join(" ")
      .toLowerCase(),
  }));
}

function buildGroup(draft: GroupDraft, options: ModelGroupOptions): ModelGroup {
  const { translate } = options;
  const models = MERGED_TOOLS.has(draft.tool)
    ? withoutDuplicates(draft.models, options)
    : draft.models;
  const drafts = new Map<string, SourceDraft>();
  for (const model of models) {
    const source = sourceOf(model, draft.tool, translate);
    const sourceDraft = drafts.get(source.key) ?? { ...source, models: [] };
    sourceDraft.models.push(model);
    drafts.set(source.key, sourceDraft);
  }
  const ordered = [...drafts.values()].toSorted(compareSources(draft.tool));
  const label = modelToolLabel(draft.tool, translate);
  const context = groupContext(draft, ordered, translate);
  const hasSeveral = ordered.length > 1;
  return {
    key: draft.key,
    label,
    context,
    mark: AGENT_PROVIDERS[draft.tool].mark,
    count: models.length,
    sources: ordered.map((source) => ({
      key: source.key,
      label: hasSeveral ? source.name : null,
      choices: choicesOf(source, {
        group: label,
        // OpenCode's context names all its sources; each model matches only its own.
        context: draft.tool === "opencode" ? (draft.targetName ?? "") : context,
        badge: hasSeveral ? source.name : null,
        options,
      }),
    })),
  };
}

function toolRank(tool: AgentProviderId): number {
  const index = TOOL_ORDER.indexOf(tool);
  return index === -1 ? TOOL_ORDER.length : index;
}

// This host's tools come first, then each remote target's, each in the fixed
// tool order and then by tool name.
function compareGroups(
  first: GroupDraft & { readonly label: string },
  second: GroupDraft & { readonly label: string },
): number {
  const isFirstRemote = first.targetName !== null;
  const isSecondRemote = second.targetName !== null;
  if (isFirstRemote !== isSecondRemote) return isFirstRemote ? 1 : -1;
  return (
    NAME_ORDER.compare(first.targetName ?? "", second.targetName ?? "") ||
    toolRank(first.tool) - toolRank(second.tool) ||
    NAME_ORDER.compare(first.label, second.label)
  );
}

/**
 * Orders the models of the shared catalog under their execution target, tool and source.
 *
 * @remarks
 * This is the one projection every model choice of Pages uses, so the same
 * models look, group and search the same everywhere. Groups come from the
 * tools the catalog lists, never from a fixed list, and take their names and
 * marks from the provider registry: Claude Code, Codex, Antigravity,
 * OpenCode, OpenRouter and Z.AI first, in this order. OpenRouter and Z.AI
 * are tools of their own; their models appear there once, also where both
 * OpenCode and the direct API connection reach them. Models whose catalog
 * rules out chatting are left out; a saved assignment to one is then shown
 * as unavailable. Models of a remote target never share a group with this
 * host's.
 *
 * @param models - The models the place may offer.
 * @param options - Translation, the place's reason a model cannot be chosen and the chosen model.
 * @returns One group per target and tool that offers at least one model.
 */
export function modelGroups(
  models: readonly PageAgentModel[],
  options: ModelGroupOptions,
): readonly ModelGroup[] {
  const unique = new Map(
    models
      .filter((model) => model.isChatCapable !== false)
      .map((model) => [model.id, model]),
  );
  const drafts = new Map<string, GroupDraft>();
  const simulated = [...unique.values()].filter((model) => model.isSimulation);
  for (const model of unique.values()) {
    if (model.isSimulation) continue;
    const target = targetKey(model);
    const tool = toolOf(model);
    const key = target === LOCAL_TARGET ? tool : `${target}:${tool}`;
    const draft = drafts.get(key) ?? {
      key,
      tool,
      targetName: target === LOCAL_TARGET ? null : (model.targetName ?? target),
      models: [],
    };
    draft.models.push(model);
    drafts.set(key, draft);
  }
  return [...drafts.values()]
    .map((draft) => ({
      ...draft,
      label: modelToolLabel(draft.tool, options.translate),
    }))
    .toSorted(compareGroups)
    .map((draft) => buildGroup(draft, options))
    .concat(simulated.length > 0 ? [simulationGroup(simulated, options)] : []);
}

/**
 * The models of the agent simulation (PAGE-268) as a group of their own,
 * named Simulation, never as models of the provider whose path they use.
 */
function simulationGroup(
  models: readonly PageAgentModel[],
  options: ModelGroupOptions,
): ModelGroup {
  const label = options.translate("plans.modelPicker.simulation");
  const context = options.translate("plans.modelPicker.simulationContext");
  return {
    key: "simulation",
    label,
    context,
    mark: "simulation",
    count: models.length,
    sources: [
      {
        key: "simulation",
        label: null,
        choices: choicesOf(
          { key: "simulation", name: label, models: [...models] },
          { group: label, context, badge: null, options },
        ),
      },
    ],
  };
}

/**
 * Keeps the models whose name, ID, tool, access, source or target contain every word of the query.
 *
 * @param groups - All groups of the choice, collapsed ones included.
 * @param query - The typed search, matched without regard to case.
 * @returns The groups and sources with at least one match, counting only the matches.
 */
export function filterModelGroups(
  groups: readonly ModelGroup[],
  query: string,
): readonly ModelGroup[] {
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
export function findModelChoice(
  groups: readonly ModelGroup[],
  id: string,
): { readonly group: ModelGroup; readonly choice: ModelChoice } | null {
  for (const group of groups)
    for (const source of group.sources) {
      const choice = source.choices.find((entry) => entry.model.id === id);
      if (choice) return { group, choice };
    }
  return null;
}
