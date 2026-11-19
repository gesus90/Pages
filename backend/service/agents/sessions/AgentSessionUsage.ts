import type { Usage, UsageUpdate } from "@agentclientprotocol/sdk";
import type { AcpProviderId } from "@/definition/AgentConfiguration";
import type {
  AgentSessionContextUsage,
  AgentSessionTokenUsage,
  AgentSessionTurnUsage,
  AgentSessionUsageTotal,
} from "@/definition/AgentSessionJournal";

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
