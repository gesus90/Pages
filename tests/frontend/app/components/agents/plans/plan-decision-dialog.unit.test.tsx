import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  PlanDecisionDialog,
  planConditionChoices,
} from "@/app/components/agents/plans/plan-decision-dialog";

import {
  DECISION,
  conditionEdge,
  reviewCyclePlan,
} from "./plan-branching-fixture";
import {
  GROUP_SOURCES,
  agentNode,
  flowEdge,
  graphStub,
  i18n,
  ownCopy,
  planOf,
  renderTranslated,
} from "./plan-group-fixture";

import type { AgentPlanDecision, AgentPlanInput } from "@/definition/AgentPlan";

/** Two agents in a row; the decision reads the first and may read the second without any cycle. */
function twoCheckersPlan(): AgentPlanInput {
  return planOf(
    [
      { id: "start", type: "start", x: 0, y: 0 },
      agentNode("check", "codex", { x: 200 }),
      agentNode("second", "codex-two", { x: 500 }),
      DECISION,
    ],
    [
      flowEdge("start", "check"),
      flowEdge("check", "second"),
      conditionEdge("check", "decision"),
    ],
  );
}

function renderDialog(
  options: {
    readonly decision?: AgentPlanDecision;
    readonly draft?: AgentPlanInput;
    readonly isDisabled?: boolean;
  } = {},
): {
  readonly graph: ReturnType<typeof graphStub>;
  readonly onClose: ReturnType<typeof vi.fn>;
} {
  const graph = graphStub();
  const onClose = vi.fn();
  const draft = options.draft ?? reviewCyclePlan();
  renderTranslated(
    <PlanDecisionDialog
      decision={options.decision ?? DECISION}
      draft={draft}
      sources={GROUP_SOURCES}
      graph={graph}
      isDisabled={options.isDisabled ?? false}
      onClose={onClose}
    />,
  );
  return { graph, onClose };
}

function picker(): HTMLElement {
  return screen.getByRole("combobox", {
    name: i18n.t("plans.decision.dialog.condition"),
  });
}

async function choose(option: string): Promise<void> {
  fireEvent.keyDown(picker(), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

it("explains that the decision is evaluated anew and is no language-model agent", () => {
  renderDialog();

  expect(
    screen.getByRole("dialog", { name: i18n.t("plans.decision.dialog.title") }),
  ).toBeDefined();
  const hint = i18n.t("plans.decision.dialog.hint");
  expect(screen.getByText(hint)).toBeDefined();
  expect(hint).toContain("false");
  expect(hint).toContain("LLM");
  // The dialog shows the same symbol as the card and the palette.
  expect(
    screen
      .getByRole("dialog", { name: i18n.t("plans.decision.dialog.title") })
      .querySelector("svg.lucide-git-fork"),
  ).not.toBeNull();
});

it("lists the agents of the plan, none first, and shows the agent it reads now", () => {
  renderDialog();

  expect(picker().textContent).toBe("Codex One");
  expect(
    planConditionChoices(reviewCyclePlan(), GROUP_SOURCES, i18n.t.bind(i18n)),
  ).toEqual([
    { value: "", label: "–" },
    { value: "check", label: "Codex One" },
    { value: "fix", label: "Codex Two" },
  ]);
});

it("tells apart two agents with the same name", () => {
  const plan = planOf([
    agentNode("first", "codex"),
    agentNode("second", "codex"),
    agentNode("copy", "codex", { configuration: ownCopy("Pinned", 0) }),
  ]);

  expect(
    planConditionChoices(plan, GROUP_SOURCES, i18n.t.bind(i18n)).map(
      (choice) => choice.label,
    ),
  ).toEqual(["–", "Codex One · 1", "Codex One · 2", "Pinned"]);
});

it("keeps edits private until they are applied, then writes name and condition", async () => {
  const { graph, onClose } = renderDialog({ draft: twoCheckersPlan() });

  fireEvent.change(
    screen.getByLabelText(i18n.t("plans.decision.dialog.name")),
    {
      target: { value: "  Prüfen & bewerten " },
    },
  );
  await choose("Codex Two");
  expect(graph.replaceNode).not.toHaveBeenCalled();
  expect(graph.setDecisionCondition).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.closeNode") }),
  );

  expect(graph.replaceNode).toHaveBeenCalledWith({
    id: "decision",
    type: "decision",
    x: DECISION.x,
    y: DECISION.y,
    name: "Prüfen & bewerten",
  });
  expect(graph.setDecisionCondition).toHaveBeenCalledWith("decision", "second");
  expect(onClose).toHaveBeenCalled();
});

it("refuses an agent that would make a cycle, says why and changes nothing", async () => {
  const { graph, onClose } = renderDialog();

  await choose("Codex Two");
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.closeNode") }),
  );

  expect(screen.getByRole("alert").textContent).toBe(
    i18n.t("plans.validation.cycle"),
  );
  expect(graph.replaceNode).not.toHaveBeenCalled();
  expect(graph.setDecisionCondition).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();

  // Another choice takes the reason away and applies as usual.
  await choose("–");
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.closeNode") }),
  );
  expect(graph.setDecisionCondition).toHaveBeenCalledWith("decision", null);
  expect(onClose).toHaveBeenCalled();
});

it("clears the condition with the none choice and the name with an empty field", async () => {
  const { graph } = renderDialog({
    decision: { ...DECISION, name: "Alt" },
  });

  fireEvent.change(
    screen.getByLabelText(i18n.t("plans.decision.dialog.name")),
    {
      target: { value: "" },
    },
  );
  await choose("–");
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.closeNode") }),
  );

  expect(graph.replaceNode).toHaveBeenCalledWith({
    id: "decision",
    type: "decision",
    x: DECISION.x,
    y: DECISION.y,
  });
  expect(graph.setDecisionCondition).toHaveBeenCalledWith("decision", null);
});

it("leaves the connection alone when the condition did not change", () => {
  const { graph } = renderDialog();

  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.closeNode") }),
  );

  expect(graph.setDecisionCondition).not.toHaveBeenCalled();
});

it("discards edits when it is cancelled", () => {
  const { graph, onClose } = renderDialog();

  fireEvent.change(
    screen.getByLabelText(i18n.t("plans.decision.dialog.name")),
    {
      target: { value: "Neu" },
    },
  );
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("settings.agents.cancel") }),
  );

  expect(graph.replaceNode).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

it("offers no apply button while the plan cannot be changed", () => {
  renderDialog({ isDisabled: true });

  expect(
    screen.queryByRole("button", { name: i18n.t("plans.closeNode") }),
  ).toBeNull();
  expect(
    screen
      .getByLabelText(i18n.t("plans.decision.dialog.name"))
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(picker().hasAttribute("disabled")).toBe(true);
});
