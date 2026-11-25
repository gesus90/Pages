import type { Usage, UsageUpdate } from "@agentclientprotocol/sdk";
import type { AcpProviderId } from "@/definition/AgentConfiguration";
import type {
  AgentSessionContextUsage,
  AgentSessionTokenUsage,
  AgentSessionTurnUsage,
  AgentSessionUsageTotal,
} from "@/definition/AgentSessionJournal";

import type {
  AgentPriceGap,
  AgentSessionUsageEstimate,
} from "@/definition/AgentSessionPricing";
import type { AcpUsageCapability } from "@/definition/AgentSessionUsageCapabilities";
import { summarizeClaudeUsage } from "@/definition/ClaudeUsageSummary";
import type { ClaudeUsageSummary } from "@/definition/ClaudeUsage";
export { ACP_USAGE_CAPABILITIES } from "@/definition/AgentSessionUsageCapabilities";
export type {
  AcpTokenCounting,
  AcpUsageCapability,
} from "@/definition/AgentSessionUsageCapabilities";

const TOKEN_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "totalTokens",
] as const;

type TokenField = (typeof TOKEN_FIELDS)[number];

type TokenCounts = Readonly<Record<TokenField, number | null>>;

/** A turn's counts and whether the adapter's running total started over. */
export interface TurnTokenDelta {
  readonly tokens: AgentSessionTokenUsage;
  readonly isReset: boolean;
}

/** The valuation stored with one turn, as the accounting of its provider wrote it. */
export interface TurnValuation {
  /** The amount of the turn in US dollars; `null` when none could be calculated. */
  readonly amountUsd: number | null;
  /** Why a turn that reported input and output has no amount. */
  readonly missing: AgentPriceGap;
  /** When the catalog prices of the amount were read. */
  readonly priceAsOf: readonly string[];
  /** The catalog entries the amount was priced with. */
  readonly priceModels: readonly string[];
}

/** A turn with the valuation stored with it. */
interface ValuedTurn {
  readonly turn: AgentSessionTurnUsage;
  readonly valuation: TurnValuation;
}

/** The counts of an attempt without a turn: nothing reported yet, never 0. */
const NO_TOKENS = {
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  totalTokens: null,
  inputIncludesCache: null,
  isPartial: true,
} as const;

function count(input: unknown): number | null {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0
    ? input
    : null;
}

/** The context occupancy before any report: everything unknown. */
export const UNKNOWN_CONTEXT: AgentSessionContextUsage = {
  contextUsed: null,
  contextLimit: null,
  percent: null,
  source: null,
  reportedAt: null,
};

/**
 * Reads the context occupancy of a `usage_update`.
 * @param update - The update as the adapter sent it.
 * @param reportedAt - When Pages received it.
 * @param provider - Claude Code reports zero after an unmeasured compaction.
 */
export function readContextUsage(
  update: Pick<UsageUpdate, "used" | "size">,
  reportedAt: string,
  provider: AcpProviderId,
): AgentSessionContextUsage {
  const used = count(update.used);
  const limit = count(update.size);
  const contextUsed = provider === "claude_code" && used === 0 ? null : used;
  const contextLimit = limit === 0 ? null : limit;
  return {
    contextUsed,
    contextLimit,
    percent:
      contextUsed === null || contextLimit === null
        ? null
        : Math.round((contextUsed / contextLimit) * 1_000) / 10,
    source:
      contextUsed === null && contextLimit === null ? null : "acp_usage_update",
    reportedAt,
  };
}

/**
 * The occupancy to store after a report: the last reported value stays until
 * a new one comes.
 * @param stored - The occupancy stored so far.
 * @param reported - The occupancy of the new report.
 * @returns The new report with every value it left out taken from the stored
 * one; the stored one when the report named nothing.
 * @remarks
 * A report without an occupancy, such as the 0 claude-agent-acp sends after
 * a compaction it could not measure, never empties a known value.
 */
