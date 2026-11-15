import { z } from "zod";

import { addClaudeTokens } from "@/definition/ClaudeUsage";
import { canonicalClaudeModel } from "@/definition/ClaudePriceModels";
import { logCaughtError } from "@/backend/logging/Logger";

import type { client as acpClient } from "@agentclientprotocol/sdk";
import type { AcpSessionContext } from "./AcpSessionContracts";
import type {
  ClaudeModelUsage,
  ClaudeUsageObservation,
} from "@/definition/ClaudeUsage";

const nativeCount = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .nullish();
const nativeUsage = z.object({
  input_tokens: nativeCount,
  output_tokens: nativeCount,
  cache_read_input_tokens: nativeCount,
  cache_creation_input_tokens: nativeCount,
});
const modelUsage = z.object({
  inputTokens: nativeCount,
  outputTokens: nativeCount,
  cacheReadInputTokens: nativeCount,
  cacheCreationInputTokens: nativeCount,
});
const assistant = z.object({
  type: z.literal("assistant"),
  message: z.object({ id: z.string(), model: z.string(), usage: nativeUsage }),
});
const result = z.object({
  type: z.literal("result"),
  uuid: z.string(),
  modelUsage: z.record(z.string(), modelUsage),
});
/** Validates the extension envelope without retaining SDK messages or their content. */
export const claudeSdkEnvelope = z.object({
  sessionId: z.string(),
  message: z.unknown(),
});

/** Projects native assistant readings and authoritative session totals, including subagents. */
export function readClaudeSdkUsage(
  envelope: z.infer<typeof claudeSdkEnvelope>,
): ClaudeUsageObservation | null {
  const cycle = result.safeParse(envelope.message);
  if (cycle.success) {
    const models: ClaudeModelUsage[] = Object.entries(
      cycle.data.modelUsage,
    ).map(([model, usage]) => ({
      model: canonicalClaudeModel(model),
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      cacheReadTokens: usage.cacheReadInputTokens ?? null,
      cacheWriteTokens: usage.cacheCreationInputTokens ?? null,
    }));
    // Models without any counter stay in the reading so the step is marked as partially reported.
    return models.some(hasReportedTokens)
      ? {
          sessionId: envelope.sessionId,
          id: cycle.data.uuid,
          kind: "total",
          models: mergeModels(models),
        }
      : null;
  }
  const message = assistant.safeParse(envelope.message);
  if (!message.success) return null;
  const { id, model, usage } = message.data.message;
  if (Object.values(usage).every((count) => count == null)) return null;
  return {
    sessionId: envelope.sessionId,
    id,
    kind: "message",
    models: [
      {
        model: canonicalClaudeModel(model),
        inputTokens: usage.input_tokens ?? null,
        outputTokens: usage.output_tokens ?? null,
        cacheReadTokens: usage.cache_read_input_tokens ?? null,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? null,
      },
    ],
  };
}

/** Registers the Claude-only extension and keeps the same durable notification backpressure as ACP updates. */
export function registerClaudeUsage(
  client: ReturnType<typeof acpClient>,
  context: AcpSessionContext,
  owner: {
    readonly session: () => string | null;
    readonly failed: () => void;
  },
): void {
  if (
    context.driver.provider !== "claude_code" ||
    !context.listener?.claudeUsage
  )
    return;
  client.onNotification(
    "_claude/sdkMessage",
    claudeSdkEnvelope,
    async ({ params }) => {
      try {
        const session = owner.session();
        if (session !== null && params.sessionId !== session) return;
        const observation = readClaudeSdkUsage(params);
        if (observation) context.listener?.claudeUsage?.(observation);
        await context.listener?.drained?.();
      } catch (error: unknown) {
        logCaughtError("ClaudeAcpUsage", error);
        owner.failed();
      } finally {
        context.notificationHandled?.();
      }
    },
  );
}

function hasReportedTokens(usage: ClaudeModelUsage): boolean {
  return [
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens,
  ].some((count) => count !== null);
}

function mergeModels(models: readonly ClaudeModelUsage[]): ClaudeModelUsage[] {
  const merged = new Map<string, ClaudeModelUsage>();
  for (const model of models) {
    const previous = merged.get(model.model);
    merged.set(
      model.model,
      previous
        ? { model: model.model, ...addClaudeTokens(previous, model) }
        : model,
    );
  }
  return [...merged.values()];
}
