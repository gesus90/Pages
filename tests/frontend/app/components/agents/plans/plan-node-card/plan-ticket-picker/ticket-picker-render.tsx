import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { vi } from "vitest";

import { PlanTicketPicker } from "@/app/components/agents/plans/plan-node-card/plan-ticket-picker";

import { flowContext, i18n, renderInFlow } from "../../plan-flow-fixture";
import { PHASES, ticket } from "./ticket-picker-fixture";

import type { RenderResult } from "@testing-library/react";
import type { PlanTicketRefresh } from "@/app/components/agents/plans/use-plan-ticket-refresh";
import type { AgentPlanPhase, AgentPlanTask } from "@/definition/AgentPlan";

/** Three open, ongoing and finished tickets, the newest change first. */
export const TICKETS: readonly AgentPlanTask[] = [
  ticket("1", { title: "Open work", updatedAt: "2026-01-03 08:00:00" }),
  ticket("2", {
    title: "Ongoing work",
    statusKey: "in_progress",
    statusName: "In Progress",
    updatedAt: "2026-01-02 08:00:00",
  }),
  ticket("3", {
    title: "Finished work",
    statusKey: "done",
    statusName: "Done",
    isDone: true,
    updatedAt: "2026-01-01 08:00:00",
  }),
];

/** How a ticket choice is rendered: its tickets, phases, refresh and the node's ticket. */
export interface PickerSetup {
  readonly tasks?: readonly AgentPlanTask[];
  /** Absent phases leave the sources without a phase list. */
  readonly phases?: readonly AgentPlanPhase[] | null;
  readonly tickets?: PlanTicketRefresh;
  readonly taskId?: string;
  readonly disabled?: boolean;
}

/** The rendered choice, the spy of each chosen ticket and the spy of events that reach the card. */
export interface RenderedPicker extends RenderResult {
  readonly onSelect: ReturnType<typeof vi.fn>;
  readonly onCardEvent: ReturnType<typeof vi.fn>;
}

function Picker(props: {
  readonly initialTaskId: string;
  readonly disabled: boolean;
  readonly onSelect: (taskId: string) => void;
  readonly onCardEvent: () => void;
}): React.ReactElement {
  const [taskId, setTaskId] = useState(props.initialTaskId);
  function select(next: string): void {
    setTaskId(next);
    props.onSelect(next);
  }
  // The card around the field selects, drags and zooms on these events.
  return (
    <article
      aria-label="Ticket card"
      onPointerDown={props.onCardEvent}
      onClick={props.onCardEvent}
      onDoubleClick={props.onCardEvent}
      onWheel={props.onCardEvent}
      onKeyDown={props.onCardEvent}
    >
      <PlanTicketPicker
        taskId={taskId}
        label="Ticket choice"
        disabled={props.disabled}
        onSelect={select}
      />
    </article>
  );
}

/** Renders a ticket field on a canvas whose sources hold the given tickets. */
export function renderPicker(setup: PickerSetup = {}): RenderedPicker {
  const onSelect = vi.fn();
  const onCardEvent = vi.fn();
  const phases = setup.phases === undefined ? PHASES : setup.phases;
  const rendered = renderInFlow(
    <Picker
      initialTaskId={setup.taskId ?? ""}
      disabled={setup.disabled ?? false}
      onSelect={onSelect}
      onCardEvent={onCardEvent}
    />,
    flowContext({
      sources: {
        agents: [],
        tasks: setup.tasks ?? TICKETS,
        ...(phases === null ? {} : { phases }),
      },
      tickets: setup.tickets,
    }),
  );
  return { ...rendered, onSelect, onCardEvent };
}

/** The ticket field on the card. */
export function field(): HTMLElement {
  return screen.getByRole("combobox", { name: "Ticket choice" });
}

/** Opens the choice with a click on its field and returns the panel. */
export function openPicker(): HTMLElement {
  fireEvent.click(field());
  return screen.getByRole("dialog", {
    name: i18n.t("plans.ticketPicker.dialog"),
  });
}

/** The search field of the open choice. */
export function searchField(): HTMLElement {
  return screen.getByRole("combobox", {
    name: i18n.t("plans.ticketPicker.searchLabel"),
  });
}

/**
 * The panel of the open choice, or `null` while it is closed.
 *
 * @remarks
 * An open filter menu hides the rest of the page from assistive technology;
 * the panel still counts as open then.
 */
export function queryPanel(): HTMLElement | null {
  // Hidden elements have no accessible name, so the label is compared directly.
  const label = i18n.t("plans.ticketPicker.dialog");
  return (
    screen
      .queryAllByRole("dialog", { hidden: true })
      .find((dialog) => dialog.getAttribute("aria-label") === label) ?? null
  );
}