export function keepReportedContext(
  stored: AgentSessionContextUsage,
  reported: AgentSessionContextUsage,
): AgentSessionContextUsage {
  if (reported.source === null) return stored;
  if (reported.contextUsed !== null && reported.contextLimit !== null)
    return reported;
  const contextUsed = reported.contextUsed ?? stored.contextUsed;
  const contextLimit = reported.contextLimit ?? stored.contextLimit;
  return {
    ...reported,
    contextUsed,
    contextLimit,
    percent:
      contextUsed === null || contextLimit === null
        ? null
        : Math.round((contextUsed / contextLimit) * 1_000) / 10,
    reportedAt:
      reported.contextUsed === null ? stored.reportedAt : reported.reportedAt,
  };
}

/**
 * Fills the missing context window of a session's occupancy from its model.
 * @param context - The occupancy the adapter reported so far.
 * @param window - The context window of the attempt's catalog model, or `null` when the catalog states none.
 * @returns The occupancy with the window; unchanged when the adapter reported a window or the model has none.
 */
export function withCatalogContextWindow(
  context: AgentSessionContextUsage,
  window: number | null,
): AgentSessionContextUsage {
  if (context.contextLimit !== null || window === null || window <= 0)
    return context;
  return {
    ...context,
    contextLimit: window,
    percent:
      context.contextUsed === null
        ? null
        : Math.round((context.contextUsed / window) * 1_000) / 10,
  };
}

function readCounts(usage: Usage): TokenCounts {
  return {
    inputTokens: count(usage.inputTokens),
    outputTokens: count(usage.outputTokens),
    cacheReadTokens: count(usage.cachedReadTokens),
    cacheWriteTokens: count(usage.cachedWriteTokens),
    totalTokens: count(usage.totalTokens),
  };
}

function hasDecreased(previous: TokenCounts, current: TokenCounts): boolean {
  return TOKEN_FIELDS.some((field) => {
    const before = previous[field];
    const after = current[field];
    return before !== null && after !== null && after < before;
  });
}

function countsBy(read: (field: TokenField) => number | null): TokenCounts {
  return {
    inputTokens: read("inputTokens"),
    outputTokens: read("outputTokens"),
    cacheReadTokens: read("cacheReadTokens"),
    cacheWriteTokens: read("cacheWriteTokens"),
    totalTokens: read("totalTokens"),
  };
}

function difference(previous: TokenCounts, current: TokenCounts): TokenCounts {
  return countsBy((field) => {
    const after = current[field];
    return after === null ? null : after - (previous[field] ?? 0);
  });
}

/**
 * Reads the tokens of one finished prompt.
 * @param capability - How the adapter counts.
 * @param usage - `PromptResponse.usage`, or `null` when the adapter sent none.
 * @param previous - The adapter's last report in the same native session, for a `session_total` counting.
 * @returns The turn's own counts, or `null` when the adapter reported none.
 * @remarks
 * A running total that decreased started over, after a new native session
 * or a reset of the adapter; the report then counts on its own.
 */
export function readTurnTokens(
  capability: AcpUsageCapability,
  usage: Usage | null,
  previous: Usage | null,
): TurnTokenDelta | null {
  if (usage === null) return null;
  const current = readCounts(usage);
  if (TOKEN_FIELDS.every((field) => current[field] === null)) return null;
  const before =
    capability.counting === "session_total" && previous !== null
      ? readCounts(previous)
      : null;
  const isReset = before !== null && hasDecreased(before, current);
  const own =
    before === null || isReset ? current : difference(before, current);
  return {
    isReset,
    tokens: {
      ...own,
      inputIncludesCache: capability.inputIncludesCache,
      isPartial: capability.isPartial,
    },
  };
}

/**
 * Adds the usage of a turn to the turns of an attempt.
 * @param turns - The turns recorded so far.
 * @param next - The report of one turn.
 * @returns The turns with `next` in place of an earlier report of the same
 * attempt and turn, so a repeated report never counts twice.
 */
