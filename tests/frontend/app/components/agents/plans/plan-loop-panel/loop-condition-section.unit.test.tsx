import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { LoopConditionSection } from "@/app/components/agents/plans/plan-loop-panel/loop-condition-section";

import { i18n, SOURCES } from "../../page61-plan-fixture";
import { loopMember, loopPlan, syntheticLoop } from "../plan-loop-fixture";

import type { Mock } from "vitest";
import type {
  AgentPlanLoop,
  AgentPlanLoopCondition,
} from "@/definition/AgentPlanLoop";

const MEMBERS = [
  loopMember("check", "reviewer", { x: 0, y: 0 }),
  loopMember("write", "writer", { x: 320, y: 0 }),
];

const CONDITION: AgentPlanLoopCondition = {
  isEnabled: true,
  sourceNodeId: "write",
  outputPath: "$.done",
  operator: "equals",
  expected: { type: "number", value: 5 },
};

function Section(props: {
  readonly initial: AgentPlanLoop;
  readonly isDisabled?: boolean;
  readonly onChange: (loop: AgentPlanLoop) => void;
}): React.ReactElement {
  const [loop, setLoop] = useState(props.initial);
  function change(next: AgentPlanLoop): void {
    props.onChange(next);
    setLoop(next);
  }
  return (
    <I18nextProvider i18n={i18n}>
      <LoopConditionSection
        loop={loop}
        draft={loopPlan(loop)}
        sources={SOURCES}
        isDisabled={props.isDisabled ?? false}
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

/** The condition of the loop the section committed last. */
function committed(
  onChange: Mock<(loop: AgentPlanLoop) => void>,
): AgentPlanLoopCondition | null | undefined {
  return onChange.mock.lastCall?.[0].condition;
}

function conditionSwitch(): HTMLElement {
  return screen.getByRole("switch", {
    name: i18n.t("plans.loops.condition.title"),
  });
}

function combobox(label: string): HTMLElement {
  return screen.getByRole("combobox", { name: label });
}

function textbox(label: string): HTMLInputElement {
  const input = screen.getByRole("textbox", { name: label });
  if (!(input instanceof HTMLInputElement)) throw new Error("Missing input");
  return input;
}

async function choose(label: string, option: string): Promise<void> {
  fireEvent.keyDown(combobox(label), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

function valueLabel(type: string): string {
  return `${i18n.t("plans.loops.condition.value")} · ${i18n.t(`plans.loops.condition.types.${type}`)}`;
}

function summary(values: {
  readonly source: string;
  readonly path: string;
  readonly value: string;
  readonly type: string;
  readonly count: number;
}): string {
  return i18n.t("plans.loops.condition.summary", {
    ...values,
    type: i18n.t(`plans.loops.condition.types.${values.type}`),
  });
}

const PATH = i18n.t("plans.loops.condition.path");
const TYPE = i18n.t("plans.loops.condition.type");
const SOURCE = i18n.t("plans.loops.condition.source");

it("offers a switched-off condition on the first member and switches it on", () => {
  const onChange = renderSection(syntheticLoop({ steps: MEMBERS }));
  expect(conditionSwitch().getAttribute("aria-checked")).toBe("false");
  expect(combobox(SOURCE).textContent).toContain("Reviewer · Agent");
  expect(textbox(PATH).value).toBe("$.end");
  expect(combobox(valueLabel("boolean")).textContent).toContain("true");
  expect(
    screen.getByText(
      summary({
        source: "Reviewer",
        path: "$.end",
        value: "true",
        type: "boolean",
        count: 3,
      }),
    ),
  ).toBeDefined();
  expect(screen.getByRole("note").textContent).toBe(
    i18n.t("plans.loops.condition.noteOff"),
  );
  fireEvent.click(conditionSwitch());
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      condition: {
        isEnabled: true,
        sourceNodeId: "check",
        outputPath: "$.end",
        operator: "equals",
        expected: { type: "boolean", value: true },
      },
    }),
  );
  expect(screen.getByRole("note").textContent).toBe(
    i18n.t("plans.loops.condition.noteOn"),
  );
});

it("has no source to offer in a loop without members", () => {
  renderSection(syntheticLoop());
  expect(combobox(SOURCE)).toHaveProperty("disabled", true);
  expect(
    screen.getByText(
      summary({
        source: "—",
        path: "$.end",
        value: "true",
        type: "boolean",
        count: 3,
      }),
    ),
  ).toBeDefined();
});

it("keeps a saved condition but locks it while the loop counts exactly", () => {
  renderSection(
    syntheticLoop({
      steps: MEMBERS,
      countMode: "expected",
      condition: CONDITION,
    }),
  );
  expect(
    screen.getByText(i18n.t("plans.loops.condition.inactive")),
  ).toBeDefined();
  const fields = textbox(PATH).closest("[data-inactive]");
  expect(fields?.getAttribute("aria-disabled")).toBe("true");
  expect(textbox(PATH).disabled).toBe(true);
  expect(textbox(valueLabel("number")).value).toBe("5");
  expect(combobox(TYPE)).toHaveProperty("disabled", true);
  const note = screen.getByRole("note");
  expect(note.textContent).toBe(i18n.t("plans.loops.condition.inactiveNote"));
  expect(note.className).toContain("text-warning");
  expect(conditionSwitch()).toHaveProperty("disabled", false);
});

it("locks the switch and every field while the plan is not editable", () => {
  renderSection(syntheticLoop({ steps: MEMBERS, condition: CONDITION }), true);
  expect(conditionSwitch()).toHaveProperty("disabled", true);
  expect(textbox(PATH).disabled).toBe(true);
  expect(combobox(SOURCE)).toHaveProperty("disabled", true);
});

it("counts the summary with the saved number while a parameter count is unresolved", () => {
  renderSection(
    syntheticLoop({
      steps: MEMBERS,
      runs: 6,
      runsSource: "parameter",
      condition: CONDITION,
    }),
  );
  expect(
    screen.getByText(
      summary({
        source: "Writer",
        path: "$.done",
        value: "5",
        type: "number",
        count: 6,
      }),
    ),
  ).toBeDefined();
});

it("commits only valid JSON paths and follows a path changed elsewhere", () => {
  const onChange = vi.fn();
  const loop = syntheticLoop({ steps: MEMBERS, condition: CONDITION });
  const view = render(<Section initial={loop} onChange={onChange} />);
  fireEvent.change(textbox(PATH), { target: { value: "$.review.end" } });
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      condition: { ...CONDITION, outputPath: "$.review.end" },
    }),
  );
  onChange.mockClear();
  fireEvent.change(textbox(PATH), { target: { value: "end" } });
  expect(onChange).not.toHaveBeenCalled();
  expect(textbox(PATH).getAttribute("aria-invalid")).toBe("true");
  expect(
    screen.getByText(i18n.t("plans.loops.condition.pathInvalid")),
  ).toBeDefined();
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <LoopConditionSection
        loop={{
          ...loop,
          condition: { ...CONDITION, outputPath: "$.items[0]" },
        }}
        draft={loopPlan(loop)}
        sources={SOURCES}
        isDisabled={false}
        onChange={onChange}
      />
    </I18nextProvider>,
  );
  expect(textbox(PATH).value).toBe("$.items[0]");
  expect(
    screen.queryByText(i18n.t("plans.loops.condition.pathInvalid")),
  ).toBeNull();
});

