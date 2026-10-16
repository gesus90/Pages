import {
  evaluatePlanAcceptance,
  evaluateTodoCompletion,
} from "./AgentPlanAcceptance";
import { refreshPlanContract } from "./AgentPlanContractRefresh";

import type {
  AgentPlanAcceptance,
  AgentPlanContract,
} from "@/definition/AgentPlanSession";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { AgentRunReach } from "@/definition/McpAuthorization";
import type { AgentPlanTicketStates } from "./AgentPlanAcceptance";
import type {
  AgentPlanTasks,
  AgentPlanTicketChecklist,
} from "./AgentPlanTasks";

/** The frozen prompt contract and the effective Pages permissions of one turn. */
export interface AgentPlanSessionTerms {
  readonly contract: AgentPlanContract;
  readonly instruction: string;
  readonly reach: AgentRunReach;
}

interface AssessmentScope {
  readonly userId: string;
  readonly projectId: string;
  readonly provider: AgentProviderId;
}

/** Reconciles the closing report with live ticket checklists, separately from process cleanup. */
export class AgentPlanStepAssessment {
  private readonly tasks: Pick<AgentPlanTasks, "checklist">;

  public constructor(tasks: Pick<AgentPlanTasks, "checklist">) {
    this.tasks = tasks;
  }

  /** Preserves report IDs for unchanged requirements and never infers business success from ACP completion. */
  public async assess(
    terms: AgentPlanSessionTerms,
    output: string,
    scope: AssessmentScope,
  ): Promise<{
    readonly acceptance: AgentPlanAcceptance;
    readonly contract: AgentPlanContract;
  }> {
    const tickets = await Promise.all(
      terms.contract.tickets.map((ticket) =>
        this.tasks.checklist(scope.userId, scope.projectId, ticket.id),
      ),
    );
    const states = {
      ...this.ticketStates(terms, tickets),
      canReportTicketTodos:
        scope.provider === "opencode" && terms.reach === "read",
    };
    const contract = refreshPlanContract(
      terms.instruction,
      terms.contract,
      tickets,
      { isReadOnly: terms.reach === "read" },
    );
    const evaluate =
      contract.completion === "todos"
        ? evaluateTodoCompletion
        : evaluatePlanAcceptance;
    return { acceptance: evaluate(contract, output, states), contract };
  }

  private ticketStates(
    terms: AgentPlanSessionTerms,
    tickets: readonly AgentPlanTicketChecklist[],
  ): AgentPlanTicketStates {
    const checked = new Map<string, boolean>();
    const changed: string[] = [];
    for (const current of tickets) {
      const start = terms.contract.tickets.find(
        (ticket) => ticket.id === current.id,
      );
      if (
        start?.requirementsHash !== undefined &&
        current.checklist.requirementsHash !== start.requirementsHash
      )
        changed.push(current.key);
      for (const item of current.checklist.items)
        checked.set(`${current.id}\n${item.id}`, item.checked);
    }
    return {
      checked,
      unreadable: [],
      changed,
      isCheckRequired: terms.reach !== "read",
    };
  }
}
