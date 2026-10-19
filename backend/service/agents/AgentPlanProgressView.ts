import { sanitizePlanOutput } from "./AgentPlanOutput";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanProgressItem } from "@/definition/AgentPlanProgress";
import type {
  AgentPlanTasks,
  AgentPlanTicketChecklist,
} from "./AgentPlanTasks";

function contractItems(
  step: AgentPlanStepResult,
): readonly AgentPlanProgressItem[] {
  const record = step.session;
  return (record?.contract?.todos ?? []).map((item) => ({
    id: item.ticket ? `${item.ticket.id}:${item.ticket.itemId}` : item.id,
    text: sanitizePlanOutput(item.text),
    status:
      record?.acceptance?.todos.find((entry) => entry.id === item.id)?.status ??
      "unreported",
  }));
}

async function liveItems(
  step: AgentPlanStepResult,
  readTicket: (id: string) => Promise<AgentPlanTicketChecklist>,
): Promise<readonly AgentPlanProgressItem[]> {
  const contract = step.session?.contract;
  if (!contract) return [];
  const unbound = contractItems(step).filter((item) =>
    contract.todos.some(
      (entry) => entry.ticket === null && entry.id === item.id,
    ),
  );
  const tickets = await Promise.all(
    contract.tickets.map((ticket) => readTicket(ticket.id)),
  );
  return [
    ...unbound,
    ...tickets.flatMap((ticket) =>
      ticket.checklist.items
        .filter((item) => item.source === "description")
        .map((item): AgentPlanProgressItem => ({
          id: `${ticket.id}:${item.id}`,
          text: sanitizePlanOutput(item.text),
          status: item.checked ? "done" : "open",
        })),
    ),
  ];
}

/** Projects authorized live checkboxes separately from the runner's historical acceptance. */
export async function withPlanProgress(
  run: AgentPlanRun,
  context: {
    readonly projectId: string;
    readonly tasks: Pick<AgentPlanTasks, "checklist">;
  },
): Promise<AgentPlanRun> {
  const tickets = new Map<string, Promise<AgentPlanTicketChecklist>>();
  function readTicket(id: string): Promise<AgentPlanTicketChecklist> {
    const existing = tickets.get(id);
    if (existing) return existing;
    const pending = context.tasks.checklist(run.userId, context.projectId, id);
    tickets.set(id, pending);
    return pending;
  }
  const observedAt = new Date().toISOString();
  const steps = await Promise.all(
    run.steps.map(async (step): Promise<AgentPlanStepResult> => {
      if (!step.session?.contract) return step;
      const isLive =
        ["running", "pausing", "paused", "stopping"].includes(run.status) &&
        (step.status === "running" || step.status === "paused");
      return {
        ...step,
        progress: {
          source: isLive ? "live" : "historical",
          observedAt,
          todos: isLive
            ? await liveItems(step, readTicket)
            : contractItems(step),
        },
      };
    }),
  );
  return { ...run, steps };
}
