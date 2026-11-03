import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { LoopCountSection } from "@/app/components/agents/plans/plan-loop-panel/loop-count-section";

import { i18n } from "../../page61-plan-fixture";
import { loopPlan, syntheticLoop } from "../plan-loop-fixture";

import type { AgentPlanInput, AgentPlanNode } from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";

const ROUNDS: AgentPlanNode = {
  id: "rounds",
  type: "parameter",
  x: 0,
  y: 800,
  name: "rounds",
  format: "number",
  value: { type: "number", number: 4 },
};

const STACK: AgentPlanNode = {
  id: "stack",
  type: "stack",
  x: 0,
  y: 900,
  name: "Tickets",
  entries: [
    { id: "e1", type: "task", taskId: "t1" },
    { id: "e2", type: "task", taskId: "t2" },
  ],
};

const FLAG: AgentPlanNode = {
  id: "flag",
  type: "parameter",
  x: 0,
  y: 1000,
  name: "weiter",
  format: "json",
  value: { type: "text", text: "false" },
};

const SOURCES = { agents: [], tasks: [] };

function Section(props: {
  readonly initial: AgentPlanLoop;
  readonly draft?: AgentPlanInput;
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
      <LoopCountSection
        loop={loop}
        draft={props.draft ?? loopPlan(loop, [ROUNDS, STACK, FLAG])}
        sources={SOURCES}
        isDisabled={props.isDisabled ?? false}
        onChange={change}
      />
    </I18nextProvider>
  );
}

function runsInput(): HTMLInputElement {
  const input = screen.getByRole("textbox", {
    name: i18n.t("plans.loops.runs.label"),
  });
  if (!(input instanceof HTMLInputElement)) throw new Error("Missing runs");
  return input;
}

function countBox(): HTMLInputElement {
  const box = screen.getByRole("checkbox", {
    name: i18n.t("plans.loops.countToggle"),
  });
  if (!(box instanceof HTMLInputElement)) throw new Error("Missing Count");
  return box;
}

function exactSwitch(): HTMLElement {
  return screen.getByRole("switch", {
    name: i18n.t("plans.loops.exact.label"),
  });
}

async function choose(label: string, option: string): Promise<void> {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

it("commits a fixed count from 1 to 999 and explains it", () => {
  const onChange = vi.fn();
  render(<Section initial={syntheticLoop()} onChange={onChange} />);
  expect(countBox().checked).toBe(true);
  expect(runsInput().value).toBe("3");
  fireEvent.change(runsInput(), { target: { value: "7" } });
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ runs: 7, runsSource: "value" }),
  );
  expect(screen.getByRole("note").textContent).toBe(
    i18n.t("plans.loops.mode.maxExplain", { count: 7 }),
  );
});

it.each(["1000", "2.5", "", "-1"])(
  "keeps the refused counter %j visible without committing it",
  (text) => {
    const onChange = vi.fn();
    render(<Section initial={syntheticLoop()} onChange={onChange} />);
    fireEvent.change(runsInput(), { target: { value: text } });
    expect(onChange).not.toHaveBeenCalled();
    expect(runsInput().getAttribute("aria-invalid")).toBe("true");
  },
);

it("reads a counter of 0 as a bound count and binds the total of a stack", async () => {
  const onChange = vi.fn();
  render(<Section initial={syntheticLoop()} onChange={onChange} />);
  fireEvent.change(runsInput(), { target: { value: "0" } });
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ runsSource: "parameter" }),
  );
  expect(
    screen.getByText(i18n.t("plans.loops.runs.boundInvalid")).className,
  ).toContain("text-destructive");
  await choose(i18n.t("plans.loops.runs.boundLabel"), "Tickets · 2");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      bindings: { runs: { kind: "stack", stackId: "stack", output: "count" } },
    }),
  );
  expect(
    screen.getByText(i18n.t("plans.loops.runs.boundValue", { count: 2 })),
  ).toBeDefined();
  await choose(i18n.t("plans.loops.runs.boundLabel"), "rounds · 4");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      bindings: { runs: { kind: "source", nodeId: "rounds" } },
    }),
  );
});

it("switches between max and exact counting", () => {
  const onChange = vi.fn();
  render(<Section initial={syntheticLoop()} onChange={onChange} />);
  fireEvent.click(exactSwitch());
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ countMode: "expected" }),
  );
});

it("turns into a while loop without Count and binds its boolean", async () => {
  const onChange = vi.fn();
  render(<Section initial={syntheticLoop()} onChange={onChange} />);
  fireEvent.click(countBox());
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ mode: "while" }),
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(
    screen.getByText(i18n.t("plans.loops.while.invalid")).className,
  ).toContain("text-destructive");
  await choose(i18n.t("plans.loops.while.label"), "weiter · false");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      bindings: { while: { kind: "source", nodeId: "flag" } },
    }),
  );
  expect(
    screen.getByText(i18n.t("plans.loops.while.value", { value: "false" })),
  ).toBeDefined();
});

it("locks every count control while the plan is not editable", () => {
  render(<Section initial={syntheticLoop()} isDisabled onChange={vi.fn()} />);
  expect(runsInput().disabled).toBe(true);
  expect(countBox().disabled).toBe(true);
  expect(exactSwitch()).toHaveProperty("disabled", true);
});
