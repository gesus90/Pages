import {
  AGENT_PROVIDERS,
  isZaiCodingPlanModel,
  OPENCODE_FREE_PROVIDER,
  openCodeModelProvider,
} from "@/definition/AgentConnection";

import type { AgentProviderId } from "@/definition/AgentConnection";
import type { ConnectionCatalogStatus } from "@/definition/AgentModelCatalogStatus";
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
];

/** OpenCode's own models first, then those of other linked providers. */
const OPENCODE_SOURCE_ORDER = [OPENCODE_FREE_PROVIDER];

/** The execution target of models on this host. */
const LOCAL_TARGET = "local";

// A trailing "Free", such as in "Gemini 4 Flash Free" or "Model (free)"; the
// badge says it instead.
const TRAILING_FREE = /(?:[\s:_-]+\(?|\()free\)?$/iu;

// OpenRouter's catalog names explicitly separate the manufacturer and model.
const OPENROUTER_CATALOG_NAME = /^([^:/]+):\s+(.+)$/u;

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
  /** The administrators' name of the connection the model is chosen through. */
  readonly connectionName: string;
  /** The kind of access, such as "API-Key"; empty where the tool names none. */
  readonly access: string;
  /** Folded words the search matches: name, ID, tool, connection, access, source, target and "free". */
  readonly searchText: string;
}

/** The models of one source of a tool: an OpenCode provider or one connection. */
export interface ModelSource {
  readonly key: string;
  /** The heading above the source's models; `null` in a tool with one source. */
  readonly label: string | null;
  readonly choices: readonly ModelChoice[];
  /**
   * The catalog state of the source's connection; `null` where the place
   * received none. A source without a listed model still stands in its tool.
   */
  readonly status: ConnectionCatalogStatus | null;
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
  /** The models the place lists in this tool. */
  readonly count: number;
  /** The models the tool's connections offer in total, before the place filters; 0 where unknown. */
  readonly catalogTotal: number;
}

/** How a place names and limits the shared catalog. */
export interface ModelGroupOptions {
  readonly translate: TFunction;
  /** The chosen model, which stays the listed entry where one model has several accesses. */
  readonly selectedId?: string;
  /**
   * The catalog state of every connection the place may use and can run.
   * A connection without a listed model still gets its tool and source, so
   * its state is never missing.
   */
  readonly statuses?: readonly ConnectionCatalogStatus[];
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
  /** Connections of this tool the place may use that list no model for it. */
  readonly emptyConnections: ConnectionCatalogStatus[];
}

function catalogName(model: PageAgentModel): string {
  return model.modelName ?? model.name;
}

/**
 * A model name without a trailing "Free", such as "Gemini 4 Flash Free" or
 * "Model (free)", for a place whose own badge says it.
 * @param name - The catalog name of the model.
 * @returns The name without the word; the name as it is when nothing else remains.
 */
export function withoutTrailingFree(name: string): string {
  const shortened = name.replace(TRAILING_FREE, "").trim();
  return shortened === "" ? name : shortened;
}

function shortName(model: PageAgentModel): string {
  if (model.provider === "openrouter")
    return modelBadgeDisplay({
      provider: model.provider,
      name: catalogName(model),
      modelId: model.model,
      isFree: model.isFree,
    }).name;
  return withoutTrailingFree(catalogName(model));
}

function targetKey(model: PageAgentModel): string {
  return model.runnerRoute?.workspaceId ?? LOCAL_TARGET;
}

/**
 * The name of a tool, from the provider registry, for its group header.
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

function openCodeSourceLabel(source: string, translate: TFunction): string {
  return translate(`plans.modelPicker.sources.${source}`, {
    defaultValue: source,
  });
}

/**
 * The source of an OpenCode model as the model choice names it, such as
 * "OpenCode Zen" or "OpenRouter".
 * @param provider - The provider or runner of the model, such as `opencode`; `null` when the connection is gone.
 * @param modelId - The full model ID, such as `opencode/big-pickle`.
 * @param translate - Translates the source names.
 * @returns `null` for a provider other than OpenCode and for an ID that names no source.
 */
