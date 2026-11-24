import {
  evaluatePlanAcceptance,
  evaluateTodoCompletion,
} from "./AgentPlanAcceptance";
import { buildPlanContract } from "./AgentPlanContract";

import type {
  AgentPlanAcceptance,
  AgentPlanContract,
  AgentPlanContractItem,
} from "@/definition/AgentPlanSession";
import type { AgentPlanStepProgressService } from "./AgentPlanStepProgressService";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { AgentPlanStepReport } from "@/definition/AgentPlanStepReport";
import type { AgentRunReach } from "@/definition/McpAuthorization";
import type { AgentPlanTicketStates } from "./AgentPlanAcceptance";
import type { AgentPlanContractOptions } from "./AgentPlanContract";
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
  /** A report through Pages MCP, or the closing turn of an Antigravity session with Pages MCP; both contracts ask for an own work list. */
  readonly requiresWorkList?: boolean;
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
            checksNativePlan: scope.provider === "codex_cli",
            requiresWorkList: scope.requiresWorkList,
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

function sameRequirement(
  current: AgentPlanContractItem,
  previous: AgentPlanContractItem,
): boolean {
  if (current.text !== previous.text) return false;
  if (current.ticket === null)
    return previous.ticket === null && current.id === previous.id;
  return (
    previous.ticket?.id === current.ticket.id &&
    previous.ticket.itemId === current.ticket.itemId
  );
}

function reconcileItems(
  current: readonly AgentPlanContractItem[],
  previous: readonly AgentPlanContractItem[],
  prefix: string,
): readonly AgentPlanContractItem[] {
  let nextId = Math.max(
    0,
    ...previous.map((item) => Number(item.id.slice(prefix.length)) || 0),
  );
  return current.map((item) => {
    const original = previous.find((entry) => sameRequirement(item, entry));
    return {
      ...item,
      id: original?.id ?? `${prefix}${++nextId}`,
      ...(!item.ticket && original?.checked ? { checked: true } : {}),
    };
  });
}

function refreshPlanContract(
  instruction: string,
  previous: AgentPlanContract,
  tickets: readonly AgentPlanTicketChecklist[],
  options: Pick<AgentPlanContractOptions, "isReadOnly">,
): AgentPlanContract {
  const current = buildPlanContract(instruction, tickets, {
    ...options,
    completion: previous.completion,
    completionGate: previous.completionGate,
  });
  return {
    ...current,
    todos: [
      ...reconcileItems(current.todos, previous.todos, "T"),
      ...previous.todos.filter((todo) => todo.agent),
    ],
    criteria: reconcileItems(current.criteria, previous.criteria, "K"),
  };
}
