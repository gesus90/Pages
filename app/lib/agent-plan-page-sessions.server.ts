import { accountClaudeUsage } from "@/backend/service/agents/sessions/ClaudeUsageAccounting";
import { canProcessRuns } from "@/backend/runtime/RunsMode";
import { AgentPlanCheckpointRepository } from "@/backend/database/repositories/agent/AgentPlanCheckpointRepository";
import { AgentSessionRepository } from "@/backend/database/repositories/agent/AgentSessionRepository";
import { AgentSessionInbox } from "@/backend/service/agents/sessions/AgentSessionInbox";
import { AgentSessionJournal } from "@/backend/service/agents/sessions/AgentSessionJournal";
import { AgentSessionService } from "@/backend/service/agents/sessions/AgentSessionService";
import type { AgentSessionRunAccess } from "@/backend/service/agents/sessions/AgentSessionService";
import type { Database } from "@/backend/database/Database";
import type { AgentApplicationServices } from "./agent-services.server";

/**
 * Builds the PageAgentCLI sessions of plan nodes on the plan service's run access.
 *
 * @remarks
 * Deliveries a stopped server left on the way become `uncertain` before any
 * run starts; none is repeated automatically.
 */
export async function createPageAgentSessions(
  input: {
    readonly database: Database;
    readonly agents: AgentApplicationServices;
  },
  runs: AgentSessionRunAccess,
): Promise<AgentSessionService> {
  const store = new AgentSessionRepository(input.database);
  const journal = new AgentSessionJournal(store, {
    followExternalWrites:
      !canProcessRuns() || Boolean(input.agents.localSessions),
  });
  const inbox = new AgentSessionInbox(store, journal);
  if (canProcessRuns()) await inbox.recover();
  return new AgentSessionService({
    runs,
    store,
    saveUsage: (usage) =>
      usage.provider === "claude_code"
        ? accountClaudeUsage(input.database, usage)
        : store.saveTurnUsage(usage),
    journal,
    inbox,
    hasPlanCheckpoint: async (runId) =>
      (await new AgentPlanCheckpointRepository(input.database).find(runId)) !==
      null,
    isWaitingForCapacity: (runId, stepId) =>
      input.agents.acpResourceScheduler
        .snapshot()
        .waiting.some(
          (request) => request.runId === runId && request.stepId === stepId,
        ),
  });
}