export function openCodeSourceName(
  provider: string | null,
  modelId: string | null,
  translate: TFunction,
): string | null {
  if (provider !== "opencode" || modelId === null || !modelId.includes("/"))
    return null;
  return openCodeSourceLabel(openCodeModelProvider(modelId), translate);
}

/**
 * Names a badge from the connection and its catalog entry. OpenRouter's
 * manufacturer prefix is a separate source, and an unlisted ID stays intact.
 */
export function modelBadgeDisplay(
  model: {
    readonly provider: string | null;
    readonly name: string;
    readonly modelId: string | null;
    readonly isFree?: boolean;
  },
  translate?: TFunction,
): { readonly name: string; readonly source: string | null } {
  const { name, modelId, provider, isFree } = model;
  if (provider === "openrouter") {
    if (name === modelId) return { name, source: null };
    const [, manufacturer = "", catalogLabel = name] =
      OPENROUTER_CATALOG_NAME.exec(name) ?? [];
    const source = manufacturer.trim();
    return {
      name: isFree === true ? withoutTrailingFree(catalogLabel) : catalogLabel,
      source: source === "" ? null : source,
    };
  }
  return {
    name: isFree === true ? withoutTrailingFree(name) : name,
    source: translate ? openCodeSourceName(provider, modelId, translate) : null,
  };
}

/**
 * The tile of a chosen model in a closed model field.
 * @param model - The chosen model.
 * @param groupMark - The mark of the tool the model is listed under.
 * @returns The Z of Z.AI for a Coding Plan model of an OpenCode connection,
 * whose badge names the subscription; the tool's mark otherwise.
 */
export function modelChoiceMark(
  model: PageAgentModel,
  groupMark: string,
): string {
  return model.provider === "opencode" && isZaiCodingPlanModel(model.model)
    ? "zai"
    : groupMark;
}

/** The source of a listed model in the plan's closed model field. */
export function modelChoiceSource(
  model: PageAgentModel,
  translate: TFunction,
): string | null {
  return modelBadgeDisplay(
    {
      name: catalogName(model),
      modelId: model.model,
      provider: model.provider,
    },
    translate,
  ).source;
}