it("chooses another member as the source of the condition", async () => {
  const onChange = renderSection(syntheticLoop({ steps: MEMBERS }));
  await choose(SOURCE, "Writer · Agent");
  expect(committed(onChange)?.sourceNodeId).toBe("write");
});

it("compares with a number only when the typed text is a finite number", async () => {
  const onChange = renderSection(syntheticLoop({ steps: MEMBERS }));
  await choose(TYPE, i18n.t("plans.loops.condition.types.number"));
  expect(committed(onChange)?.expected).toEqual({ type: "number", value: 0 });
  expect(textbox(valueLabel("number")).value).toBe("0");
  fireEvent.change(textbox(valueLabel("number")), {
    target: { value: "2.5" },
  });
  expect(committed(onChange)?.expected).toEqual({ type: "number", value: 2.5 });
  onChange.mockClear();
  fireEvent.change(textbox(valueLabel("number")), { target: { value: "1e" } });
  expect(textbox(valueLabel("number")).getAttribute("aria-invalid")).toBe(
    "true",
  );
  fireEvent.change(textbox(valueLabel("number")), { target: { value: " " } });
  expect(textbox(valueLabel("number")).getAttribute("aria-invalid")).toBe(
    "false",
  );
  expect(onChange).not.toHaveBeenCalled();
});

it("compares with text, null or a chosen boolean", async () => {
  const onChange = renderSection(syntheticLoop({ steps: MEMBERS }));
  await choose(TYPE, i18n.t("plans.loops.condition.types.string"));
  fireEvent.change(textbox(valueLabel("string")), {
    target: { value: "done" },
  });
  expect(committed(onChange)?.expected).toEqual({
    type: "string",
    value: "done",
  });
  expect(
    screen.getByText(
      summary({
        source: "Reviewer",
        path: "$.end",
        value: JSON.stringify("done"),
        type: "string",
        count: 3,
      }),
    ),
  ).toBeDefined();
  await choose(TYPE, i18n.t("plans.loops.condition.types.null"));
  expect(
    screen.getByText(i18n.t("plans.loops.condition.nullValue")),
  ).toBeDefined();
  expect(
    screen.getByText(
      summary({
        source: "Reviewer",
        path: "$.end",
        value: "null",
        type: "null",
        count: 3,
      }),
    ),
  ).toBeDefined();
  await choose(TYPE, i18n.t("plans.loops.condition.types.boolean"));
  await choose(valueLabel("boolean"), "false");
  expect(committed(onChange)?.expected).toEqual({
    type: "boolean",
    value: false,
  });
});

it("offers equality as the only comparison", async () => {
  renderSection(syntheticLoop({ steps: MEMBERS }));
  const operator = combobox(i18n.t("plans.loops.condition.operator"));
  expect(operator.textContent).toContain(
    i18n.t("plans.loops.condition.equals"),
  );
  fireEvent.keyDown(operator, { key: "Enter" });
  expect(
    (await screen.findAllByRole("option")).map((option) => option.textContent),
  ).toEqual([i18n.t("plans.loops.condition.equals")]);
});
