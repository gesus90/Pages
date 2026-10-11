// @vitest-environment jsdom
import {
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub, useLoaderData } from "react-router";
import { describe, expect, it } from "vitest";

import { PlanPage } from "@/app/components/agents/plans/plan-page";
import { AgentNavigation } from "@/app/components/settings/agents/agent-navigation";
import { createI18n } from "@/app/lib/i18n";
import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { emptyAgentPlan } from "@/definition/AgentPlan";

import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type {
  AgentPlanPage,
  AgentPlanRun,
  AgentPlanView,
} from "@/definition/AgentPlan";

function agent(
  id: string,
  name: string,
  isUsable = true,
): AgentDefinitionChoice {
  return {
    id,
    name,
    model: "model-a",
    reasoningEffort: "medium",
    provider: "openrouter",
    purposes: ["agent"],
    revision: 1,
    configuration: {
      ...emptyAgentConfiguration("system"),
      tag: "review",
      markdown: "{{input}} {{branch}}",
      parameters: [
        {
          name: "input",
          type: "text",
          description: "Task",
          isRequired: true,
          defaultValue: null,
        },
        {
          name: "branch",
          type: "text",
          description: "Branch",
          isRequired: false,
          defaultValue: null,
        },
      ],
    },
    availability: {
      isUsable,
      reason: isUsable ? null : "agent_inactive",
      personalChoices: [],
    },
  };
}

const workspace = {
  id: "workspace",
  name: "Development",
  projectId: "project",
  projectName: "Project",
  path: "/approved/copy",
  github: {
    repoUrl: "https://github.com/example/project",
    repoName: "example/project",
  },
  isUsable: true,
  reason: null,
} as const;

function savedPlan(): AgentPlanView {
  return {
    ...emptyAgentPlan(),
    id: "plan",
    name: "Build",
    ownerId: "bob",
    projectId: "project",
    workspaceId: workspace.id,
    projectName: workspace.projectName,
    github: workspace.github,
    revision: 1,
    canEdit: true,
  };
}

function page(overrides: Partial<AgentPlanPage> = {}): AgentPlanPage {
  const selected = savedPlan();
  return {
    userId: "bob",
    plans: [selected],
    selected,
    workspaces: [workspace],
    runs: [],
    sources: {
      agents: [
        agent("worker", "Worker"),
        agent("reviewer", "Reviewer"),
        agent("disabled", "Unavailable", false),
      ],
      tasks: [
        {
          id: "task",
          key: "P-1",
          title: "Implement",
          type: "task",
          parentId: "epic",
          statusName: "Open",
        },
        {
          id: "subtask",
          key: "P-2",
          title: "Test worker",
          type: "subtask",
          parentId: "task",
          statusName: "Review",
        },
      ],
    },
    ...overrides,
  };
}

function view(): AgentPlanRun {
  return {
    id: "run",
    planId: "plan",
    planName: "Build",
    planRevision: 1,
    userId: "bob",
    startedAt: "2026-10-11T14:00:00Z",
    status: "running",
    stopRequested: false,
    steps: [
      {
        id: "A",
        name: "Worker",
        status: "running",
        cancellation: "none",
        isBlocked: false,
        output: null,
        error: null,
      },
      {
        id: "B",
        name: "Reviewer",
        status: "waiting",
        cancellation: "none",
        isBlocked: false,
        output: null,
        error: null,
      },
    ],
  };
}

