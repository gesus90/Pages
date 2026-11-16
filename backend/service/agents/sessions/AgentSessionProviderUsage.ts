import { codexThreadReportSchema } from "@/definition/CodexPlanUsage";

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

/** Stores the usage of each OpenCode message that changed since its last report. */
export function recordOpenCodeMessages(
  host: ProviderUsageHost,
  messages: readonly OpenCodeMessageUsage[],
  context: OpenCodeMessageContext,
): void {
  const save = host.store.saveOpenCodeMessage;
  if (!save || host.current().provider !== "opencode") return;
  for (const message of messages) {
    const key = `${message.sessionId}:${message.id}`;
    const fingerprint = JSON.stringify(message);
    if (host.openCodeSnapshots.get(key) === fingerprint) continue;
    host.openCodeSnapshots.set(key, fingerprint);
    const attemptId = host.current().key.attemptId;
    const turn = host.turn();
    const reportedAt = host.clock();
    host.enqueue(async () => {
      const price = await openRouterPriceCatalog(
        context.pricingDirectory,
      ).calculate(
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
    });
    host.record({
      kind: "usage",
      text: `OpenCode message ${message.id} usage updated`,
    });
  }
}
