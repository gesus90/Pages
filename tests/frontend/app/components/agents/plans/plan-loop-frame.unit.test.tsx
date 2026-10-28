import { fireEvent, render, screen, within } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { PlanFlowContext } from "@/app/components/agents/plans/plan-flow-context";
import { PlanLoopFrame } from "@/app/components/agents/plans/plan-loop-frame";
import { usePlanGraph } from "@/app/components/agents/plans/use-plan-graph";

import { i18n, SOURCES } from "../page61-plan-fixture";
import {
  findLoop,
  loopIteration,
  loopMember,
  loopPlan,
  loopRun,
  syntheticLoop,
} from "./plan-loop-fixture";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";

interface FrameOptions {
  readonly loop: AgentPlanLoop;
  readonly canEdit?: boolean;
  readonly isDropTarget?: boolean;
  readonly run?: AgentPlanRun | null;
  /** Replaces the findings of the draft, so a frame can be shown without any. */
  readonly issues?: readonly AgentPlanIssue[];
  readonly onEdit?: (id: string) => void;
}

function Frame(props: FrameOptions): React.ReactElement {
  const [draft, setDraft] = useState(() => loopPlan(props.loop));
  const actions = usePlanGraph(draft, setDraft, SOURCES);
  const graph = props.issues ? { ...actions, issues: props.issues } : actions;
  const canEdit = props.canEdit ?? true;
  const run = props.run ?? null;
  const loop = findLoop(draft);
  if (!loop) return <p>removed</p>;
  return (
    <PlanFlowContext
      value={{
        draft,
        sources: SOURCES,
        graph,
        canEdit,
        run,
        collapsedGroups: new Set<string>(),
        toggleGroup: vi.fn(),
        dropTarget: null,
        cancelConnection: vi.fn(),
        requestTemplate: vi.fn(),
      }}
    >
      <PlanLoopFrame
        loop={loop}
        draft={draft}
        sources={SOURCES}
        graph={graph}
        canEdit={canEdit}
        isDropTarget={props.isDropTarget ?? false}
        run={run}
        onEdit={props.onEdit}
      />
    </PlanFlowContext>
  );
}

function renderFrame(options: FrameOptions): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={i18n}>
      <ReactFlowProvider>
        <Frame {...options} />
      </ReactFlowProvider>
    </I18nextProvider>,
  );
}

function frame(name: string): HTMLElement {
  return screen.getByRole("region", {
    name: i18n.t("plans.loops.frame", { name }),
  });
}

function titleButton(name: string): HTMLElement {
  return screen.getByRole("button", {
    name: i18n.t("plans.selectNode", { name }),
  });
}

function footer(name: string): HTMLElement {
  const text = within(frame(name)).getByText(
    i18n.t("plans.loops.members", { count: 0 }),
    { exact: false },
  );
  const row = text.parentElement;
  if (!row) throw new Error("Missing loop footer");
  return row;
}

const MEMBERS = [
  loopMember("late", "writer", { x: 320, y: 0 }),
  loopMember("lower", "reviewer", { x: 0, y: 160 }),
  loopMember("upper", "ghost", { x: 0, y: 0 }),
];

it("names an unnamed empty loop by default, marks its repair need and invites members", () => {
  renderFrame({ loop: syntheticLoop({ name: "" }) });
  const name = i18n.t("plans.loops.defaultName");
  expect(frame(name).dataset.planLoop).toBe("loop");
  expect(
    screen.getByLabelText(i18n.t("plans.loops.needsRepair")),
  ).toBeDefined();
  expect(screen.getByText(i18n.t("plans.loops.empty"))).toBeDefined();
  expect(titleButton(name).className).toContain("cursor-grab");
  expect(footer(name).textContent).toBe(
    `${i18n.t("plans.loops.members", { count: 0 })}${i18n.t("plans.loops.session.reuseShort")}`,
  );
});