async function mount(
  initialPage: AgentPlanPage,
  respond?: (request: Request) => Promise<unknown>,
) {
  let currentPage = initialPage;
  const submitted: FormData[] = [];
  const Stub = createRoutesStub([
    {
      path: "/agents/plans",
      loader: () => currentPage,
      Component: () => {
        const loaded = useLoaderData<AgentPlanPage>();
        return (
          <>
            <AgentNavigation />
            <PlanPage
              key={`${loaded.selected?.id}:${loaded.selected?.revision}`}
              page={loaded}
            />
          </>
        );
      },
      action: async ({ request }) => {
        const fields = await request.clone().formData();
        submitted.push(fields);
        if (respond) return respond(request);
        if (fields.get("intent") === "save-plan") {
          const input: unknown = JSON.parse(String(fields.get("plan")));
          const selected = {
            ...savedPlan(),
            ...readPlanInput(input),
            revision: (currentPage.selected?.revision ?? 0) + 1,
          };
          currentPage = { ...currentPage, selected, plans: [selected] };
          return { ok: true, intent: "save-plan", planId: "plan" };
        }
        return { ok: true, intent: fields.get("intent"), run: view() };
      },
    },
    {
      path: "/agent-api/plan-sources",
      loader: () => ({
        workspaceId: workspace.id,
        sources: initialPage.sources,
      }),
    },
    {
      path: "/agent-api/plan-runs",
      loader: () => ({ ok: true, intent: "poll-run", run: view() }),
    },
  ]);
  const i18n = await createI18n("en");
  render(
    <I18nextProvider i18n={i18n}>
      <Stub initialEntries={["/agents/plans?planId=plan"]} />
    </I18nextProvider>,
  );
  await screen.findByRole("heading", { name: "Execution plan" });
  return submitted;
}

