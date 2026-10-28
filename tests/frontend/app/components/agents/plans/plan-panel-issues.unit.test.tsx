import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";

import {
  PlanPanelIssueList,
  planPanelIssues,
} from "@/app/components/agents/plans/plan-panel-issues";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { emptyPlanLoop } from "@/definition/AgentPlanLoop";

import {
  actionScene,
  i18n,
  planControl,
  planPage,
  planView,
  renderTranslated,
  renderWithEditor,
} from "./plan-panel-fixture";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type {
  AgentPlanNode,
  AgentPlanStep,
  AgentPlanTask,
} from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";

const REVIEWER: AgentDefinitionChoice = {
  id: "reviewer",
  name: "Reviewer",
  model: "synthetic-free:free",
  reasoningEffort: null,
  provider: "openrouter",
  purposes: ["agent"],
  revision: 1,
  configuration: {
    ...emptyAgentConfiguration(),
    parameters: [
      {
        name: "ticket",
        type: "ticket",
        description: "",
        isRequired: true,
        defaultValue: null,
      },
    ],
  },
  availability: { isUsable: true, reason: null, personalChoices: [] },
};

const TASK: AgentPlanTask = {
  id: "t1",
  key: "SYN-1",
  title: "Open work",
  type: "task",
  parentId: null,
  statusKey: "todo",
  statusName: "To Do",
  isDone: false,
  createdAt: "2026-01-01 08:00:00",
  updatedAt: "2026-01-01 08:00:00",
};

function agent(
  id: string,
  agentId: string,
  overrides: Partial<AgentPlanStep> = {},
): AgentPlanStep {
  return {
    id,
    type: "agent",
    x: 0,
    y: 0,
    agentId,
    personalAgentId: null,
    instruction: "",
    bindings: {},
    ...overrides,
  };
}

const NODES: readonly AgentPlanNode[] = [
  { id: "start", type: "start", x: 0, y: 0 },
  agent("named", "reviewer"),
  agent("unnamed", ""),
  { id: "ticket", type: "task", x: 0, y: 0, taskId: "t1" },
  { id: "lost", type: "task", x: 0, y: 0, taskId: "gone" },
  {
    id: "group",
    type: "group",
    name: "Review group",
    x: 0,
    y: 0,
    steps: [agent("member", "reviewer")],
    parameters: [],
    bindings: {},
  },
  {
    ...emptyPlanLoop("loop", "Review loop", { x: 0, y: 0 }),
    steps: [agent("looped", "reviewer")],
  },
  {
    id: "spare",
    type: "parameter",
    x: 0,
    y: 0,
    name: "spare",
    format: "string",
    value: { type: "text", text: "kept" },
  },
  { id: "end", type: "end", x: 0, y: 0 },
];

function issue(
  nodeId: string | null,
  reason: AgentPlanIssue["reason"],
  port: string | null = null,
): AgentPlanIssue {
  return { nodeId, port, reason };
}

interface Scenario {
  readonly nodes?: readonly AgentPlanNode[];
  readonly control?: AgentPlanControl;
  readonly code?: string | null;
  readonly answer?: AgentPlanActionResult;
}

function renderIssues(scenario: Scenario = {}): ReturnType<typeof actionScene> {
  const selected = planView({ nodes: scenario.nodes ?? NODES });
  const page = planPage({
    selected,
    plans: [selected],
    sources: { agents: [REVIEWER], tasks: [TASK] },
  });
  const scene = actionScene(scenario.answer);
  renderWithEditor(page, scene, (editor) => (
    <>
      <output aria-label="Request">{editor.command.state}</output>
      <PlanPanelIssueList
        issues={planPanelIssues({
          control: scenario.control,
          editor,
          code: scenario.code ?? null,
          translate: i18n.t,
        })}
      />
    </>
  ));
  return scene;
}

/** Sends the draft and waits until the synthetic action answered. */
async function submitDraft(
  scene: ReturnType<typeof actionScene>,
): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Submit draft" }));
  await waitFor(() => expect(scene.submissions).toHaveLength(1));
  await waitFor(() =>
    expect(screen.getByRole("status", { name: "Request" }).textContent).toBe(
      "idle",
    ),
  );
}