export function withTurnUsage(
  turns: readonly AgentSessionTurnUsage[],
  next: AgentSessionTurnUsage,
): readonly AgentSessionTurnUsage[] {
  return [
    ...turns.filter(
      (turn) => turn.attemptId !== next.attemptId || turn.turn !== next.turn,
    ),
    next,
  ].sort(
    (first, second) =>
      first.attemptId.localeCompare(second.attemptId) ||
      first.turn - second.turn,
  );
}

function sumField(
  turns: readonly AgentSessionTurnUsage[],
  field: TokenField,
): { readonly sum: number | null; readonly isMissing: boolean } {
  const known = turns.flatMap((turn) => {
    const value = turn[field];
    return value === null ? [] : [value];
  });
  return {
    sum:
      known.length === 0 ? null : known.reduce((total, value) => total + value),
    isMissing: known.length > 0 && known.length < turns.length,
  };
}

function totalOf(
  provider: AgentSessionUsageTotal["provider"],
  turns: readonly AgentSessionTurnUsage[],
): AgentSessionUsageTotal {
  const cacheSemantics = new Set(turns.map((turn) => turn.inputIncludesCache));
  const priced = turns.filter((turn) => turn.costState !== undefined);
  const hasUnknownCost = priced.some((turn) => turn.costState === "unknown");
  const costAmount =
    priced.length === 0 || hasUnknownCost
      ? null
      : priced.reduce((sum, turn) => sum + (turn.costAmount ?? 0), 0);
  let costState: "known" | "free" | "unknown" = "known";
  if (hasUnknownCost) costState = "unknown";
  else if (priced.every((turn) => turn.costState === "free"))
    costState = "free";
  return {
    provider,
    turns: turns.length,
    models: [
      ...new Set(
        turns.flatMap((turn) => (turn.model === null ? [] : [turn.model])),
      ),
    ],
    ...countsBy((field) => sumField(turns, field).sum),
    ...(turns.some((turn) => turn.reasoningTokens !== undefined)
      ? {
          reasoningTokens: turns.reduce(
            (sum, turn) => sum + (turn.reasoningTokens ?? 0),
            0,
          ),
        }
      : {}),
    ...(priced.length > 0
      ? {
          costAmount,
          costState,
        }
      : {}),
    // Different cache countings in one sum cannot say what the input contains.
    inputIncludesCache:
      cacheSemantics.size === 1 ? (turns[0]?.inputIncludesCache ?? null) : null,
    isPartial:
      turns.some((turn) => turn.isPartial) ||
      TOKEN_FIELDS.some((field) => sumField(turns, field).isMissing),
  };
}

/**
 * Sums turns per provider, for one attempt or a whole run.
 * @param turns - Turns of any attempts; each attempt and turn counts once.
 * @returns One sum per provider; countings of different providers are never added.
 */
export function sumTurnUsage(
  turns: readonly AgentSessionTurnUsage[],
): readonly AgentSessionUsageTotal[] {
  const unique = turns.reduce<readonly AgentSessionTurnUsage[]>(
    (kept, turn) => withTurnUsage(kept, turn),
    [],
  );
  const providers = [...new Set(unique.map((turn) => turn.provider))];
  return providers.map((provider) =>
    totalOf(
      provider,
      unique.filter((turn) => turn.provider === provider),
    ),
  );
}

/** Why the turns of an attempt carry no amount; empty when every turn has one. */
function attemptPriceGaps(
  valued: readonly ValuedTurn[],
): readonly AgentPriceGap[] {
  const gaps = new Set<AgentPriceGap>();
  if (valued.length === 0) gaps.add("attempt");
  for (const { turn, valuation } of valued) {
    if (turn.inputTokens === null || turn.outputTokens === null)
      gaps.add("tokens");
    else if (valuation.amountUsd === null) gaps.add(valuation.missing);
  }
  return [...gaps];
}

