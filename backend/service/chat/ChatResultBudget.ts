import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { serializeAgentRead } from "@/backend/service/agents/AgentReadSerialization";
import { AGENT_READ_LIMITS } from "@/definition/AgentReadChunks";

import type { ChatActionOutcome } from "./ChatPrompt";

/** Caps successful and failed tool results together for one model turn. */
export class ChatResultBudget {
  private bytes = 0;

  /** Preserves complete JSON or returns an explicit refusal; never silently truncates a result. */
  public consume(outcome: ChatActionOutcome): ChatActionOutcome {
    try {
      const serialized = serializeAgentRead({
        ok: outcome.ok,
        result: outcome.result ?? null,
        error: outcome.error ?? null,
        details: outcome.details ?? null,
      });
      const bytes = Buffer.byteLength(serialized);
      if (this.bytes + bytes > AGENT_READ_LIMITS.turnResultBytes)
        return { ok: false, error: "RESULT_BUDGET_EXCEEDED" };
      this.bytes += bytes;
      return outcome;
    } catch (error: unknown) {
      if (!(error instanceof AgentOperationError)) throw error;
      return { ok: false, error: error.code, details: error.details };
    }
  }
}