function rows(): readonly HTMLElement[] {
  return screen.queryAllByRole("listitem");
}

/** The visible text of a row: its mark, what is affected and why. */
function row(title: string, cause: string): string {
  return `!${title}${cause}`;
}

function nodeCause(reason: string): string {
  return i18n.t([
    `plans.panel.issueCause.${reason}`,
    `plans.validation.${reason}`,
  ]);
}

it("names each finding by its node's name, never by an identifier", () => {
  renderIssues({
    control: planControl({
      issues: [
        issue("start", "flowOut"),
        issue("named", "agent"),
        issue("unnamed", "agent"),
        issue("ticket", "unreachable"),
        issue("lost", "unreachable"),
        issue("member", "flowIn"),
        issue("looped", "flowIn"),
        issue("spare", "name"),
        issue("end", "flowIn"),
        issue("missing", "end"),
      ],
    }),
  });

  expect(
    screen.getByRole("list", { name: i18n.t("plans.panel.issuesLabel") }),
  ).toBeDefined();
  expect(rows().map((entry) => entry.textContent)).toEqual([
    row(i18n.t("plans.nodeType.start"), nodeCause("flowOut")),
    row("Reviewer", nodeCause("agent")),
    row(i18n.t("plans.missingAgent"), nodeCause("agent")),
    row("SYN-1", nodeCause("unreachable")),
    row(i18n.t("plans.ticketUnavailable"), nodeCause("unreachable")),
    row("Reviewer", nodeCause("flowIn")),
    row("Reviewer", nodeCause("flowIn")),
    row("spare", nodeCause("name")),
    row(i18n.t("plans.nodeType.end"), nodeCause("flowIn")),
    row(i18n.t("plans.panel.issueTitle.plan"), nodeCause("end")),
  ]);
});

it("names the input of a finding in its title, or in the cause of a missing required value", () => {
  renderIssues({
    control: planControl({
      issues: [
        issue("named", "required", "ticket"),
        issue("unnamed", "type", "notes"),
        issue("spare", "port", "flow-in"),
        issue(null, "cycle"),
      ],
    }),
  });

  expect(rows().map((entry) => entry.textContent)).toEqual([
    row(
      "Reviewer",
      i18n.t("plans.panel.issueCause.requiredPort", { port: "ticket" }),
    ),
    row(`${i18n.t("plans.missingAgent")} · notes`, nodeCause("type")),
    row("spare", nodeCause("port")),
    row(
      i18n.t("plans.panel.issueTitle.plan"),
      i18n.t("plans.validation.cycle"),
    ),
  ]);
});

it("joins different causes of one input in one row, wraps remote causes and names a failing asset", () => {
  const asset = { id: "a1", name: "spec.pdf", cause: "asset_too_large" };
  renderIssues({
    control: planControl({
      issues: [
        issue("named", "remoteParameter", "ticket"),
        issue("named", "remoteTicketUnavailable", "ticket"),
        issue("named", "remoteTicketUnavailable", "ticket"),
        { ...issue("unnamed", "agent"), asset },
      ],
    }),
  });
  const [joined, failing] = rows();

  expect(joined.textContent).toBe(
    row(
      "Reviewer · ticket",
      `${nodeCause("remoteParameter")} ${nodeCause("remoteTicketUnavailable")}`,
    ),
  );
  expect(joined.querySelectorAll("p")).toHaveLength(2);
  expect(failing.textContent).toBe(
    row(
      i18n.t("plans.missingAgent"),
      `${nodeCause("agent")} · ${i18n.t("plans.remoteAccess.assetFailure", {
        ...asset,
        cause: i18n.t("settings.agents.error.asset_too_large"),
      })}`,
    ),
  );
  expect(failing.querySelectorAll("p")).toHaveLength(1);
});