it("shows a read-only empty loop without an edit hint, grab cursor or delete menu", () => {
  renderFrame({
    loop: syntheticLoop({ sessionPolicy: "fresh" }),
    canEdit: false,
    issues: [],
  });
  expect(screen.getByText(i18n.t("plans.loops.emptyReadOnly"))).toBeDefined();
  expect(screen.queryByText(i18n.t("plans.loops.empty"))).toBeNull();
  expect(titleButton("Review loop").className).not.toContain("cursor-grab");
  expect(
    screen.getByRole("button", {
      name: i18n.t("settings.agents.actionsFor", { name: "Review loop" }),
    }),
  ).toHaveProperty("disabled", true);
  expect(
    screen.getByText(i18n.t("plans.loops.session.freshShort")),
  ).toBeDefined();
});

it("lists the members left to right and top to bottom and summarizes count and state", () => {
  renderFrame({ loop: syntheticLoop({ steps: MEMBERS }), issues: [] });
  const region = frame("Review loop");
  expect(
    within(region).queryByLabelText(i18n.t("plans.loops.needsRepair")),
  ).toBeNull();
  expect(within(region).queryByText(i18n.t("plans.loops.empty"))).toBeNull();
  const chain = `${i18n.t("plans.loops.members", { count: 3 })} · ghost → Reviewer → Writer`;
  expect(
    within(region).getByTitle("ghost → Reviewer → Writer").textContent,
  ).toBe(chain);
  const summary = within(region).getByText(
    i18n.t("plans.loops.summary", { mode: "max", count: 3 }),
  );
  expect(summary.title).toBe(i18n.t("plans.loops.mode.maxTooltip"));
  expect(
    within(region).getByText(i18n.t("plans.loops.status.notStarted")),
  ).toBeDefined();
});

it("selects the loop from its title and opens its settings from the pencil", () => {
  const onEdit = vi.fn();
  renderFrame({ loop: syntheticLoop(), issues: [], onEdit });
  expect(frame("Review loop").className).not.toContain("ring-info");
  fireEvent.click(titleButton("Review loop"));
  expect(frame("Review loop").className).toContain("ring-info");
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.editNamed", { name: "Review loop" }),
    }),
  );
  expect(onEdit).toHaveBeenCalledWith("loop");
});

it("selects the loop from the pencil even without a settings handler", () => {
  renderFrame({ loop: syntheticLoop({ countMode: "expected" }), issues: [] });
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.editNamed", { name: "Review loop" }),
    }),
  );
  expect(frame("Review loop").className).toContain("ring-info");
  expect(
    screen.getByText(i18n.t("plans.loops.summary", { mode: "exakt", count: 3 }))
      .title,
  ).toBe(i18n.t("plans.loops.mode.expectedTooltip"));
});

it("removes an empty loop from the draft through its menu", async () => {
  renderFrame({ loop: syntheticLoop(), issues: [] });
  fireEvent.keyDown(
    screen.getByRole("button", {
      name: i18n.t("settings.agents.actionsFor", { name: "Review loop" }),
    }),
    { key: "Enter" },
  );
  fireEvent.click(
    await screen.findByRole("menuitem", { name: i18n.t("plans.delete") }),
  );
  expect(screen.getByText("removed")).toBeDefined();
});

it("announces the drop target instead of the session note", () => {
  renderFrame({ loop: syntheticLoop(), issues: [], isDropTarget: true });
  expect(frame("Review loop").className).toContain("ring-plan-loop/40");
  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("plans.loops.dropHere"),
  );
  expect(
    screen.queryByText(i18n.t("plans.loops.session.reuseShort")),
  ).toBeNull();
});

it("shows the verdict of the latest iteration during a run", () => {
  const run = loopRun([
    loopIteration(1, {
      state: "evaluated",
      isMet: false,
      found: { type: "null" },
    }),
    loopIteration(2, {
      state: "evaluated",
      isMet: true,
      found: { type: "boolean", value: true },
    }),
  ]);
  renderFrame({ loop: syntheticLoop(), issues: [], run });
  const note = `${i18n.t("plans.loops.run.iteration", { number: 2 })} · ${i18n.t("plans.loops.run.conditionMet")}`;
  expect(screen.getByTitle(note).textContent).toBe(note);
  expect(
    screen.queryByText(i18n.t("plans.loops.session.reuseShort")),
  ).toBeNull();
});

it("keeps the session note while a run has not finished an iteration of the loop", () => {
  renderFrame({ loop: syntheticLoop(), issues: [], run: loopRun([]) });
  expect(
    screen.getByTitle(i18n.t("plans.loops.session.reuseShort")),
  ).toBeDefined();
});
