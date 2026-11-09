import { logCaughtError } from "@/backend/logging/Logger";

import { sanitizePlanOutput } from "./AgentPlanOutput";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentPlanProgress,
  AgentPlanProgressItem,
} from "@/definition/AgentPlanProgress";
import type { AgentChecklistItem } from "@/definition/AgentTicketChecklist";
import type { AgentPlanStepLiveProgress } from "@/definition/AgentPlanStepProgress";
import type {
  AgentPlanTasks,
  AgentPlanTicketChecklist,
} from "./AgentPlanTasks";

/** The live state of a contract todo, reported in the current or an earlier attempt of the run. */
function liveStatus(
  live: AgentPlanStepLiveProgress | undefined,
  contractId: string | undefined,
): AgentPlanProgressItem["status"] | null {
  return live?.todos.find((todo) => todo.id === contractId)?.status ?? null;
}

function contractItems(
  step: AgentPlanStepResult,
  live?: AgentPlanStepLiveProgress,
): readonly AgentPlanProgressItem[] {
  return (step.session?.contract?.todos ?? []).map((item) => ({
    id: item.ticket ? `${item.ticket.id}:${item.ticket.itemId}` : item.id,
    contractId: item.id,
    text: sanitizePlanOutput(item.text),
    ...(item.ticket ? { ticket: item.ticket } : {}),
    status: contractStatus(
      step.session?.acceptance?.todos.find((entry) => entry.id === item.id)
        ?.status,
      liveStatus(live, item.id),
    ),
  }));
}

/** A reported acceptance decides; a todo the report left out shows what the agent reported live. */
function contractStatus(
  accepted: AgentPlanProgressItem["status"] | undefined,
  live: AgentPlanProgressItem["status"] | null,
): AgentPlanProgressItem["status"] {
  if (accepted === "done" || accepted === "open") return accepted;
  return live ?? accepted ?? "unreported";
}

/** The contract ID under which the agent reports a ticket entry, such as `T3`. */
function contractIdOf(
  step: AgentPlanStepResult,
  ticketId: string,
  itemId: string,
): string | undefined {
  return step.session?.contract?.todos.find(
    (todo) => todo.ticket?.id === ticketId && todo.ticket.itemId === itemId,
  )?.id;
}

function progressTicketIds(
  step: AgentPlanStepResult,
  bindings: Readonly<Record<string, readonly string[]>> | undefined,
): readonly string[] {
  return (
    bindings?.[step.id] ??
    step.session?.contract?.tickets.map((ticket) => ticket.id) ??
    []
  );
}

function observedStatus(
  step: AgentPlanStepResult,
  ticket: AgentPlanTicketChecklist,
  item: AgentChecklistItem,
  live?: AgentPlanStepLiveProgress,
): AgentPlanProgressItem["status"] {
  if (item.checked) return "done";
  const reported = liveStatus(live, contractIdOf(step, ticket.id, item.id));
  if (reported) return reported;
  const activity = step.session?.activity;
  const startedAt = step.session?.startedAt;
  const isCurrent =
    step.status === "running" &&
    activity &&
    startedAt &&
    Date.parse(activity.reportedAt) >= Date.parse(startedAt);
  // A title alone cannot identify ticket work. The agent must explicitly name its stable entry ID.
  const marker = `${ticket.key}#${item.id}`;
  return isCurrent &&
    activity.titles.some(
      (title) => title === marker || title.startsWith(`${marker} `),
    )
    ? "active"
    : "open";
}

async function liveProgress(
  step: AgentPlanStepResult,
  ticketIds: readonly string[],
  readTicket: (id: string) => Promise<AgentPlanTicketChecklist>,
  live?: AgentPlanStepLiveProgress,
): Promise<Pick<AgentPlanProgress, "todos" | "tickets" | "availability">> {
  try {
    const tickets = await Promise.all([...new Set(ticketIds)].map(readTicket));
    return {
      availability: "observed",
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        key: ticket.key,
        contentHash: ticket.checklist.contentHash,
      })),
      todos: [
        ...contractItems(step, live).filter((item) => !item.ticket),
        ...tickets.flatMap((ticket) =>
          ticket.checklist.items.map((item) => {
            const contractId = contractIdOf(step, ticket.id, item.id);
            return {
              id: `${ticket.id}:${item.id}`,
              ...(contractId ? { contractId } : {}),
              text: sanitizePlanOutput(item.text),
              ticket: { id: ticket.id, key: ticket.key, itemId: item.id },
              status: observedStatus(step, ticket, item, live),
            };
          }),
        ),
      ],
    };
  } catch (error: unknown) {
    logCaughtError("AgentPlanProgressView", error);
    return {
      availability: "unavailable",
      todos: contractItems(step, live).map((item) => ({
        ...item,
        status: "missing",
      })),
    };
  }
}

/** The activity the agent reported live, sanitized; nothing without one. */
function liveActivity(
  live: AgentPlanStepLiveProgress | undefined,
): Pick<AgentPlanProgress, "activity"> {
  return live?.activity
    ? {
        activity: {
          text: sanitizePlanOutput(live.activity),
          reportedAt: live.updatedAt,
        },
      }
    : {};
}

/** Projects current authorized ticket checkboxes without altering execution or historical acceptance. */
export async function withPlanProgress(
  run: AgentPlanRun,
  context: {
    readonly projectId: string;
    readonly tasks: Pick<AgentPlanTasks, "checklist">;
    /** Per-node ticket bindings from the run's private snapshot, including remote nodes. */
    readonly stepTickets?: Readonly<Record<string, readonly string[]>>;
    /** What `update_step_progress` reported, by step (PAGE-284). */
    readonly live?: ReadonlyMap<string, AgentPlanStepLiveProgress>;
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
      const contract = step.session?.contract;
      const ticketIds = progressTicketIds(step, context.stepTickets);
      if (!contract && ticketIds.length === 0) return step;
      const isLive =
        ["running", "pausing", "paused", "stopping"].includes(run.status) &&
        (step.status === "running" || step.status === "paused");
      const readsTicket = isLive || ticketIds.length > 0;
      const live = context.live?.get(step.id);
      const projection = readsTicket
        ? await liveProgress(step, ticketIds, readTicket, live)
        : { todos: contractItems(step, live) };
      return {
        ...step,
        progress: {
          source: readsTicket ? "live" : "historical",
          observedAt,
          scope: {
            runId: run.id,
            stepId: step.id,
            attemptId:
              step.session?.attemptId ?? step.execution?.attemptId ?? null,
          },
          ...projection,
          ...liveActivity(live),
        },
      };
    }),
  );
  return { ...run, steps };
}
