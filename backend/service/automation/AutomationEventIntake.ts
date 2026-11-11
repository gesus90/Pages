import { randomUUID } from "node:crypto";

import { z } from "zod";

import { AutomationEventRepository } from "@/backend/database/repositories/automation/AutomationEventRepository";
import { AutomationRepository } from "@/backend/database/repositories/automation/AutomationRepository";
import { AutomationRunRepository } from "@/backend/database/repositories/automation/AutomationRunRepository";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import type { Database } from "@/backend/database/Database";
import type { StoredAutomationEvent } from "@/backend/database/repositories/automation/AutomationEventRepository";
import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type { AutomationEventTrigger } from "@/definition/Automation";
import type { AutomationAccess } from "./AutomationAccess";
import type {
  AutomationPlanEventData,
  AutomationTicketEventData,
} from "./AutomationEventData";

/** Events read per pass. */
const BATCH = 100;
/** Event runs one automation may start per hour; more are dropped, so no loop runs forever. */
const EVENT_RUNS_PER_HOUR = 60;
const HOUR_MILLISECONDS = 60 * 60 * 1000;

/** Names of the projects and statuses of ticket events. */
export interface AutomationEventLookups {
  readonly projectName: (projectId: string) => Promise<string | null>;
  readonly statusNames: () => Promise<ReadonlyMap<string, string>>;
}

/** What the intake is built from. */
export interface AutomationEventIntakeDependencies {
  readonly database: Pick<Database, "query" | "execute" | "transaction">;
  readonly rules: AutomationAccess;
  readonly lookups: AutomationEventLookups;
  readonly now: () => Date;
}

const ticketPayloadSchema = z.object({
  ticketId: z.string(),
  ticketKey: z.string(),
  title: z.string(),
  projectId: z.string(),
  statusId: z.string(),
  previousStatusId: z.string().nullable(),
});

const planPayloadSchema = z.object({
  event: z.string(),
  at: z.string(),
  plan: z.object({ id: z.string(), name: z.string().nullable() }),
  run: z.object({ id: z.string(), status: z.string() }),
  step: z
    .object({ id: z.string(), name: z.string().nullable(), status: z.string() })
    .nullable(),
  error: z.string().nullable(),
});

/** An event read from the inbox, with the data its actions receive. */
type IntakeEvent =
  | {
      readonly kind: "plan";
      readonly stored: StoredAutomationEvent;
      readonly data: AutomationPlanEventData;
    }
  | {
      readonly kind: "ticket";
      readonly stored: StoredAutomationEvent;
      readonly data: AutomationTicketEventData;
    };

function matchesPlan(
  trigger: AutomationEventTrigger,
  event: AutomationPlanEventData,
): boolean {
  if (trigger.planId && trigger.planId !== event.plan.id) return false;
  return !trigger.stepId || trigger.stepId === event.step?.id;
}

function matchesTicket(
  trigger: AutomationEventTrigger,
  event: AutomationTicketEventData,
): boolean {
  if (trigger.projectId !== event.project.id) return false;
  return !trigger.statusId || trigger.statusId === event.status.id;
}

/**
 * Turns the events of plans and tickets into runs of the automations that
 * wait for them (PAGE-297).
 *
 * @remarks
 * An event reaches an automation only when its creator may see the plan or
 * project. It never starts the automation that caused it: a plan run that
 * the automation started, or a ticket its own agent created while it runs.
 * At most sixty event runs per automation and hour start; with the rule of
 * one running and one waiting run, no event can trigger an automation
 * endlessly.
 */
export class AutomationEventIntake {
  private readonly dependencies: AutomationEventIntakeDependencies;

  public constructor(dependencies: AutomationEventIntakeDependencies) {
    this.dependencies = dependencies;
  }

  /** Processes the waiting events in their order and removes them. */
  public async process(): Promise<void> {
    const inbox = new AutomationEventRepository(this.dependencies.database);
    const events = await inbox.next(BATCH);
    const last = events.at(-1);
    if (!last) return;
    const waiting = new Map<string, readonly StoredAutomation[]>();
    for (const stored of events) {
      try {
        const event = await this.read(stored);
        if (!event) continue;
        let automations = waiting.get(stored.eventType);
        if (!automations) {
          automations = await new AutomationRepository(
            this.dependencies.database,
          ).waitingFor(stored.eventType);
          waiting.set(stored.eventType, automations);
        }
        for (const automation of automations)
          await this.offer(automation, event);
      } catch (error: unknown) {
        logCaughtError("AutomationEventIntake", error);
      }
    }
    await inbox.remove(last.sequence);
  }

