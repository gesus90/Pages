import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  redirect,
  RouterProvider,
  useLoaderData,
} from "react-router";
import { render } from "@testing-library/react";

import { PlanPage } from "@/app/components/agents/plans/plan-page";
import { createI18n } from "@/app/lib/i18n";
import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import type { RenderResult } from "@testing-library/react";
import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type {
  AgentPlanInput,
  AgentPlanPage,
  AgentPlanTask,
  AgentPlanView,
} from "@/definition/AgentPlan";
import type { AgentParameter } from "@/definition/AgentParameters";

export const i18n = createI18n("de");

const FLOW = { fromPort: "flow-out", toPort: "flow-in" } as const;

function agent(
  id: string,
  name: string,
  parameters: readonly AgentParameter[],
): AgentDefinitionChoice {
  return {
    id,
    name,
    model: "synthetic-free:free",
    reasoningEffort: null,
    provider: "openrouter",
    purposes: ["agent"],
    revision: 1,
    configuration: { ...emptyAgentConfiguration(), parameters },
    availability: { isUsable: true, reason: null, personalChoices: [] },
  };
}

function task(
  id: string,
  title: string,
  status: Pick<AgentPlanTask, "statusKey" | "statusName" | "isDone">,
): AgentPlanTask {
  return {
    id,
    key: `SYN-${id}`,
    title,
    type: "task",
    parentId: null,
    ...status,
  };
}

const TODO = { statusKey: "todo", statusName: "To Do", isDone: false };

export const SOURCES: AgentPlanPage["sources"] = {
  agents: [
    agent("reviewer", "Reviewer", [
      {
        name: "ticket",
        type: "ticket",
        description: "",
        isRequired: true,
        defaultValue: null,
      },
    ]),
    agent("writer", "Writer", [
      {
        name: "notes",
        type: "text",
        description: "",
        isRequired: false,
        defaultValue: null,
      },
    ]),
  ],
  tasks: [
    task("1", "Open work", TODO),
    task("2", "Ongoing", {
      statusKey: "progress",
      statusName: "In Progress",
      isDone: false,
    }),
    task("3", "Finished", {
      statusKey: "done",
      statusName: "Done",
      isDone: true,
    }),
    task("4", "Next work", TODO),
  ],
};

/** Start → Reviewer → Writer → End; a ticket feeds Reviewer, a spare value node is unconnected. */
export function syntheticPlan(): AgentPlanInput {
  return {
    name: "Synthetic plan",
    workspaceId: "workspace",
    projectId: "project",
    usage: "private",
    sharing: { isGlobal: false, targets: [], operator: "or" },
    globals: {},
    revision: 3,
    nodes: [
      { id: "start", type: "start", x: 0, y: 0 },
      {
        id: "first",
        type: "agent",
        x: 320,
        y: 0,
        agentId: "reviewer",
        personalAgentId: null,
        instruction: "",
        bindings: { ticket: { kind: "source", nodeId: "ticket" } },
      },
      {
        id: "second",
        type: "agent",
        x: 640,
        y: 0,
        agentId: "writer",
        personalAgentId: null,
        instruction: "",
        bindings: { notes: { kind: "result", stepId: "first" } },
      },
      { id: "end", type: "end", x: 960, y: 0 },
      { id: "ticket", type: "task", x: 0, y: 320, taskId: "1" },
      {
        id: "spare",
        type: "parameter",
        x: 640,
        y: 400,
        name: "spare",
        format: "string",
        value: { type: "text", text: "kept" },
      },
    ],
    edges: [
      { from: "start", to: "first", ...FLOW },
      { from: "first", to: "second", ...FLOW },
      { from: "second", to: "end", ...FLOW },
    ],
  };
}

/** Server state behind the synthetic loader and action. */
export interface PlanServer {
  plan: AgentPlanInput | null;
  readonly canEdit: boolean;
  readonly saved: AgentPlanInput[];
  readonly deleted: string[];
}

function view(server: PlanServer): AgentPlanView | null {
  if (!server.plan) return null;
  return {
    ...server.plan,
    id: "plan",
    ownerId: server.canEdit ? "owner" : "someone-else",
    projectId: "project",
    revision: server.plan.revision ?? 1,
    canEdit: server.canEdit,
    projectName: "Project",
    github: null,
  };
}

function page(server: PlanServer, request: Request): AgentPlanPage {
  const plan = view(server);
  const isSelected =
    plan !== null && new URL(request.url).searchParams.get("planId") !== null;
  return {
    userId: "owner",
    plans: plan ? [plan] : [],
    workspaces: [
      {
        id: "workspace",
        name: "Workspace",
        path: "/synthetic",
        projectId: "project",
        projectName: "Project",
        github: null,
        isUsable: true,
        reason: null,
      },
    ],
    selected: isSelected ? plan : null,
    sources: SOURCES,
    runs: [],
    directory: { persons: [], groups: [], departments: [] },
  };
}

async function act(server: PlanServer, request: Request): Promise<unknown> {
  const form = await request.formData();
  if (form.get("intent") === "delete-plan") {
    server.deleted.push(String(form.get("planId")));
    server.plan = null;
    return redirect("/agents/plans");
  }
  const plan = readPlanInput(JSON.parse(String(form.get("plan"))) as unknown);
  const revision = (plan.revision ?? 0) + 1;
  server.saved.push(plan);
  server.plan = { ...plan, revision };
  return { ok: true, intent: "save-plan", planId: "plan", revision };
}

function Route(): React.ReactElement {
  const loaded = useLoaderData<AgentPlanPage>();
  return <PlanPage key={loaded.selected?.id ?? "new"} page={loaded} />;
}

/** Renders the plan page with the plan selected, as opening it from the plan list does. */
export function renderPlanPage(server: PlanServer): RenderResult {
  const router = createMemoryRouter(
    [
      {
        path: "/agents/plans",
        element: <Route />,
        loader: ({ request }) => page(server, request),
        action: ({ request }) => act(server, request),
      },
    ],
    { initialEntries: ["/agents/plans?planId=plan"] },
  );
  return render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

/** Starts a server holding the synthetic plan. */
export function planServer(canEdit = true): PlanServer {
  return { plan: syntheticPlan(), canEdit, saved: [], deleted: [] };
}
