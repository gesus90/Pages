import { codexThreadReportSchema } from "@/definition/CodexPlanUsage";

import { isOpenCodeRunner } from "./AgentSessionAttempts";
import { openRouterPriceCatalog } from "./OpenRouterPriceCatalog";

import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { OpenCodeMessageUsage } from "@/backend/agents/cli/OpenCodeSessionUsage";
import type { AgentSessionEventInput } from "./AgentSessionJournal";
import type {
  AgentSessionAttemptRecord,
  AgentSessionStore,
} from "./AgentSessionStore";

/** What the provider usage readers take from the recorder that owns the attempt. */
export interface ProviderUsageHost {
  readonly store: AgentSessionStore;
  readonly openCodeSnapshots: Map<string, string>;
  current(): AgentSessionAttemptRecord;
  turn(): number;
  clock(): string;
  enqueue(write: () => Promise<void>): void;
  record(
    event: Omit<AgentSessionEventInput, "turn"> & {
      readonly turn?: number;
    },
  ): void;
}

/** The pricing inputs that every OpenCode message of one batch shares. */
export interface OpenCodeMessageContext {
  readonly pricingDirectory: string;
  readonly freeModelId: string | null;
  readonly mapping: Readonly<Record<string, string>>;
}

/**
 * Stores the Codex thread usage that an update reports.
 * @returns `true` when the report belongs to a turn of this run, so the native
 * usage of the turn's prompt must not be counted a second time.
 */
export function readCodexUsageReport(
  host: ProviderUsageHost,
  update: SessionUpdate,
): boolean {
  const parsed = codexThreadReportSchema.safeParse(
    update._meta?.pagesCodexUsage,
  );
  if (!parsed.success) return false;
  const report = parsed.data;
  const attempt = host.current();
  const turn = host.turn();
  const reportedAt = host.clock();
  host.enqueue(() =>
    host.store.saveTurnUsage({
      ...report.totals,
      totalTokens:
        report.totals.inputTokens === null ||
        report.totals.outputTokens === null
          ? null
          : report.totals.inputTokens + report.totals.outputTokens,
      cacheWriteTokens: null,
      inputIncludesCache: true,
      isPartial:
        report.totals.inputTokens === null ||
        report.totals.outputTokens === null,
      attemptId: attempt.key.attemptId,
      turn,
      provider: "codex_cli",
      model: report.model,
      reportedAt,
      codex: {
        connectionId: attempt.connectionId ?? "",
        agentId: attempt.agentId ?? "",
        report,
      },
    }),
  );
  if (!report.baseline)
    host.record({ kind: "usage", text: "Codex thread usage updated" });
  return !report.baseline;
}

/** The OpenCode messages of a reading whose usage differs from the one reported last. */
function changedOpenCodeMessages(
  host: ProviderUsageHost,
  messages: readonly OpenCodeMessageUsage[],
): readonly OpenCodeMessageUsage[] {
  return messages.filter((message) => {
    const key = `${message.sessionId}:${message.id}`;
    const fingerprint = JSON.stringify(message);
    if (host.openCodeSnapshots.get(key) === fingerprint) return false;
    host.openCodeSnapshots.set(key, fingerprint);
    return true;
  });
}

/**
 * Stores the usage of each OpenCode message that changed since its last report.
 * @param host - The recorder that owns the attempt whose turn runs.
 * @param messages - The model steps read from OpenCode's session database.
 * @param context - What prices the steps of this batch.
 * @remarks
 * An attempt of an OpenRouter connection runs on OpenCode as well, so its
 * steps are stored the same way while the turn runs. The changed steps of
 * one reading are one write and one `usage` event: an attempt that resumes a
 * native session reads every earlier step at once, and a write per step
 * would overrun the write queue of the recorder and fail the turn.
 */
export function recordOpenCodeMessages(
  host: ProviderUsageHost,
  messages: readonly OpenCodeMessageUsage[],
  context: OpenCodeMessageContext,
): void {
  const save = host.store.saveOpenCodeMessage;
  if (!save || !isOpenCodeRunner(host.current().provider)) return;
  const changed = changedOpenCodeMessages(host, messages);
  const [first] = changed;
  if (first === undefined) return;
  const attemptId = host.current().key.attemptId;
  const turn = host.turn();
  const reportedAt = host.clock();
  host.enqueue(async () => {
    const catalog = openRouterPriceCatalog(context.pricingDirectory);
    for (const message of changed) {
      const price = await catalog.calculate(
        message,
        context.mapping,
        context.freeModelId !== null && message.model === context.freeModelId,
      );
      await save.call(host.store, {
        ...message,
        attemptId,
        turn,
        price,
        reportedAt,
      });
    }
  });
  host.record({
    kind: "usage",
    text:
      changed.length === 1
        ? `OpenCode message ${first.id} usage updated`
        : `OpenCode usage of ${String(changed.length)} messages updated`,
  });
}
