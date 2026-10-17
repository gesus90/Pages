import { vi } from "vitest";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";

import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useLoaderData,
} from "react-router";
import { fireEvent, render } from "@testing-library/react";

import { PlanPage } from "@/app/components/agents/plans/plan-page";
import { createI18n } from "@/app/lib/i18n";
import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import type { RenderResult } from "@testing-library/react";
import type { AgentPlanOpening } from "@/app/lib/agent-plan-default";
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
  sources?: AgentPlanPage["sources"];
  readonly canEdit: boolean;
  readonly saved: AgentPlanInput[];
  /** An error code the next saves are refused with. */
  failure?: string;
}

/** The loader data of the plan route: the page and how the editor came to its plan. */
interface PlanRouteData extends AgentPlanPage {
  readonly opening: AgentPlanOpening;
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

function opening(isRequested: boolean, isSelected: boolean): AgentPlanOpening {
  if (isSelected) return "requested";
  return isRequested ? "requestedMissing" : "defaultMissing";
}

function page(server: PlanServer, request: Request): PlanRouteData {
  const plan = view(server);
  const isRequested = new URL(request.url).searchParams.get("planId") !== null;
  const isSelected = plan !== null && isRequested;
  return {
    opening: opening(isRequested, isSelected),
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
    sources: server.sources ?? SOURCES,
    runs: [],
    directory: { persons: [], groups: [], departments: [] },
  };
}

async function act(server: PlanServer, request: Request): Promise<unknown> {
  const form = await request.formData();
  if (server.failure)
    return { ok: false, intent: "save-plan", error: server.failure };
  const plan = readPlanInput(JSON.parse(String(form.get("plan"))) as unknown);
  const revision = (plan.revision ?? 0) + 1;
  server.saved.push(plan);
  server.plan = { ...plan, revision };
  return { ok: true, intent: "save-plan", planId: "plan", revision };
}

function Route(): React.ReactElement {
  const loaded = useLoaderData<PlanRouteData>();
  return (
    <PlanPage
      key={loaded.selected?.id ?? "new"}
      page={loaded}
      opening={loaded.opening}
    />
  );
}

/** Presses Ctrl+S, or Cmd+S as on macOS, where the focus is. */
export function pressSave(modifier: "ctrl" | "meta" = "ctrl"): void {
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "s",
    ctrlKey: modifier === "ctrl",
    metaKey: modifier === "meta",
  });
}

/** Collects the success toasts the page announces from now on. */
export function collectToasts(): readonly string[] {
  const messages: string[] = [];
  window.addEventListener("pages:success", (event) => {
    if (event instanceof CustomEvent) messages.push(String(event.detail));
  });
  return messages;
}

/**
 * Renders the plan page as opening a plan link does.
 *
 * @param server - The synthetic server state.
 * @param address - The address; without `planId` no plan is selected.
 */
export function renderPlanPage(
  server: PlanServer,
  address = "/agents/plans?planId=plan",
): RenderResult {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input), "http://pages.test");
    const source = (server.sources ?? SOURCES).agents.find(
      (entry) => entry.id === url.searchParams.get("agentId"),
    );
    return source
      ? Response.json(copyPlanConfiguration(source))
      : new Response(null, { status: 404 });
  });
  const router = createMemoryRouter(
    [
      {
        path: "/agents/plans",
        element: <Route />,
        loader: ({ request }) => page(server, request),
        action: ({ request }) => act(server, request),
      },
    ],
    { initialEntries: [address] },
  );
  return render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

/** Starts a server holding the synthetic plan. */
export function planServer(canEdit = true): PlanServer {
  return { plan: syntheticPlan(), canEdit, saved: [] };
}