/**
 * The tokens the turns of one attempt processed and their estimate, for the
 * block "Verbrauch" of the plan terminal.
 * @param turns - The turns of one attempt and one provider; another attempt never adds to them.
 * @param valuate - Reads the valuation the provider's accounting stored with a turn.
 * @returns The sums of the turns with the amount stored with them.
 * @remarks
 * The counts stay the provider's own. The amount is the sum of the stored
 * valuations, at the price frozen for the attempt. A turn that still runs
 * holds its latest interim reading and marks the amount as partial; the
 * counts of its end replace it. Without a turn, with a turn that lacks input
 * or output, or with a turn without a valuation there is no amount.
 */
export function attemptUsageEstimate(
  turns: readonly AgentSessionTurnUsage[],
  valuate: (turn: AgentSessionTurnUsage) => TurnValuation,
): AgentSessionUsageEstimate {
  const tokens = sumTurnUsage(turns)[0] ?? NO_TOKENS;
  const valued = turns.map((turn) => ({ turn, valuation: valuate(turn) }));
  const valuations = valued.map((entry) => entry.valuation);
  const gaps = attemptPriceGaps(valued);
  const amountUsd =
    gaps.length > 0
      ? null
      : valuations.reduce(
          (sum, valuation) => sum + (valuation.amountUsd ?? 0),
          0,
        );
  return {
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cacheReadTokens: tokens.cacheReadTokens,
    cacheWriteTokens: tokens.cacheWriteTokens,
    totalTokens: tokens.totalTokens,
    inputIncludesCache: tokens.inputIncludesCache,
    isPartial: tokens.isPartial || gaps.length > 0,
    turns: turns.length,
    amountUsd,
    isAmountPartial: amountUsd !== null && turns.some((turn) => turn.isPartial),
    priceAsOf: [
      ...new Set(valuations.flatMap((valuation) => valuation.priceAsOf)),
    ],
    priceModels: [
      ...new Set(valuations.flatMap((valuation) => valuation.priceModels)),
    ],
    gaps,
  };
}

/** The valuation the Claude accounting stored with a turn: its amount and the frozen prices of its models. */
function claudeTurnValuation(turn: AgentSessionTurnUsage): TurnValuation {
  const prices = (turn.claudeAccounting?.models ?? []).flatMap((model) =>
    model.price ? [model.price] : [],
  );
  return {
    amountUsd: turn.claudeAccounting?.costUsd ?? null,
    missing: "price",
    priceAsOf: prices.map((price) => price.fetchedAt),
    priceModels: prices.map((price) => price.modelId),
  };
}

/**
 * The tokens one Claude Code attempt processed and their estimate, for the
 * block "Verbrauch" of the plan terminal.
 * @param turns - Turns of any attempt; only the Claude Code turns of `attemptId` count.
 * @param attemptId - The selected attempt; another attempt never adds to it.
 * @returns The sums of the attempt's turns with the amount stored with them.
 * @remarks
 * Claude counts input, cache reads and cache writes apart, so no count
 * contains another. The amount is the value the accounting stored with the
 * turns at the catalog price frozen for the attempt and each model; it
 * contains the cache writes a turn reported. A count a turn lacks adds
 * nothing and marks the amount as partial, as an interim reading of a
 * running turn does.
 */
export function claudeAttemptUsage(
  turns: readonly AgentSessionTurnUsage[],
  attemptId: string,
): AgentSessionUsageEstimate {
  return attemptUsageEstimate(
    turns.filter(
      (turn) => turn.provider === "claude_code" && turn.attemptId === attemptId,
    ),
    claudeTurnValuation,
  );
}

/**
 * Sums the Claude usage of one node; an attempt without stored turns makes the sum incomplete.
 * @param turns - Turns of the run; only the turns of `attempts` count.
 * @param attempts - The attempt ids of the node.
 * @returns The Claude usage of the node.
 */
export function claudeNodeUsage(
  turns: readonly AgentSessionTurnUsage[],
  attempts: ReadonlySet<string>,
): ClaudeUsageSummary {
  const own = turns.filter((turn) => attempts.has(turn.attemptId));
  const usage = summarizeClaudeUsage(own);
  return {
    ...usage,
    isIncomplete:
      usage.isIncomplete ||
      [...attempts].some((id) => !own.some((turn) => turn.attemptId === id)),
  };
}
