import type { AutomationEventType } from "@/definition/Automation";

/** A named record of an event. */
interface NamedReference {
  readonly id: string;
  readonly name: string | null;
}

/** The data of a plan event as the action receives it. */
export interface AutomationPlanEventData {
  readonly event: AutomationEventType;
  readonly at: string;
  readonly plan: NamedReference;
  readonly run: { readonly id: string; readonly status: string };
  readonly step: (NamedReference & { readonly status: string }) | null;
  readonly error: string | null;
}

/** The data of a ticket event as the action receives it. */
export interface AutomationTicketEventData {
  readonly event: AutomationEventType;
  readonly at: string;
  readonly ticket: {
    readonly id: string;
    readonly key: string;
    readonly title: string;
  };
  readonly project: NamedReference;
  readonly status: NamedReference;
  readonly previousStatus: NamedReference | null;
}

const EXAMPLE_TIME = "2026-11-10T13:05:53.000Z";
const EXAMPLE_PLAN: NamedReference = { id: "plan-id", name: "Pages Test" };
const EXAMPLE_RUN = { id: "run-id", status: "running" };

function planExample(
  event: AutomationEventType,
  overrides: Partial<AutomationPlanEventData>,
): AutomationPlanEventData {
  return {
    event,
    at: EXAMPLE_TIME,
    plan: EXAMPLE_PLAN,
    run: EXAMPLE_RUN,
    step: null,
    error: null,
    ...overrides,
  };
}

function ticketExample(
  event: AutomationEventType,
  status: NamedReference,
  previousStatus: NamedReference | null,
): AutomationTicketEventData {
  return {
    event,
    at: EXAMPLE_TIME,
    ticket: { id: "ticket-id", key: "PAGE-289", title: "Release-Notizen" },
    project: { id: "project-id", name: "Pages" },
    status,
    previousStatus,
  };
}

/** An example of the data every event type hands to its action, for the detail view and the options. */
export const AUTOMATION_EVENT_EXAMPLES: Readonly<
  Record<
    AutomationEventType,
    AutomationPlanEventData | AutomationTicketEventData
  >
> = {
  "plan.started": planExample("plan.started", {}),
  "plan.succeeded": planExample("plan.succeeded", {
    run: { id: "run-id", status: "succeeded" },
  }),
  "plan.failed": planExample("plan.failed", {
    run: { id: "run-id", status: "failed" },
    step: { id: "step-id", name: "Merge prüfen und messen", status: "failed" },
    error: "plan_interrupted",
  }),
  "plan.step_changed": planExample("plan.step_changed", {
    step: { id: "step-id", name: "Merge prüfen und messen", status: "running" },
  }),
  "ticket.created": ticketExample(
    "ticket.created",
    { id: "status-todo", name: "To Do" },
    null,
  ),
  "ticket.status_changed": ticketExample(
    "ticket.status_changed",
    { id: "status-done", name: "Done" },
    { id: "status-review", name: "Review" },
  ),
};
