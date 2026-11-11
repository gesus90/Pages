import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { LoopWhileSection } from "@/app/components/agents/plans/plan-loop-panel/loop-while-section";
import { PLAN_LOOP_PATH_LENGTH } from "@/definition/AgentPlanLoop";

import { i18n, SOURCES } from "../../page61-plan-fixture";
import { loopMember, loopPlan, syntheticLoop } from "../plan-loop-fixture";

import type { Mock } from "vitest";
import type { AgentPlanParameter } from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";

function booleanParameter(id: string, text: string): AgentPlanParameter {
  return {
    id,
    type: "parameter",
    x: 0,
    y: 0,
    name: id,
    format: "boolean",
    value: { type: "text", text },
  };
}

const PARAMETERS = [
  booleanParameter("go", "true"),
  booleanParameter("stop", " false "),
  booleanParameter("odd", "yes"),
];
const MEMBERS = [
  loopMember("check", "reviewer", { x: 0, y: 0 }),
  loopMember("write", "writer", { x: 320, y: 0 }),
];

function Section(props: {
  readonly initial: AgentPlanLoop;
  readonly isDisabled: boolean;
  readonly onChange: (loop: AgentPlanLoop) => void;
}): React.ReactElement {
  const [loop, setLoop] = useState(props.initial);
  function change(next: AgentPlanLoop): void {
    props.onChange(next);
    setLoop(next);
  }
  return (
    <I18nextProvider i18n={i18n}>
      <LoopWhileSection
        loop={loop}
        draft={loopPlan(loop, PARAMETERS)}
        sources={SOURCES}
        isDisabled={props.isDisabled}
        onChange={change}
      />
    </I18nextProvider>
  );
}

function renderSection(
  initial: AgentPlanLoop,
  isDisabled = false,
): Mock<(loop: AgentPlanLoop) => void> {
  const onChange = vi.fn<(loop: AgentPlanLoop) => void>();
  render(
    <Section initial={initial} isDisabled={isDisabled} onChange={onChange} />,
  );
  return onChange;
}

function combobox(label: string): HTMLElement {
  return screen.getByRole("combobox", { name: label });
}

async function choose(label: string, option: string): Promise<void> {
  fireEvent.keyDown(combobox(label), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

const WHILE = i18n.t("plans.loops.while.label");
const SOURCE = i18n.t("plans.loops.while.sourceLabel");
const PATH = i18n.t("plans.loops.while.pathLabel");

function boundLoop(
  nodeId: string,
  overrides: Partial<AgentPlanLoop> = {},
): AgentPlanLoop {
  return syntheticLoop({
    steps: MEMBERS,
    bindings: { while: { kind: "source", nodeId } },
    ...overrides,
  });
}

it("reports an unbound boolean as invalid and offers every parameter", async () => {
  renderSection(syntheticLoop({ steps: MEMBERS }));
  expect(combobox(WHILE).textContent).toContain(
    i18n.t("plans.loops.runs.parameterNone"),
  );
  expect(screen.getByText(i18n.t("plans.loops.while.invalid"))).toBeDefined();
  fireEvent.keyDown(combobox(WHILE), { key: "Enter" });
  const options = (await screen.findAllByRole("option")).map(
    (option) => option.textContent,
  );
  expect(options).toEqual([
    i18n.t("plans.loops.runs.parameterNone"),
    "spare · —",
    "go · true",
    "stop · false",
    "odd · —",
  ]);
});

it("binds the chosen parameter and shows its current value", async () => {
  const onChange = renderSection(syntheticLoop({ steps: MEMBERS }));
  await choose(WHILE, "go · true");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      bindings: { while: { kind: "source", nodeId: "go" } },
    }),
  );
  expect(
    screen.getByText(i18n.t("plans.loops.while.value", { value: "true" })),
  ).toBeDefined();
  expect(screen.queryByText(i18n.t("plans.loops.while.invalid"))).toBeNull();
});

