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
        draft={props.draft ?? loopPlan(loop, [ROUNDS])}
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

function exactSwitch(): HTMLElement {
  return screen.getByRole("switch", {
    name: i18n.t("plans.loops.exact.label"),
  });
}

function parameterSelect(): HTMLElement {
  return screen.getByRole("combobox", {
    name: i18n.t("plans.loops.runs.parameterLabel"),
  });
}

async function chooseParameter(name: string): Promise<void> {
  fireEvent.keyDown(parameterSelect(), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name }));
}

const LIMITS = { minimum: 1, maximum: 999 };

it("commits a typed whole count and explains what it means in max mode", () => {
  const onChange = vi.fn();
  render(<Section initial={syntheticLoop()} onChange={onChange} />);
  expect(runsInput().value).toBe("3");
  expect(
    screen.getByText(i18n.t("plans.loops.runs.hint", LIMITS)).className,
  ).toContain("text-muted-foreground");
  fireEvent.change(runsInput(), { target: { value: "7" } });
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ runs: 7 }),
  );
  expect(
    screen.getByText(i18n.t("plans.loops.mode.maxLine", { count: 7 })),
  ).toBeDefined();
  expect(screen.getByRole("note").textContent).toBe(
    i18n.t("plans.loops.mode.maxExplain", { count: 7 }),
  );
});

it.each(["0", "12345", "2.5", ""])(
  "keeps the refused count %j visible without committing it",
  (text) => {
    const onChange = vi.fn();
    render(<Section initial={syntheticLoop()} onChange={onChange} />);
    fireEvent.change(runsInput(), { target: { value: text } });
    expect(onChange).not.toHaveBeenCalled();
    expect(runsInput().value).toBe(text);
    expect(runsInput().getAttribute("aria-invalid")).toBe("true");
    expect(
      screen.getByText(i18n.t("plans.loops.runs.invalid", LIMITS)).className,
    ).toContain("text-destructive");
  },
);

it("takes over a count that changes outside the field", () => {
  const onChange = vi.fn();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <LoopCountSection
        loop={syntheticLoop()}
        draft={loopPlan(syntheticLoop())}
        isDisabled={false}
        onChange={onChange}
      />
    </I18nextProvider>,
  );
  fireEvent.change(runsInput(), { target: { value: "abc" } });
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <LoopCountSection
        loop={syntheticLoop({ runs: 9 })}
        draft={loopPlan(syntheticLoop({ runs: 9 }))}
        isDisabled={false}
        onChange={onChange}
      />
    </I18nextProvider>,
  );
  expect(runsInput().value).toBe("9");
  expect(runsInput().getAttribute("aria-invalid")).toBe("false");
});

it("switches between max and exact counting", () => {
  const onChange = vi.fn();
  render(<Section initial={syntheticLoop()} onChange={onChange} />);
  expect(exactSwitch().getAttribute("aria-checked")).toBe("false");
  fireEvent.click(exactSwitch());
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ countMode: "expected" }),
  );
  expect(exactSwitch().getAttribute("aria-checked")).toBe("true");
  expect(
    screen.getByText(i18n.t("plans.loops.mode.expectedLine", { count: 3 })),
  ).toBeDefined();
  expect(screen.getByRole("note").textContent).toBe(
    i18n.t("plans.loops.mode.expectedExplain", { count: 3 }),
  );
  fireEvent.click(exactSwitch());
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ countMode: "max" }),
  );
});

it("binds the count to a parameter node and releases it again", async () => {
  const onChange = vi.fn();
  render(<Section initial={syntheticLoop()} onChange={onChange} />);
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.loops.source.parameter"),
    }),
  );
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ runsSource: "parameter" }),
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(parameterSelect().textContent).toContain(
    i18n.t("plans.loops.runs.parameterNone"),
  );
  expect(
    screen.getByText(i18n.t("plans.loops.runs.parameterInvalid")).className,
  ).toContain("text-destructive");
  expect(
    screen.getByText(i18n.t("plans.loops.mode.maxUnresolved"), {
      selector: "p:not([role])",
    }),
  ).toBeDefined();
  expect(screen.getByRole("note").textContent).toBe(
    i18n.t("plans.loops.mode.maxUnresolved"),
  );
  fireEvent.keyDown(parameterSelect(), { key: "Enter" });
  expect(
    await screen.findByRole("option", { name: "spare · —" }),
  ).toBeDefined();
  fireEvent.click(screen.getByRole("option", { name: "rounds · 4" }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      bindings: { runs: { kind: "source", nodeId: "rounds" } },
    }),
  );
  expect(
    screen.getByText(
      i18n.t("plans.loops.runs.parameterValue", { name: "rounds", count: 4 }),
    ).className,
  ).toContain("text-muted-foreground");
  expect(screen.getByRole("note").textContent).toBe(
    i18n.t("plans.loops.mode.maxExplain", { count: 4 }),
  );
  await chooseParameter(i18n.t("plans.loops.runs.parameterNone"));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ bindings: {} }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.loops.source.value") }),
  );
  expect(runsInput().value).toBe("3");
});

it("locks the parameter choice of a plan without parameter nodes", () => {
  const plan = loopPlan(syntheticLoop());
  const draft = {
    ...plan,
    nodes: plan.nodes.filter((node) => node.type !== "parameter"),
  };
  render(
    <Section
      initial={syntheticLoop({
        runsSource: "parameter",
        countMode: "expected",
      })}
      draft={draft}
      onChange={vi.fn()}
    />,
  );
  expect(parameterSelect()).toHaveProperty("disabled", true);
  expect(
    screen.getByText(i18n.t("plans.loops.runs.noParameters")),
  ).toBeDefined();
  expect(screen.getByRole("note").textContent).toBe(
    i18n.t("plans.loops.mode.expectedUnresolved"),
  );
});

it("locks every count control while the plan is not editable", () => {
  render(<Section initial={syntheticLoop()} isDisabled onChange={vi.fn()} />);
  expect(runsInput().disabled).toBe(true);
  expect(exactSwitch()).toHaveProperty("disabled", true);
});
