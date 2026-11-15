import { AgentError } from "@/backend/error/AgentErrors";

import type { ClaudeMonthlyBudgetRepository } from "@/backend/database/repositories/agent/ClaudeMonthlyBudgetRepository";

/** Optional Claude-only monthly limit for the agent account executing a plan. */
export class ClaudeMonthlyBudget {
  private readonly repository: Pick<
    ClaudeMonthlyBudgetRepository,
    "limit" | "spent"
  >;
  private readonly now: () => Date;
  public constructor(
    repository: Pick<ClaudeMonthlyBudgetRepository, "limit" | "spent">,
    now: () => Date = () => new Date(),
  ) {
    this.repository = repository;
    this.now = now;
  }

  /** Refuses another Claude step after its computed spending reached the UTC calendar-month limit. */
  public async require(userId: string): Promise<void> {
    const limit = await this.repository.limit(userId);
    if (limit === null) return;
    const month = this.now().toISOString().slice(0, 7);
    const cost = await this.repository.spent(
      userId,
      `${month}-01T00:00:00.000Z`,
    );
    if (cost.known >= limit) throw new AgentError("claude_monthly_cost_limit");
  }
}
