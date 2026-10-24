/**
 * The parts of a versioned Claude model ID such as `claude-sonnet-5-5`.
 *
 * @remarks
 * `version` reads like the vendor's name for it: `5.5` for `5-5`, `5` for a
 * model without a minor version. A date suffix is not part of the version and
 * a context size such as `[1m]` is kept apart, because it names a variant of
 * the same model.
 */
export interface ClaudeModelParts {
  readonly family: string;
  readonly version: string;
  readonly context: string | null;
}

// `claude-<family>-<major>[-<minor>][-<date>][[<context>]]`; the older `claude-3-5-sonnet` order is not named by a family first.
const CLAUDE_MODEL_ID =
  /^claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2}))?(?:-\d{8})?(?:\[(\d+m)\])?$/iu;

// The CLI picker's family aliases, optionally with a context size.
const CLAUDE_MODEL_ALIAS = /^([a-z]+)(?:\[(\d+m)\])?$/iu;

/**
 * Reads the family, version and context size out of a Claude model ID.
 *
 * @param id - The model ID as the CLI reports it.
 * @returns The parts, or `null` for an ID that is not a versioned Claude model.
 */
export function parseClaudeModelId(id: string): ClaudeModelParts | null {
  const match = CLAUDE_MODEL_ID.exec(id);
  if (!match) return null;
  const [, family, major, minor, context] = match;
  return {
    family: family.toLowerCase(),
    version: minor === undefined ? major : `${major}.${minor}`,
    context: context === undefined ? null : context.toLowerCase(),
  };
}

/**
 * Whether a stored model value reads like a Claude family alias such as `sonnet`.
 *
 * @param value - The stored model value.
 * @returns `true` for a family name, optionally with a context size; a
 * concrete model ID is not an alias.
 */
export function isClaudeModelAlias(value: string): boolean {
  return CLAUDE_MODEL_ALIAS.test(value);
}

function capitalize(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/**
 * The name a model carries in a model choice, including its version.
 *
 * @param id - The concrete model ID.
 * @param name - The name the catalog states, such as the CLI's `Sonnet`.
 * @returns `Sonnet 5.5` for `claude-sonnet-5-5` named `Sonnet`; the name
 * unchanged when it already carries a version or the ID names no versioned
 * Claude model.
 *
 * @remarks
 * The Claude CLI names the rows of its picker after their family only, so the
 * version comes from the model ID the same row resolves to. A parenthesised
 * addition of the name stays behind the version.
 */
export function describeClaudeModel(id: string, name: string): string {
  const parts = parseClaudeModelId(id);
  if (parts === null) return name;
  const [, base = name, suffix = ""] =
    /^([^()]*?)\s*(\(.*\))?$/u.exec(name) ?? [];
  if (/\d/u.test(base)) return name;
  // A name that already says the context size, such as `Opus (1M context)`, keeps its own wording.
  const namesContext = /\d+[mk]\b/iu.test(suffix);
  const context =
    parts.context === null || namesContext
      ? ""
      : ` (${parts.context.toUpperCase()})`;
  const addition = suffix === "" ? "" : ` ${suffix}`;
  return `${capitalize(parts.family)} ${parts.version}${context}${addition}`;
}

/** A model of one target as far as alias resolution is concerned. */
export interface AliasCandidate {
  readonly id: string;
  /** What the CLI's picker says resolves to this model; absent where it does not say. */
  readonly aliases?: readonly string[];
}

/**
 * Resolves a Claude alias such as `sonnet` to the model a target lists for it.
 *
 * @param alias - The stored model value.
 * @param candidates - The concrete models the target's catalog lists.
 * @returns The ID of the one model the CLI's picker maps the alias to. A
 * catalog without picker data (saved before the CLI's picker values were
 * kept) resolves a family name to the one listed model of that family and
 * context size. `null` when the value is no alias or nothing, or several
 * models, fit, so that no model nobody chose is ever substituted.
 *
 * @remarks
 * `default` is never resolved: what it names depends on the account.
 */
export function resolveClaudeModelAlias(
  alias: string,
  candidates: readonly AliasCandidate[],
): string | null {
  const match = CLAUDE_MODEL_ALIAS.exec(alias);
  if (!match || alias.toLowerCase() === "default") return null;
  if (candidates.some((candidate) => candidate.aliases !== undefined)) {
    const named = candidates.filter((candidate) =>
      candidate.aliases?.includes(alias),
    );
    return named.length === 1 ? named[0].id : null;
  }
  const family = match[1].toLowerCase();
  const context = match[2]?.toLowerCase() ?? null;
  const listed = candidates.filter((candidate) => {
    const parts = parseClaudeModelId(candidate.id);
    return parts?.family === family && parts.context === context;
  });
  return listed.length === 1 ? listed[0].id : null;
}

/** A stored model value matched to a listed model. */
export interface StoredModelMatch<Model> {
  readonly model: Model;
  /** The family alias the value was stored under; `null` for the exact ID. */
  readonly alias: string | null;
}

/**
 * Finds the listed model a stored value names.
 *
 * @param models - The models of one target, each naming its concrete ID.
 * @param stored - The model value as it is stored.
 * @returns The model with the exact ID; otherwise the one model a Claude
 * family alias resolves to, together with that alias; `undefined` when
 * nothing matches and the stored value has to stay as it is.
 */
export function findStoredModel<
  Model extends {
    readonly model: string;
    readonly aliases?: readonly string[];
  },
>(
  models: readonly Model[],
  stored: string,
): StoredModelMatch<Model> | undefined {
  const exact = models.find((entry) => entry.model === stored);
  if (exact) return { model: exact, alias: null };
  const resolved = resolveClaudeModelAlias(
    stored,
    models.map((entry) => ({ id: entry.model, aliases: entry.aliases })),
  );
  const model = models.find((entry) => entry.model === resolved);
  return model ? { model, alias: stored } : undefined;
}

/**
 * Finds the choosable model a saved selection names.
 *
 * @param models - Every model the person may choose.
 * @param saved - The connection and model value of the saved selection.
 * @returns The model of that connection, found as {@link findStoredModel}
 * does; `undefined` for a selection without a connection, such as a runner
 * route, which names its model exactly and never by an alias.
 */
export function findSavedModel<
  Model extends {
    readonly model: string;
    readonly aliases?: readonly string[];
    readonly connectionId?: string;
  },
>(
  models: readonly Model[],
  saved: { readonly connectionId?: string; readonly model: string },
): StoredModelMatch<Model> | undefined {
  if (saved.connectionId === undefined) return undefined;
  return findStoredModel(
    models.filter((entry) => entry.connectionId === saved.connectionId),
    saved.model,
  );
}