  private async read(
    stored: StoredAutomationEvent,
  ): Promise<IntakeEvent | null> {
    const parsed: unknown = JSON.parse(stored.payload);
    if (stored.eventType.startsWith("plan.")) {
      const plan = planPayloadSchema.safeParse(parsed);
      return plan.success
        ? {
            kind: "plan",
            stored,
            data: { ...plan.data, event: stored.eventType },
          }
        : null;
    }
    const ticket = ticketPayloadSchema.safeParse(parsed);
    if (!ticket.success) return null;
    const { lookups } = this.dependencies;
    const [projectName, statuses] = await Promise.all([
      lookups.projectName(ticket.data.projectId),
      lookups.statusNames(),
    ]);
    const previous = ticket.data.previousStatusId;
    return {
      kind: "ticket",
      stored,
      data: {
        event: stored.eventType,
        at: stored.occurredAt,
        ticket: {
          id: ticket.data.ticketId,
          key: ticket.data.ticketKey,
          title: ticket.data.title,
        },
        project: { id: ticket.data.projectId, name: projectName },
        status: {
          id: ticket.data.statusId,
          name: statuses.get(ticket.data.statusId) ?? null,
        },
        previousStatus: previous
          ? { id: previous, name: statuses.get(previous) ?? null }
          : null,
      },
    };
  }

  private async offer(
    automation: StoredAutomation,
    event: IntakeEvent,
  ): Promise<void> {
    const { trigger } = automation;
    if (trigger.type !== "event") return;
    const { rules, database, now } = this.dependencies;
    const runs = new AutomationRunRepository(database);
    if (event.kind === "plan") {
      if (!matchesPlan(trigger, event.data)) return;
      if (await runs.startedPlanRun(automation.id, event.data.run.id)) return;
      if (
        !(await this.safely(() =>
          rules.canSeePlan(event.data.plan.id, automation.creatorId),
        ))
      )
        return;
    } else {
      if (!matchesTicket(trigger, event.data)) return;
      if (await this.isOwnTicket(automation, event)) return;
      if (
        !(await this.safely(() =>
          rules.canSeeProject(event.data.project.id, automation.creatorId),
        ))
      )
        return;
    }
    const since = new Date(now().getTime() - HOUR_MILLISECONDS).toISOString();
    if (
      (await runs.countEventRunsSince(automation.id, since)) >=
      EVENT_RUNS_PER_HOUR
    ) {
      logEvent({
        level: "warn",
        event: "automation.event.limited",
        component: "AutomationEventIntake",
        message: "An automation reached its limit of event runs per hour",
        metadata: { automationId: automation.id },
      });
      return;
    }
    await runs.enqueue({
      id: randomUUID(),
      automationId: automation.id,
      triggerKind: "event",
      eventType: event.stored.eventType,
      triggerSubject:
        event.kind === "plan" ? event.data.plan.name : event.data.ticket.key,
      triggerData: JSON.stringify(event.data),
      requestedBy: null,
      queuedAt: now().toISOString(),
    });
  }

  /** A ticket the automation's own agent created while one of its runs runs. */
  private async isOwnTicket(
    automation: StoredAutomation,
    event: IntakeEvent,
  ): Promise<boolean> {
    const actorId = event.stored.actorId;
    if (!actorId) return false;
    const { action } = automation;
    const agents = [
      action.type === "agent" ? action.agentId : null,
      action.type === "script" ? (action.forward?.agentId ?? null) : null,
    ];
    if (!agents.includes(actorId)) return false;
    const blocking = await new AutomationRunRepository(
      this.dependencies.database,
    ).blocking(automation.id);
    return blocking !== null && blocking.status !== "queued";
  }

  private async safely(check: () => Promise<boolean>): Promise<boolean> {
    try {
      return await check();
    } catch {
      return false;
    }
  }
}
