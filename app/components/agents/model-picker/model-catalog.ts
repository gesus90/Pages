import {
  AGENT_PROVIDERS,
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

/** The execution target of models on this host. */
const LOCAL_TARGET = "local";

/** One model a consumer can choose, named for the choice. */
export interface ModelChoice {
  readonly model: PageAgentModel;
  /** The model's short catalog name, without host or connection. */
  readonly label: string;
  /** The technical model ID, only where another model of the same source has the same name. */
  readonly detail: string | null;
  /** The source badge, only in a tool with several sources. */
  readonly source: string | null;
  /** Whether the catalog states a price of zero for exactly this access. */
  readonly isFree: boolean;
  /** Why this place cannot use the model; the row stays listed but cannot be chosen. */
  readonly refusal: string | null;
  /** Lower-case words the search matches: name, ID, tool, access, source and target. */
  readonly searchText: string;
}

/** The models of one source of a tool: an OpenCode provider or one connection. */
export interface ModelSource {
  readonly key: string;
  /** The heading above the source's models; `null` in a tool with one source. */
  readonly label: string | null;
  readonly choices: readonly ModelChoice[];
}

/** One tool, such as Claude Code or OpenCode, on one execution target, with its sources and models. */
export interface ModelGroup {
  readonly key: string;
  readonly label: string;
  /** The short access context of the header, such as "Claude-Abo" or "OpenCode + OpenRouter". */
  readonly context: string;
  /** The brand mark key registered for the tool's provider. */
  readonly mark: string;
  readonly sources: readonly ModelSource[];
  readonly count: number;
}

/** How a place names and limits the shared catalog. */
export interface ModelGroupOptions {
  readonly translate: TFunction;
  /** The reason a listed model cannot be chosen here, such as a group of another runner. */
  readonly refusalOf?: (model: PageAgentModel) => string | null;
}

interface SourceDraft {
  readonly key: string;
  readonly name: string;
  readonly models: PageAgentModel[];
}

interface GroupDraft {
  readonly key: string;
  readonly provider: AgentProviderId;
  /** The remote target's name; `null` on this host. */
  readonly targetName: string | null;
  readonly models: PageAgentModel[];
}

function shortName(model: PageAgentModel): string {
  return model.modelName ?? model.name;
}

function targetKey(model: PageAgentModel): string {
  return model.runnerRoute?.workspaceId ?? LOCAL_TARGET;
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
  draft: GroupDraft,
  sources: readonly SourceDraft[],
  translate: TFunction,
): string {
  let access = translate("plans.modelPicker.accessCount", {
    count: sources.length,
  });
  if (draft.provider === "opencode")
    access = sources.map((source) => source.name).join(" + ");
  else if (sources.length === 1)
    access = translate(`plans.modelPicker.access.${draft.provider}`, {
      defaultValue: sources[0].name,
    });
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
      shortName(model),
      model.model,
      input.group,
      input.context,
      source.name,
      model.connectionName ?? "",
      model.targetName ?? "",
      translate(AGENT_PROVIDERS[model.provider].labelKey),
    ]
      .join(" ")
      .toLowerCase(),
  }));
}

function buildGroup(draft: GroupDraft, options: ModelGroupOptions): ModelGroup {
  const { translate } = options;
  const drafts = new Map<string, SourceDraft>();
  for (const model of draft.models) {
    const source = sourceOf(model, translate);
    const sourceDraft = drafts.get(source.key) ?? { ...source, models: [] };
    sourceDraft.models.push(model);
    drafts.set(source.key, sourceDraft);
  }
  const ordered = [...drafts.values()].toSorted(compareSources(draft.provider));
  const label = modelToolLabel(draft.provider, translate);
  const context = groupContext(draft, ordered, translate);
  const hasSeveral = ordered.length > 1;
  return {
    key: draft.key,
    label,
    context,
    mark: AGENT_PROVIDERS[draft.provider].mark,
    count: draft.models.length,
    sources: ordered.map((source) => ({
      key: source.key,
      label: hasSeveral ? source.name : null,
      choices: choicesOf(source, {
        group: label,
        // OpenCode's context names all its sources; each model matches only its own.
        context:
          draft.provider === "opencode" ? (draft.targetName ?? "") : context,
        badge: hasSeveral ? source.name : null,
        options,
      }),
    })),
  };
}

// This host's tools come first, then each remote target's, each by tool name.
function compareGroups(
  first: GroupDraft & { readonly label: string },
  second: GroupDraft & { readonly label: string },
): number {
  const isFirstRemote = first.targetName !== null;
  const isSecondRemote = second.targetName !== null;
  if (isFirstRemote !== isSecondRemote) return isFirstRemote ? 1 : -1;
  return (
    NAME_ORDER.compare(first.targetName ?? "", second.targetName ?? "") ||
    NAME_ORDER.compare(first.label, second.label)
  );
}

/**
 * Orders the models of the shared catalog under their execution target, tool and source.
 *
 * @remarks
 * This is the one projection every model choice of Pages uses, so the same
 * models of the same context look, group and search the same everywhere.
 * Groups come from the providers the catalog lists, never from a fixed list,
 * and take their names and marks from the provider registry. Models keep
 * their technical identity: a model reached through two sources or
 * connections is offered once per source, and only an entry with the very
 * same selection key is offered once. Models of a remote target never share
 * a group with this host's.
 *
 * @param models - The models the place may offer.
 * @param options - Translation and the place's reason a model cannot be chosen.
 * @returns One group per target and tool that offers at least one model.
 */
export function modelGroups(
  models: readonly PageAgentModel[],
  options: ModelGroupOptions,
): readonly ModelGroup[] {
  const unique = new Map(models.map((model) => [model.id, model]));
  const drafts = new Map<string, GroupDraft>();
  for (const model of unique.values()) {
    const target = targetKey(model);
    const key =
      target === LOCAL_TARGET ? model.provider : `${target}:${model.provider}`;
    const draft = drafts.get(key) ?? {
      key,
      provider: model.provider,
      targetName: target === LOCAL_TARGET ? null : (model.targetName ?? target),
      models: [],
    };
    draft.models.push(model);
    drafts.set(key, draft);
  }
  return [...drafts.values()]
    .map((draft) => ({
      ...draft,
      label: modelToolLabel(draft.provider, options.translate),
    }))
    .toSorted(compareGroups)
    .map((draft) => buildGroup(draft, options));
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
