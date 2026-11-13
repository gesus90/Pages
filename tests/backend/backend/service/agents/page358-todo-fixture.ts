import { vi } from "vitest";

import { AgentPlanStepProgressService } from "@/backend/service/agents/AgentPlanStepProgressService";
import { buildPlanContract } from "@/backend/service/agents/AgentPlanContract";
import { readTodoState } from "@/backend/service/agents/AgentPlanTodoState";

import { progressTicket } from "./page162-progress-fixture";

import type { WorkItemChecklistItem } from "@/definition/Task";
import type { AgentPlanContract } from "@/definition/AgentPlanSession";
import type { AgentPlanTicketChecklist } from "@/backend/service/agents/AgentPlanTasks";
import type { AgentPlanTodoState } from "@/backend/service/agents/AgentPlanTodoState";
import type { AgentTicketChecklistService } from "@/backend/service/agents/AgentTicketChecklistService";
import type { StoredPlanStepProgress } from "@/backend/database/repositories/agent/AgentPlanStepProgressRepository";
import type { StoredPlanStepReport } from "@/backend/database/repositories/agent/AgentPlanStepReportRepository";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { AgentPlanAgentTodo } from "@/definition/AgentPlanAgentTodos";

/** A private session credential; database, ticket writes and native plans are stubbed. */
export const TODO_IDENTITY: AgentIdentity = {
  userId: "executor",
  isAdmin: false,
  permissions: [],
  run: {
    runId: "run",
    stepId: "agent",
    reach: "full",
    tickets: [],
    operations: [],
  },
};

interface TodoFixture {
  readonly contract: AgentPlanContract;
  readonly instruction: string;
  readonly progress: AgentPlanStepProgressService;
  readonly slot: StoredPlanStepReport;
  readonly rows: Map<string, StoredPlanStepProgress>;
  readonly native: Map<string, readonly AgentPlanAgentTodo[]>;
  readonly writes: ReturnType<typeof vi.fn<AgentTicketChecklistService["set"]>>;
  readonly ticket: () => AgentPlanTicketChecklist;
  readonly state: () => AgentPlanTodoState;
}

/** In-memory external boundaries around the production TODO service. */
export function todoFixture(
  instruction = "- [ ] Local work",
  markdown = "",
  criteria: readonly WorkItemChecklistItem[] = [],
): TodoFixture {
  const rows = new Map<string, StoredPlanStepProgress>();
  let ticket = progressTicket(markdown, "ticket", criteria);
  const contract = buildPlanContract(
    instruction,
    markdown || criteria.length ? [ticket] : [],
    { isReadOnly: false, completion: "todos" },
  );
  const slot: StoredPlanStepReport = {
    runId: "run",
    stepId: "agent",
    sessionScopeId: "agent",
    attemptId: "attempt",
    termsJson: JSON.stringify({
      contract,
      reach: "full",
      instruction,
      projectId: "project",
      provider: "codex_cli",
    }),
    reportJson: null,
  };
  const native = new Map<string, readonly AgentPlanAgentTodo[]>();
  const writes = vi.fn<AgentTicketChecklistService["set"]>(
    async (_identity: AgentIdentity, input: unknown) => {
      if (typeof input !== "object" || input === null || !("itemId" in input))
        throw new Error("Invalid write");
      ticket = {
        ...ticket,
        checklist: {
          ...ticket.checklist,
          items: ticket.checklist.items.map((item) => ({
            ...item,
            checked: item.checked || item.id === input.itemId,
          })),
        },
      };
      return {
        apiVersion: "1" as const,
        result: {
          ticketId: ticket.id,
          key: ticket.key,
          itemId: String(input.itemId),
          checked: true,
          changed: true,
          revision: "8",
        },
      };
    },
  );
  const progress = new AgentPlanStepProgressService({
    reports: { find: vi.fn(async () => slot) },
    progress: {
      find: vi.fn(
        async (runId, stepId) => rows.get(`${runId}/${stepId}`) ?? null,
      ),
      save: vi.fn(async (row) => {
        rows.set(`${row.runId}/${row.stepId}`, row);
      }),
      listForRun: vi.fn(async () => [...rows.values()]),
    },
    tickets: {
      read: vi.fn(async () => ({
        apiVersion: "1" as const,
        result: {
          ticketId: ticket.id,
          key: ticket.key,
          link: `/tasks/${ticket.key}`,
          revision: "7",
          items: ticket.checklist.items,
        },
      })),
      set: writes,
    },
    agentTodos: {
      findEntries: vi.fn(async (attemptId) => native.get(attemptId) ?? []),
    },
  });
  return {
    contract,
    instruction,
    progress,
    slot,
    rows,
    native,
    writes,
    ticket: () => ticket,
    state: () => readTodoState(rows.get("run/agent") ?? null),
  };
}
