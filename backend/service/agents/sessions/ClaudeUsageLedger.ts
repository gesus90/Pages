import { addClaudeTokens, CLAUDE_TOKEN_FIELDS } from "@/definition/ClaudeUsage";

import type { ClaudeLedger } from "@/definition/ClaudeUsage";
import type {
  ClaudeModelUsage,
  ClaudeUsageObservation,
} from "@/definition/ClaudeUsage";

/** Sums the authoritative total and the provisional messages received since that result. */
export function ledgerTotals(
  ledger: ClaudeLedger,
): readonly ClaudeModelUsage[] {
  const totals = new Map(ledger.settled.map((entry) => [entry.model, entry]));
  for (const entry of Object.values(ledger.messages)) {
    const previous = totals.get(entry.model);
    totals.set(
      entry.model,
      previous
        ? { model: entry.model, ...addClaudeTokens(previous, entry) }
        : entry,
    );
  }
  return [...totals.values()];
}

/** Replaces repeated assistant readings and reconciles them with cumulative SDK modelUsage. */
export function applyClaudeObservation(
  ledger: ClaudeLedger,
  observation: ClaudeUsageObservation,
): ClaudeLedger {
  const id = `${observation.kind}:${observation.id}`;
  if (ledger.seen.includes(id)) return ledger;
  if (observation.kind === "prompt") {
    const settled = new Map(
      ledger.settled.map((entry) => [entry.model, entry]),
    );
    for (const model of observation.models) {
      const previous = settled.get(model.model);
      settled.set(
        model.model,
        previous
          ? { model: model.model, ...addClaudeTokens(previous, model) }
          : model,
      );
    }
    return {
      ...ledger,
      settled: [...settled.values()],
      seen: [...ledger.seen, id],
    };
  }
  if (observation.kind === "message") {
    const entry = observation.models[0];
    return entry
      ? { ...ledger, messages: { ...ledger.messages, [observation.id]: entry } }
      : ledger;
  }
  // Replayed/lower session totals never charge pre-resume history a second time.
  const settled = observation.models.map((entry) => {
    const previous = ledger.settled.find(
      (candidate) => candidate.model === entry.model,
    );
    if (!previous) return entry;
    const maximum = (
      field: (typeof CLAUDE_TOKEN_FIELDS)[number],
    ): number | null =>
      entry[field] === null
        ? previous[field]
        : Math.max(entry[field], previous[field] ?? 0);
    return {
      model: entry.model,
      inputTokens: maximum("inputTokens"),
      outputTokens: maximum("outputTokens"),
      cacheReadTokens: maximum("cacheReadTokens"),
      cacheWriteTokens: maximum("cacheWriteTokens"),
    };
  });
  const missing = ledger.settled.filter(
    (entry) => !settled.some((candidate) => candidate.model === entry.model),
  );
  return {
    settled: [...missing, ...settled],
    messages: {},
    seen: [
      ...ledger.seen,
      id,
      ...Object.keys(ledger.messages).map((key) => `message:${key}`),
    ],
  };
}

/** Allocates only the change in a session reading to the current turn, including final corrections. */
export function allocateClaudeTokens(
  previous: readonly ClaudeModelUsage[],
  current: readonly ClaudeModelUsage[],
  allocated: readonly ClaudeModelUsage[],
): readonly ClaudeModelUsage[] {
  const models = new Set(
    [...previous, ...current, ...allocated].map((entry) => entry.model),
  );
  return [...models]
    .map((model) => {
      const before = previous.find((entry) => entry.model === model);
      const after = current.find((entry) => entry.model === model);
      const own = allocated.find((entry) => entry.model === model);
      const delta = (
        field: (typeof CLAUDE_TOKEN_FIELDS)[number],
      ): number | null => {
        if (after?.[field] == null && own?.[field] == null) return null;
        return Math.max(
          0,
          (own?.[field] ?? 0) + (after?.[field] ?? 0) - (before?.[field] ?? 0),
        );
      };
      return {
        model,
        inputTokens: delta("inputTokens"),
        outputTokens: delta("outputTokens"),
        cacheReadTokens: delta("cacheReadTokens"),
        cacheWriteTokens: delta("cacheWriteTokens"),
      };
    })
    .filter(
      (entry) =>
        allocated.some((own) => own.model === entry.model) ||
        CLAUDE_TOKEN_FIELDS.some((field) => (entry[field] ?? 0) > 0) ||
        !previous.some((before) => before.model === entry.model),
    );
}