it("keeps one wrapping row when a local cause of the same input follows a remote one", () => {
  renderIssues({
    control: planControl({
      issues: [
        issue("named", "type", "ticket"),
        issue("named", "remoteParameter", "ticket"),
      ],
    }),
  });

  expect(rows()).toHaveLength(1);
  expect(rows()[0].querySelectorAll("p")).toHaveLength(2);
});

it("prefers the findings of a refused request over the stored ones and repeats no summary code", async () => {
  const scene = renderIssues({
    control: planControl({ issues: [issue("start", "flowOut")] }),
    code: "plan_invalid",
    answer: {
      ok: false,
      intent: "save-plan",
      error: "plan_invalid",
      issues: [issue("end", "flowIn")],
    },
  });
  expect(rows()).toHaveLength(1);

  await submitDraft(scene);

  expect(rows().map((entry) => entry.textContent)).toEqual([
    row(i18n.t("plans.nodeType.end"), nodeCause("flowIn")),
  ]);
});

it.each<[string, AgentPlanActionResult]>([
  ["an accepted request", { ok: true, intent: "save-plan" }],
  [
    "a refusal without findings",
    { ok: false, intent: "save-plan", error: "plan_conflict" },
  ],
])("keeps the stored findings after %s", async (name, answer) => {
  const scene = renderIssues({
    control: planControl({ issues: [issue("start", "flowOut")] }),
    answer,
  });

  await submitDraft(scene);

  expect(rows().map((entry) => entry.textContent)).toEqual([
    row(i18n.t("plans.nodeType.start"), nodeCause("flowOut")),
  ]);
});

it("names nodes their remote target cannot run, a whole frame member and an input without access", () => {
  const remote = { kind: "remote", workspaceId: "nas" } as const;
  renderIssues({
    nodes: [
      agent("remote", "reviewer", {
        executionTarget: remote,
        configuration: copyPlanConfiguration(REVIEWER),
      }),
      {
        id: "group",
        type: "group",
        name: "Review group",
        x: 0,
        y: 0,
        steps: [agent("member", "reviewer", { executionTarget: remote })],
        parameters: [],
        bindings: {},
      },
    ],
  });
  const [model, port, container] = rows();

  expect(model.textContent).toBe(
    row("Reviewer", i18n.t("plans.panel.issueCause.remoteModel")),
  );
  expect(model.querySelectorAll("p")).toHaveLength(1);
  expect(port.textContent).toBe(
    row(
      "Reviewer · ticket",
      i18n.t("plans.panel.issueCause.remotePagesUnavailable"),
    ),
  );
  expect(port.querySelectorAll("p")).toHaveLength(2);
  expect(container.textContent).toBe(
    row("Reviewer", i18n.t("plans.panel.issueCause.remoteContainer")),
  );
});

it.each([
  ["plan_remote_offline", "target"],
  ["plan_runner_old", "target"],
  ["workspace_missing", "workspace"],
  ["plan_context_lost", "workspace"],
  ["model_unavailable", "model"],
  ["acp_adapter_missing", "model"],
  ["plan_script_spawn", "script"],
  ["plan_pause_refused", "run"],
  ["plan_conflict", "plan"],
])("names the area a refusal %s concerns", (code, area) => {
  renderIssues({ nodes: [], code });

  expect(rows()[0].textContent).toBe(
    row(
      i18n.t(`plans.panel.issueTitle.${area}`),
      i18n.t(`settings.agents.error.${code}`, {
        defaultValue: i18n.t("plans.panel.error"),
      }),
    ),
  );
});

it("names a refusal after a failed run as the last run's, and an invalid plan without findings", () => {
  renderIssues({
    nodes: [],
    code: "plan_invalid",
    control: planControl({ status: "failed", canPlay: true }),
  });

  expect(rows()[0].textContent).toContain(
    i18n.t("plans.panel.issueTitle.lastRun"),
  );
});

it("shows nothing without findings", () => {
  renderTranslated(<PlanPanelIssueList issues={[]} />);

  expect(screen.queryByRole("list")).toBeNull();
});
