import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { PlanLoopPanel } from "@/app/components/agents/plans/plan-loop-panel";
import { usePlanGraph } from "@/app/components/agents/plans/use-plan-graph";
import { PLAN_LOOP_NAME_LENGTH } from "@/definition/AgentPlanLoop";

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
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";

function Panel(props: {
  readonly loop: AgentPlanLoop;
  readonly run: AgentPlanRun | null;
  readonly isDisabled: boolean;
  readonly onClose: () => void;
}): React.ReactElement {
  const [draft, setDraft] = useState(() => loopPlan(props.loop));
  const graph = usePlanGraph(draft, setDraft, SOURCES);
  const loop = findLoop(draft);
  if (!loop) throw new Error("Missing loop");
  return (
    <PlanLoopPanel
      loop={loop}
      draft={draft}
      sources={SOURCES}
      graph={graph}
      run={props.run}
      isDisabled={props.isDisabled}
      onClose={props.onClose}
    />
  );
}

function renderPanel(
  options: {
    readonly loop?: AgentPlanLoop;
    readonly run?: AgentPlanRun | null;
    readonly isDisabled?: boolean;
  } = {},
): ReturnType<typeof vi.fn> {
  const onClose = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <Panel
        loop={options.loop ?? syntheticLoop()}
        run={options.run ?? null}
        isDisabled={options.isDisabled ?? false}
        onClose={onClose}
      />
    </I18nextProvider>,
  );
  return onClose;
}

function nameInput(): HTMLInputElement {
  const input = screen.getByRole("textbox", {
    name: i18n.t("plans.loops.name"),
  });
  if (!(input instanceof HTMLInputElement)) throw new Error("Missing name");
  return input;
}

function heading(): HTMLElement {
  return screen.getByRole("heading", { level: 2 });
}

function notes(): readonly (string | null)[] {
  return screen.getAllByRole("note").map((note) => note.textContent);
}

it("renames the loop in the draft only with a valid name", () => {
  renderPanel();
  expect(
    screen.getByRole("dialog", {
      name: i18n.t("plans.loops.panel.label", { name: "Review loop" }),
    }),
  ).toBeDefined();
  expect(heading().textContent).toBe("Review loop");
  fireEvent.change(nameInput(), { target: { value: "Polish loop" } });
  expect(heading().textContent).toBe("Polish loop");
  expect(nameInput().getAttribute("aria-invalid")).toBe("false");
  for (const text of ["   ", "x".repeat(PLAN_LOOP_NAME_LENGTH + 1)]) {
    fireEvent.change(nameInput(), { target: { value: text } });
    expect(nameInput().value).toBe(text);
    expect(nameInput().getAttribute("aria-invalid")).toBe("true");
    expect(heading().textContent).toBe("Polish loop");
  }
});

it("switches between kept and fresh agent sessions", () => {
  renderPanel();
  const sessions = screen.getByRole("switch", {
    name: i18n.t("plans.loops.session.title"),
  });
  expect(sessions.getAttribute("aria-checked")).toBe("true");
  expect(notes()).toContain(i18n.t("plans.loops.session.reuseNote"));
  fireEvent.click(sessions);
  expect(sessions.getAttribute("aria-checked")).toBe("false");
  expect(notes()).toContain(i18n.t("plans.loops.session.freshNote"));
  fireEvent.click(sessions);
  expect(notes()).toContain(i18n.t("plans.loops.session.reuseNote"));
});

it("writes changes of the count and condition sections into the draft", () => {
  renderPanel({
    loop: syntheticLoop({
      steps: [loopMember("check", "reviewer", { x: 0, y: 0 })],
    }),
  });
  fireEvent.click(
    screen.getByRole("switch", { name: i18n.t("plans.loops.exact.label") }),
  );
  expect(notes()).toContain(
    i18n.t("plans.loops.mode.expectedExplain", { count: 3 }),
  );
  expect(notes()).toContain(i18n.t("plans.loops.condition.inactiveNote"));
});

it("closes from the header, the footer and the Escape key", () => {
  const onClose = renderPanel();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.loops.panel.close") }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.loops.panel.closeButton"),
    }),
  );
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(3);
  expect(screen.getByText(i18n.t("plans.loops.panel.draftHint"))).toBeDefined();
});

it("lists the loop's run only while a run has a record of it", () => {
  renderPanel({
    loop: syntheticLoop({
      steps: [loopMember("check", "reviewer", { x: 0, y: 0 })],
    }),
    run: loopRun([
      loopIteration(1, { state: "not_evaluated", reason: "disabled" }),
    ]),
  });
  expect(
    screen.getByRole("heading", { name: i18n.t("plans.loops.run.title") }),
  ).toBeDefined();
});

it("shows no run section without a record and locks the name while disabled", () => {
  renderPanel({ run: { ...loopRun([]), loops: [] }, isDisabled: true });
  expect(
    screen.queryByRole("heading", { name: i18n.t("plans.loops.run.title") }),
  ).toBeNull();
  expect(nameInput().disabled).toBe(true);
  expect(
    screen.getByRole("switch", { name: i18n.t("plans.loops.session.title") }),
  ).toHaveProperty("disabled", true);
});