// OpenCode models name their upstream provider; other providers name the connection.
function sourceOf(
  model: PageAgentModel,
  translate: TFunction,
): Omit<SourceDraft, "models"> {
  if (model.provider === "opencode") {
    const provider = openCodeModelProvider(model.model);
    return { key: provider, name: openCodeSourceLabel(provider, translate) };
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

// OpenCode names its upstream sources instead of one kind of access.
function modelAccess(model: PageAgentModel, translate: TFunction): string {
  if (model.provider === "opencode") return "";
  return translate(`plans.modelPicker.access.${model.provider}`, {
    defaultValue: "",
  });
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
  const { translate } = input.options;
  const names = new Map<string, number>();
  for (const model of source.models)
    names.set(shortName(model), (names.get(shortName(model)) ?? 0) + 1);
  return source.models.toSorted(compareModels).map((model) => ({
    model,
    label: shortName(model),
    detail: (names.get(shortName(model)) ?? 0) > 1 ? model.model : null,
    source: input.badge,
    isFree: model.isFree === true,
    connectionName: model.connectionName ?? source.name,
    access: modelAccess(model, translate),
    searchText: foldText(
      [
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
      ].join(" "),
    ),
  }));
}

function buildGroup(draft: GroupDraft, options: ModelGroupOptions): ModelGroup {
  const { translate } = options;
  const models = draft.models;
  const drafts = new Map<string, SourceDraft>();
  for (const model of models) {
    const source = sourceOf(model, translate);
    const sourceDraft = drafts.get(source.key) ?? { ...source, models: [] };
    sourceDraft.models.push(model);
    drafts.set(source.key, sourceDraft);
  }
  for (const connection of draft.emptyConnections)
    drafts.set(connection.connectionId, {
      key: connection.connectionId,
      name: connection.connectionName,
      models: [],
    });
  const ordered = [...drafts.values()].toSorted(compareSources(draft.tool));
  const label = modelToolLabel(draft.tool, translate);
  const context = groupContext(draft, ordered, translate);
  const hasSeveral = ordered.length > 1;
  const sources = ordered.map((source) => ({
    key: source.key,
    label: hasSeveral ? source.name : null,
    choices: choicesOf(source, {
      group: label,
      // OpenCode's context names all its sources; each model matches only its own.
      context: draft.tool === "opencode" ? (draft.targetName ?? "") : context,
      badge: hasSeveral ? source.name : null,
      options,
    }),
    status: sourceStatus(source, options),
  }));
  return {
    key: draft.key,
    label,
    context,
    mark: AGENT_PROVIDERS[draft.tool].mark,
    count: models.length,
    catalogTotal: sources.reduce(
      (sum, source) => sum + (source.status?.modelCount ?? 0),
      0,
    ),
    sources,
  };
}

// A source's models all come through one connection, except OpenCode's upstream
// sources, which name the first one.
function sourceStatus(
  source: SourceDraft,
  options: ModelGroupOptions,
): ConnectionCatalogStatus | null {
  const connectionId = source.models.at(0)?.connectionId ?? source.key;
  return (
    options.statuses?.find((entry) => entry.connectionId === connectionId) ??
    null
  );
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

// A connection the place may use stands in its tool even without a listed
// model, so its state is never missing.
function addEmptyConnections(
  drafts: Map<string, GroupDraft>,
  models: readonly PageAgentModel[],
  options: ModelGroupOptions,
): void {
  const listedConnections = new Set(
    models.map((model) => model.connectionId ?? ""),
  );
  for (const status of options.statuses ?? []) {
    if (listedConnections.has(status.connectionId)) continue;
    const draft = drafts.get(status.provider) ?? {
      key: status.provider,
      tool: status.provider,
      targetName: null,
      models: [],
      emptyConnections: [],
    };
    draft.emptyConnections.push(status);
    drafts.set(status.provider, draft);
  }
}

/**
 * Orders the models of the shared catalog under their execution target, tool and source.
 *
 * @remarks
 * This is the one projection every model choice of Pages uses, so the same
 * models look, group and search the same everywhere. Groups come from the
 * tools the catalog lists, never from a fixed list, and take their names and
 * marks from the provider registry: Claude Code, Codex, Antigravity,
 * OpenCode and OpenRouter first, in this order. Each provider keeps its
 * own models, including another access to the same upstream model. The place
 * passes only the models it can use, so the list and its search hold no
 * other. Models of a remote target never share a group with this host's.
 *
 * @param models - The models the place may offer.
 * @param options - Translation, the chosen model and the catalog states.
 * @returns One group per target and tool that offers at least one model or
 * holds a connection the place may use.
 */
export function modelGroups(
  models: readonly PageAgentModel[],
  options: ModelGroupOptions,
): readonly ModelGroup[] {
  const unique = new Map(models.map((model) => [model.id, model]));
  const drafts = new Map<string, GroupDraft>();
  const simulated = [...unique.values()].filter((model) => model.isSimulation);
  for (const model of unique.values()) {
    if (model.isSimulation) continue;
    const target = targetKey(model);
    const tool = model.provider;
    const key = target === LOCAL_TARGET ? tool : `${target}:${tool}`;
    const draft = drafts.get(key) ?? {
      key,
      tool,
      targetName: target === LOCAL_TARGET ? null : (model.targetName ?? target),
      models: [],
      emptyConnections: [],
    };
    draft.models.push(model);
    drafts.set(key, draft);
  }
  addEmptyConnections(drafts, models, options);
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
 * The models of the agent simulation as a group of their own,
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
    catalogTotal: 0,
    sources: [
      {
        key: "simulation",
        label: null,
        choices: choicesOf(
          { key: "simulation", name: label, models: [...models] },
          { group: label, context, badge: null, options },
        ),
        status: null,
      },
    ],
  };
}

/**
 * Folds text for matching: lower case, without accents.
 * @param text - Any text of a model, tool or connection.
 * @returns The text with case and accents removed.
 */
export function foldText(text: string): string {
  return foldedWithMap(text).text;
}

// Folds each character alone, so every folded position names the character it came from.
function foldedWithMap(text: string): {
  readonly text: string;
  readonly origins: readonly number[];
} {
  let folded = "";
  const origins: number[] = [];
  let position = 0;
  for (const character of text) {
    const piece = character
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase();
    for (let offset = 0; offset < piece.length; offset += 1)
      origins.push(position);
    folded += piece;
    position += character.length;
  }
  origins.push(position);
  return { text: folded, origins };
}

/**
 * The words of a search, folded; every one of them must match.
 * @param query - The typed search.
 * @returns The folded words; none for an empty search.
 */
export function searchTerms(query: string): readonly string[] {
  return foldText(query).split(/\s+/u).filter(Boolean);
}

/** A stretch of a text, marked or plain, as the highlight splits it. */
export interface TextPart {
  readonly text: string;
  readonly isMatch: boolean;
}

/**
 * Splits a text into the stretches the search words match and the rest.
 * @param text - A model name, tool name or connection name.
 * @param terms - The folded words of the search.
 * @returns The stretches in order; the whole text as one plain stretch when
 * no word matches or there are none.
 */
export function highlightParts(
  text: string,
  terms: readonly string[],
): readonly TextPart[] {
  if (terms.length === 0) return [{ text, isMatch: false }];
  const { text: folded, origins } = foldedWithMap(text);
  const marked = new Array<boolean>(text.length).fill(false);
  for (const term of terms) {
    for (
      let index = folded.indexOf(term);
      index !== -1;
      index = folded.indexOf(term, index + term.length)
    )
      for (let at = origins[index]; at < origins[index + term.length]; at += 1)
        marked[at] = true;
  }
  const parts: TextPart[] = [];
  for (let at = 0; at < text.length; at += 1) {
    const last = parts.at(-1);
    if (last && last.isMatch === marked[at])
      parts[parts.length - 1] = { ...last, text: last.text + text[at] };
    else parts.push({ text: text[at], isMatch: marked[at] });
  }
  return parts;
}

/** The catalog states that explain why a model is missing. */
type WarningCatalogState = "empty" | "failed" | "unverified";

/**
 * Whether a connection's state explains why a model is missing.
 * @param status - The catalog state of one connection.
 * @returns `true` for an empty, failed or unverified catalog.
 */
export function isWarningStatus(
  status: ConnectionCatalogStatus | null,
): status is ConnectionCatalogStatus & { readonly state: WarningCatalogState } {
  return status !== null && status.state !== "loaded";
}

/**
 * Keeps the models whose name, ID, tool, connection, access, source or target contain every word of the query.
 *
 * @param groups - All groups of the choice, collapsed ones included.
 * @param query - The typed search, matched without regard to case or accents.
 * @returns The groups and sources with at least one match, counting only the
 * matches. A source whose catalog is empty, failed or unverified stays, so
 * the search keeps explaining why a model is missing.
 */
export function filterModelGroups(
  groups: readonly ModelGroup[],
  query: string,
): readonly ModelGroup[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return groups;
  return groups.flatMap((group) => {
    const sources = group.sources.flatMap((source) => {
      const choices = source.choices.filter((choice) =>
        terms.every((term) => choice.searchText.includes(term)),
      );
      return choices.length === 0 && !isWarningStatus(source.status)
        ? []
        : [{ ...source, choices }];
    });
    return sources.length === 0
      ? []
      : [
          {
            ...group,
            sources,
            count: sources.reduce(
              (sum, source) => sum + source.choices.length,
              0,
            ),
          },
        ];
  });
}

/**
 * Counts the models the groups list.
 * @param groups - The groups of the choice, searched or not.
 * @returns The number of model rows.
 */
export function countChoices(groups: readonly ModelGroup[]): number {
  return groups.reduce((sum, group) => sum + group.count, 0);
}

/**
 * Reads the connection and model ID a selection key names.
 * @param value - A selection key, `["connection","model"]` as JSON.
 * @returns Both parts, or `null` for an empty or unreadable key.
 */
export function savedSelection(
  value: string,
): { readonly connectionId: string; readonly model: string } | null {
  if (value === "") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    )
      return { connectionId: parsed[0], model: parsed[1] };
  } catch {
    return null;
  }
  return null;
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