it("reads a trimmed false as a valid value", () => {
  renderSection(boundLoop("stop"));
  expect(
    screen.getByText(i18n.t("plans.loops.while.value", { value: "false" })),
  ).toBeDefined();
});

it("marks a bound parameter that is no exact boolean as invalid", () => {
  renderSection(boundLoop("odd"));
  const note = screen.getByText(i18n.t("plans.loops.while.invalid"));
  expect(note.className).toContain("text-destructive");
});

it("removes only the while binding when the parameter is cleared", async () => {
  const onChange = renderSection(
    boundLoop("go", {
      bindings: {
        while: { kind: "source", nodeId: "go" },
        runs: { kind: "source", nodeId: "stop" },
      },
    }),
  );
  await choose(WHILE, i18n.t("plans.loops.runs.parameterNone"));
  expect(onChange.mock.lastCall?.[0].bindings).toEqual({
    runs: { kind: "source", nodeId: "stop" },
  });
});

it("locks the parameter choice and the later source while disabled", () => {
  renderSection(boundLoop("go"), true);
  expect(combobox(WHILE)).toHaveProperty("disabled", true);
  expect(combobox(SOURCE)).toHaveProperty("disabled", true);
});

it("reads the parameter again after the first iteration unless a member is chosen", () => {
  renderSection(boundLoop("go"));
  expect(combobox(SOURCE).textContent).toContain(
    i18n.t("plans.loops.while.sourceNone"),
  );
  expect(screen.queryByRole("textbox", { name: PATH })).toBeNull();
});

it("chooses a member as the source and keeps the default path", async () => {
  const onChange = renderSection(boundLoop("go"));
  await choose(SOURCE, "Writer");
  expect(onChange.mock.lastCall?.[0].while).toEqual({
    sourceNodeId: "write",
    outputPath: "$.weiter",
  });
  expect(screen.getByRole("textbox", { name: PATH })).toHaveProperty(
    "value",
    "$.weiter",
  );
});

it("edits the path of the later check and flags an unsupported path", () => {
  const onChange = renderSection(
    boundLoop("go", { while: { sourceNodeId: "check", outputPath: "$.next" } }),
  );
  const input = screen.getByRole("textbox", { name: PATH });
  expect(input.getAttribute("aria-invalid")).toBe("false");
  expect(input.getAttribute("maxlength")).toBe(String(PLAN_LOOP_PATH_LENGTH));
  fireEvent.change(input, { target: { value: "$.review.done" } });
  expect(onChange.mock.lastCall?.[0].while).toEqual({
    sourceNodeId: "check",
    outputPath: "$.review.done",
  });
  fireEvent.change(input, { target: { value: "no path" } });
  expect(input.getAttribute("aria-invalid")).toBe("true");
});

it("returns to reading the parameter when the member source is cleared", async () => {
  const onChange = renderSection(
    boundLoop("go", { while: { sourceNodeId: "check", outputPath: "$.next" } }),
  );
  await choose(SOURCE, i18n.t("plans.loops.while.sourceNone"));
  expect(onChange.mock.lastCall?.[0].while).toEqual({
    sourceNodeId: "",
    outputPath: "$.next",
  });
  expect(screen.queryByRole("textbox", { name: PATH })).toBeNull();
});

it("explains that every iteration is checked afresh", () => {
  renderSection(boundLoop("go"));
  expect(screen.getByRole("note").textContent).toBe(
    i18n.t("plans.loops.while.explain"),
  );
});

it("disables the parameter choice in a plan without parameters", () => {
  const onChange = vi.fn();
  const loop = syntheticLoop();
  const draft = { ...loopPlan(loop), nodes: [loop] };
  render(
    <I18nextProvider i18n={i18n}>
      <LoopWhileSection
        loop={loop}
        draft={draft}
        sources={SOURCES}
        isDisabled={false}
        onChange={onChange}
      />
    </I18nextProvider>,
  );
  expect(combobox(WHILE)).toHaveProperty("disabled", true);
});
