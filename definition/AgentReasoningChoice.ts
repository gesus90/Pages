/** What a model offers, as far as its reasoning levels are concerned. */
export interface ReasoningSource {
  readonly reasoningEfforts: readonly string[];
}

// The two CLIs whose picker names the reasoning levels of every model. An API catalog or OpenCode lists hundreds of
// models whose levels have nothing to do with each other, so a level of another model is no hint there.
const LEVEL_PICKER_PROVIDERS: readonly string[] = ["claude_code", "codex_cli"];

/**
 * Whether the models of a provider are compared by the levels their target reports.
 *
 * @param provider - The provider of the connection or runner tool.
 * @returns `true` for the Claude Code and Codex CLI pickers.
 */
export function hasLevelPicker(provider: string | null | undefined): boolean {
  return provider != null && LEVEL_PICKER_PROVIDERS.includes(provider);
}

/** The identity of the target a model is listed for: a local connection or one tool of a runner workspace. */
export interface ReasoningTarget {
  readonly provider?: string;
  readonly connectionId?: string;
  readonly runnerRoute?: {
    readonly workspaceId: string;
    readonly tool?: string;
  };
}

/** One reasoning level of a target and whether the chosen model supports it. */
export interface ReasoningChoice {
  readonly effort: string;
  readonly isSupported: boolean;
}

// Levels the CLIs and providers name today, from least to most effort; an unknown level follows in the order it was listed.
const EFFORT_ORDER = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;

function effortRank(effort: string): number {
  const rank = EFFORT_ORDER.findIndex((known) => known === effort);
  return rank === -1 ? EFFORT_ORDER.length : rank;
}

function isSameTarget(
  first: ReasoningTarget,
  second: ReasoningTarget,
): boolean {
  return (
    first.connectionId === second.connectionId &&
    first.runnerRoute?.workspaceId === second.runnerRoute?.workspaceId &&
    first.runnerRoute?.tool === second.runnerRoute?.tool
  );
}

/**
 * The models listed for the same target as another model.
 *
 * @param models - Every model the person may choose.
 * @param model - The chosen model, or `undefined` when nothing matches.
 * @returns The models of the same local connection, or of the same tool of the
 * same runner workspace; nothing for a missing model or a provider whose
 * models are not compared (see {@link hasLevelPicker}).
 */
export function modelsOfSameTarget<Model extends ReasoningTarget>(
  models: readonly Model[],
  model: ReasoningTarget | undefined,
): readonly Model[] {
  if (model === undefined || !hasLevelPicker(model.provider)) return [];
  return models.filter((entry) => isSameTarget(entry, model));
}

/**
 * Every reasoning level the target reports, each marked with the chosen model's support.
 *
 * @param model - The chosen model; `undefined` marks nothing as supported.
 * @param siblings - The models of the same target, which together say which
 * levels the CLI or provider knows at all.
 * @returns The levels in order of effort. A level only some models of the
 * target report stays in the list, so a choice that does not fit the model is
 * visible and can be explained instead of silently missing.
 */
export function reasoningChoices(
  model: ReasoningSource | undefined,
  siblings: readonly ReasoningSource[],
): readonly ReasoningChoice[] {
  const own = model?.reasoningEfforts ?? [];
  const efforts = new Set([
    ...siblings.flatMap((entry) => entry.reasoningEfforts),
    ...own,
  ]);
  return [...efforts]
    .toSorted((first, second) => effortRank(first) - effortRank(second))
    .map((effort) => ({ effort, isSupported: own.includes(effort) }));
}
