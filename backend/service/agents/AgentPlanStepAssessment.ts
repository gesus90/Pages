import {
  evaluatePlanAcceptance,
  evaluateTodoCompletion,
} from "./AgentPlanAcceptance";
import { refreshPlanContract } from "./AgentPlanContractRefresh";

import type {
  AgentPlanAcceptance,
  AgentPlanContract,
} from "@/definition/AgentPlanSession";
import type { AgentPlanStepProgressService } from "./AgentPlanStepProgressService";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { AgentPlanStepReport } from "@/definition/AgentPlanStepReport";
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
  readonly progress?: {
    readonly runId: string;
    readonly stepId: string;
    readonly attemptId: string;
  };
  readonly userId: string;
  readonly projectId: string;
  readonly provider: AgentProviderId;
}

/** Reconciles the closing report with live ticket checklists, separately from process cleanup. */
export class AgentPlanStepAssessment {
  private readonly tasks: Pick<AgentPlanTasks, "checklist">;
  private readonly progress:
    Pick<AgentPlanStepProgressService, "current"> | undefined;

  public constructor(
    tasks: Pick<AgentPlanTasks, "checklist">,
    progress?: Pick<AgentPlanStepProgressService, "current">,
  ) {
    this.tasks = tasks;
    this.progress = progress;
  }

  /** Preserves report IDs for unchanged requirements and never infers business success from ACP completion. */
  public async assess(
    terms: AgentPlanSessionTerms,
    output: string,
    scope: AssessmentScope,
    stepReport: AgentPlanStepReport | null = null,
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
      canReportTicketTodos: terms.reach === "read",
    };
    const current = scope.progress
      ? await this.progress?.current(
          {
            ...scope.progress,
            requiresNativePlan: scope.provider === "codex_cli",
          },
          terms.contract,
        )
      : undefined;
    const contract = refreshPlanContract(
      terms.instruction,
      current ?? terms.contract,
      tickets,
      { isReadOnly: terms.reach === "read" },
    );
    const evaluate =
      contract.completion === "todos"
        ? evaluateTodoCompletion
        : evaluatePlanAcceptance;
    const acceptance = evaluate(contract, output, states, stepReport);
    return {
      acceptance: enforceNativePlanAcceptance(acceptance, contract),
      contract,
    };
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

/** The native plan obligation is proved by ACP, never by an agent's claim that it is done. */
function enforceNativePlanAcceptance(
  acceptance: AgentPlanAcceptance,
  contract: AgentPlanContract,
): AgentPlanAcceptance {
  if (!contract.todos.some((todo) => todo.id === "PAGES_PLAN"))
    return acceptance;
  const hasObligation = acceptance.todos.some(
    (todo) => todo.id === "PAGES_PLAN",
  );
  return {
    ...acceptance,
    verdict: acceptance.verdict === "accepted" ? "open" : acceptance.verdict,
    todos: [
      ...acceptance.todos.map((todo) =>
        todo.id === "PAGES_PLAN" ? { ...todo, status: "open" as const } : todo,
      ),
      ...(hasObligation ? [] : [{ id: "PAGES_PLAN", status: "open" as const }]),
    ],
    issues: [
      ...acceptance.issues.filter((issue) => !issue.endsWith(":PAGES_PLAN")),
      "todo_open:PAGES_PLAN",
    ],
  };
}