function drop(target: HTMLElement, payload: string, x = 154, y = 81): void {
  const event = createEvent.drop(target, {
    dataTransfer: { getData: () => payload },
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperties(event, {
    clientX: { value: x },
    clientY: { value: y },
  });
  fireEvent(target, event);
}

function submittedPlan(submitted: FormData[]) {
  const input: unknown = JSON.parse(String(submitted.at(-1)?.get("plan")));
  return readPlanInput(input);
}

describe("A10.4 navigation and graphical plan editing", () => {
  it("ignores malformed drops, filters unavailable sources and persists usage and global variable edits", async () => {
    const submitted = await mount(page());
    const user = userEvent.setup();
    const grid = screen.getByRole("region", { name: "Plan grid" });
    fireEvent.dragOver(grid);
    drop(grid, "agent:");
    drop(grid, "unknown:reference");
    expect(within(grid).queryByRole("article")).toBeNull();
    await user.click(screen.getByLabelText("Usable agents only"));
    expect(
      screen.queryByRole("button", { name: "Insert Unavailable" }),
    ).toBeNull();
    await user.click(screen.getByRole("combobox", { name: "Usage share" }));
    await user.click(screen.getByRole("option", { name: "Workspace users" }));
    let payload = "";
    fireEvent.dragStart(
      screen.getByRole("button", { name: "Insert variable branch" }),
      {
        dataTransfer: {
          setData: (_type: string, reference: string) => {
            payload = reference;
          },
        },
      },
    );
    expect(payload).toBe("variable:branch");
    await user.click(
      screen.getByRole("button", { name: "Insert variable branch" }),
    );
    const variable = within(grid).getByRole("article", { name: "branch" });
    await user.click(
      within(variable).getByRole("button", { name: "Value out" }),
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Insert Worker" }));
    const port = screen.getByRole("button", { name: "Bind input of Worker" });
    fireEvent.dragOver(port);
    drop(port, "node:");
    drop(port, "unknown:branch");
    drop(port, "node:missing");
    await user.click(
      within(variable).getByRole("button", { name: "Select branch" }),
    );
    let nodePayload = "";
    fireEvent.dragStart(
      within(variable).getByRole("button", { name: "Select branch" }),
      {
        dataTransfer: {
          setData: (_type: string, reference: string) => {
            nodePayload = reference;
          },
        },
      },
    );
    drop(port, nodePayload);
    await user.click(screen.getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submittedPlan(submitted)).toMatchObject({ usage: "workspace" });
  });

  it("selects previous own runs and sends Stop without serializing a draft", async () => {
    const running = view();
    const previous: AgentPlanRun = {
      ...running,
      id: "previous",
      startedAt: "previous",
      status: "succeeded",
    };
    const submitted = await mount(page({ runs: [running, previous] }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0].get("intent")).toBe("stop-plan");
    expect(submitted[0].get("runId")).toBe("run");
    expect(submitted[0].has("plan")).toBe(false);
    await user.click(screen.getByRole("combobox", { name: "Own run history" }));
    await user.click(
      screen.getByRole("option", { name: "previous · Succeeded" }),
    );
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("offers the required three ordered navigation links and an expandable Agents section", async () => {
    await mount(page());
    const user = userEvent.setup();
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Execution plan",
      "Workspace",
      "Agents list",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/agents/plans",
      "/agents/workspaces",
      "/settings/agents",
    ]);
    await user.click(screen.getByRole("button", { name: "Agents" }));
    expect(
      screen.queryByRole("link", { name: "Execution plan" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Agents" }));
    expect(screen.getByRole("link", { name: "Workspace" })).toBeVisible();
  });

  it("filters authorized agents and tasks independently, including subtasks and unusable agents", async () => {
    await mount(page());
    const user = userEvent.setup();
    expect(
      screen.getByRole("button", { name: "Insert Unavailable" }),
    ).toBeDisabled();
    await user.type(
      screen.getByRole("textbox", {
        name: "Filter agents by name, tag or model",
      }),
      "worker",
    );
    expect(
      screen.queryByRole("button", { name: "Insert Reviewer" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Insert P-1: Implement" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("combobox", { name: "Filter task type" }),
    );
    await user.click(screen.getByRole("option", { name: "Subtask" }));
    expect(
      screen.queryByRole("button", { name: "Insert P-1: Implement" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Insert P-2: Test worker" }),
    ).toBeVisible();
    await user.type(
      screen.getByRole("textbox", {
        name: "Filter tasks by key, title or status",
      }),
      "missing",
    );
    expect(
      screen.queryByRole("button", { name: "Insert P-2: Test worker" }),
    ).not.toBeInTheDocument();
  });

  it("drags agent/task/variable sources and node movement onto the grid, binds ports, connects flow and persists the graph", async () => {
    const submitted = await mount(page());
    const user = userEvent.setup();
    const grid = screen.getByRole("region", { name: "Plan grid" });
    let payload = "";
    fireEvent.dragStart(screen.getByRole("button", { name: "Insert Worker" }), {
      dataTransfer: {
        setData: (_type: string, next: string) => {
          payload = next;
        },
      },
    });
    expect(payload).toBe("agent:worker");
    drop(grid, payload);
    const worker = within(grid).getByRole("article", { name: "Worker" });
    expect(worker).toHaveStyle({ left: "160px", top: "80px" });
    expect(worker.className).toContain("bg-column-todo");
    drop(
      within(worker).getByRole("button", { name: "Bind input of Worker" }),
      "task:task",
    );
    expect(
      within(grid).getByRole("article", { name: "P-1: Implement" }).className,
    ).toContain("bg-column-done");
    await user.type(
      screen.getByRole("textbox", { name: "Value for branch" }),
      "task/A10",
    );
    drop(
      within(worker).getByRole("button", { name: "Bind branch of Worker" }),
      "variable:branch",
    );
    expect(
      within(grid).getByRole("article", { name: "branch" }).className,
    ).toContain("bg-column-review");
    await user.click(screen.getByRole("button", { name: "Insert Reviewer" }));
    await user.click(within(worker).getByRole("button", { name: "Flow out" }));
    await user.click(
      within(within(grid).getByRole("article", { name: "Reviewer" })).getByRole(
        "button",
        { name: "Flow in" },
      ),
    );
    fireEvent.dragStart(
      within(worker).getByRole("button", { name: "Select Worker" }),
      {
        dataTransfer: {
          setData: (_type: string, next: string) => {
            payload = next;
          },
        },
      },
    );
    drop(grid, payload, 401, 221);
    expect(worker).toHaveStyle({ left: "400px", top: "220px" });
    expect(screen.getByRole("combobox", { name: "Workspace" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    const saved = submittedPlan(submitted);
    const step = saved.nodes.find(
      (node) => node.type === "agent" && node.agentId === "worker",
    );
    expect(step).toMatchObject({
      x: 400,
      y: 220,
      bindings: { input: { kind: "source" }, branch: { kind: "source" } },
    });
    expect(saved.edges).toHaveLength(1);
    expect(saved.globals.branch).toBe("task/A10");
    expect(saved.nodes.map((node) => node.type).sort()).toEqual([
      "agent",
      "agent",
      "task",
      "variable",
    ]);
    expect(grid.querySelectorAll('path[stroke-dasharray="6 4"]')).toHaveLength(
      2,
    );
  });

  it("creates new plans, derives workspace context and protects unsaved navigation with the existing discard dialog", async () => {
    const initial = page();
    await mount({ ...initial, selected: null });
    const user = userEvent.setup();
    expect(
      screen.getByRole("button", { name: "Insert variable branch" }),
    ).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Name" }), "New plan");
    await user.click(screen.getByRole("combobox", { name: "Workspace" }));
    await user.click(screen.getByRole("option", { name: "Development" }));
    expect(screen.getByText(workspace.github.repoUrl)).toBeVisible();
    expect(screen.getByText("Project", { selector: "dd" })).toBeVisible();
    await screen.findByRole("button", { name: "Insert Worker" });
    await user.click(
      screen.getByRole("combobox", { name: "Choose saved plan" }),
    );
    await user.click(screen.getByRole("option", { name: "Build" }));
    expect(
      await screen.findByRole("dialog", { name: "Discard unsaved plan?" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "New plan",
    );
  });

  it("plays only a saved graph, shows waiting/running states and distinguishes requested/not-started cancellation", async () => {
    const selected = {
      ...savedPlan(),
      nodes: [
        {
          id: "A",
          type: "agent",
          agentId: "worker",
          personalAgentId: null,
          instruction: "",
          bindings: {},
          x: 20,
          y: 20,
        },
      ],
    } satisfies AgentPlanView;
    const running = view();
    const submitted = await mount(
      page({ selected, plans: [selected], runs: [running] }),
      async (request) => {
        const fields = await request.formData();
        return {
          ok: true,
          intent: fields.get("intent"),
          run: {
            ...running,
            stopRequested: true,
            steps: running.steps.map((step) => ({
              ...step,
              status: step.id === "A" ? "running" : "cancelled",
              cancellation: step.id === "A" ? "requested" : "not_started",
            })),
          },
        };
      },
    );
    const user = userEvent.setup();
    expect(
      screen.getByRole("progressbar", { name: "Progress" }),
    ).toHaveAttribute("value", "0");
    await user.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0].get("intent")).toBe("play-plan");
    expect(submitted[0].get("revision")).toBe("1");
    expect(submitted[0].has("plan")).toBe(false);
    expect(
      await screen.findByText("Cancellation requested; not confirmed yet."),
    ).toBeVisible();
    expect(screen.getByText("Cancelled before start.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Stop requested" }),
    ).toBeDisabled();
  });

  it("shows confirmed cancellation, blocked failure and final text safely in the run history", async () => {
    const running = view();
    const result: AgentPlanRun = {
      ...running,
      status: "failed",
      steps: [
        {
          ...running.steps[0],
          status: "cancelled",
          cancellation: "confirmed",
          output: "<script>safe final text</script>",
        },
        {
          ...running.steps[1],
          isBlocked: true,
          error: "plan_dependency_failed",
        },
      ],
    };
    await mount(page({ runs: [result] }));
    expect(screen.getByText("Cancellation confirmed by runner.")).toBeVisible();
    expect(screen.getByText("Waiting · blocked by predecessor")).toBeVisible();
    expect(screen.getByText("<script>safe final text</script>")).toBeVisible();
    expect(document.querySelector("script")).toBeNull();
    expect(
      screen.getByRole("progressbar", { name: "Progress" }),
    ).toHaveAttribute("value", "2");
  });
});
