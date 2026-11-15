import { AgentError } from "@/backend/error/AgentErrors";

import type { CodexPlanUsageRepository } from "@/backend/database/repositories/agent/CodexPlanUsageRepository";

/** Subscription work uses the same persisted equivalent USD amounts as the run panel. */
export class CodexAgentBudget {
  private readonly usage: Pick<CodexPlanUsageRepository, "monthlyCost">;

  public constructor(usage: Pick<CodexPlanUsageRepository, "monthlyCost">) {
    this.usage = usage;
  }

  /** Refuses the next Codex request once this agent's UTC calendar-month limit is reached. */
  public async requireAvailable(
    agentId: string,
    limit: number | undefined,
  ): Promise<void> {
    if (limit === undefined) return;
    const spent = await this.usage.monthlyCost(
      agentId,
      new Date().toISOString().slice(0, 7),
    );
    if (spent >= limit) throw new AgentError("codex_monthly_cost_limit");
  }
}
