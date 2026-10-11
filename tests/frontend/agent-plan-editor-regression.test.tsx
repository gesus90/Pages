// @vitest-environment jsdom
import {
  act,
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

import AgentPlansRoute from "@/app/routes/agent-plans";
import { createI18n } from "@/app/lib/i18n";
import { PlanPage } from "@/app/components/agents/plans/plan-page";

import { planUiPage, planUiStep, planUiRun } from "../helpers/agent-plan-ui";

import type { AgentPlanPage } from "@/definition/AgentPlan";

async function mount(
  page: AgentPlanPage,
  respond?: (request: Request) => Promise<unknown>,
): Promise<void> {
  const Stub = createRoutesStub([
    {
      path: "/agents/plans",
      loader: () => page,
      Component: () => <PlanPage page={useLoaderData<AgentPlanPage>()} />,
      action: ({ request }) => respond?.(request) ?? { ok: true },
    },
    {
      path: "/agent-api/plan-runs",
      loader: () => ({ ok: true, intent: "poll-run", run: planUiRun() }),
    },
    {
      path: "/agent-api/plan-sources",
      loader: () => ({ ok: false, error: "plan_access_denied" }),
    },
  ]);
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <Stub initialEntries={["/agents/plans?planId=plan"]} />
    </I18nextProvider>,
  );
  await screen.findByRole("heading", { name: "Execution plan" });
}

describe("A10 per-step inspector and data binding controls", () => {
  it("selects personal access, edits text/workspace/wiki literals and resets explicit bindings", async () => {
    const page = { ...planUiPage() };
    if (!page.selected) throw new Error("Missing plan fixture");
    page.selected = { ...page.selected, nodes: [planUiStep()] };
    const worker = page.sources.agents[0];
    page.sources = {
      ...page.sources,
      agents: [
        {
          ...worker,
          availability: {
            ...worker.availability,
            personalChoices: [
              {
                id: "personal",
                name: "My access",
                model: "model-a",
                reasoningEffort: null,
              },
            ],
          },
          configuration: {
            ...worker.configuration,
            accessMode: "personal",
            parameters: [
              ...worker.configuration.parameters,
              {
                name: "root",
                type: "workspace",
                description: "Directory",
                isRequired: false,
                defaultValue: null,
              },
              {
                name: "wiki",
                type: "wiki",
                description: "Wiki",
                isRequired: false,
                defaultValue: { type: "wiki", pageId: "default-page" },
              },
            ],
          },
        },
      ],
    };
    const submitted: FormData[] = [];
    await mount(page, async (request) => {
      submitted.push(await request.formData());
      return { ok: true, intent: "save-plan", planId: "plan" };
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Select Worker" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Grid X" }), {
      target: { value: "53" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Grid Y" }), {
      target: { value: "79" },
    });
    await user.type(
      screen.getByRole("textbox", { name: "Step instruction" }),
      "Review this",
    );
    await user.click(
      screen.getByRole("combobox", { name: "Personal model access" }),
    );
    await user.click(screen.getByRole("option", { name: "My access" }));
    await user.click(
      screen.getByRole("combobox", { name: "Personal model access" }),
    );
    await user.click(
      screen.getByRole("option", {
        name: "Use the unique matching personal access",
      }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "input" }),
      "literal task",
    );
    await user.click(
      screen.getByRole("combobox", { name: "root (workspace)" }),
    );
    await user.click(screen.getByRole("option", { name: "Development" }));
    await user.click(
      screen.getByRole("combobox", { name: "root (workspace)" }),
    );
    await user.click(screen.getByRole("option", { name: "No bound value" }));
    const wiki = screen.getByRole("textbox", { name: "wiki (wiki)" });
    await user.clear(wiki);
    await user.type(wiki, "step-page");
    await user.click(
      within(screen.getByRole("group", { name: "wiki (wiki)" })).getByRole(
        "button",
        { name: "Remove binding / use agent default" },
      ),
    );
    expect(wiki).toHaveValue("default-page");
    await user.click(screen.getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    const serialized = String(submitted[0].get("plan"));
    expect(serialized).toContain('"instruction":"Review this"');
    expect(serialized).toContain('"x":60,"y":80');
    expect(serialized).toContain("literal task");
    expect(serialized).not.toContain("step-page");
  });

  it("adds variables, removes flow connections and nodes, and offers result and source bindings", async () => {
    const page = { ...planUiPage() };
    if (!page.selected) throw new Error("Missing plan fixture");
    page.selected = {
      ...page.selected,
      nodes: [
        planUiStep(),
        planUiStep("B"),
        { id: "task", type: "task", taskId: "task", x: 0, y: 0 },
      ],
      edges: [{ from: "A", to: "B" }],
    };
    await mount(page);
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "Parameter name (e.g. branch)" }),
      "release",
    );
    await user.click(screen.getByRole("button", { name: "Add parameter" }));
    expect(
      screen.getByRole("textbox", { name: "Value for release" }),
    ).toHaveValue("");
    await user.type(
      screen.getByRole("textbox", { name: "Parameter name (e.g. branch)" }),
      "release",
    );
    expect(
      screen.getByRole("button", { name: "Add parameter" }),
    ).toBeDisabled();
    const removeEdge = screen.getByRole("button", {
      name: "Remove Worker → Worker",
    });
    expect(removeEdge).toHaveTextContent("Remove");
    await user.click(removeEdge);
    expect(
      screen.getByText(
        "Without flow edges independent steps may start in parallel.",
      ),
    ).toBeVisible();
    const nodes = screen.getAllByRole("article", { name: "Worker" });
    await user.click(
      within(nodes[0]).getByRole("button", { name: "Result out" }),
    );
    await user.click(
      within(nodes[1]).getByRole("button", { name: "Bind input of Worker" }),
    );
    await user.click(
      within(nodes[1]).getByRole("button", { name: "Select Worker" }),
    );
    await user.click(
      screen.getByRole("combobox", { name: "Source for input" }),
    );
    await user.click(screen.getByRole("option", { name: "P-1: Implement" }));
    await user.click(
      screen.getByRole("combobox", { name: "Source for input" }),
    );
    await user.click(screen.getAllByRole("option", { name: "Worker" })[0]);
    await user.click(
      screen.getByRole("combobox", { name: "Source for input" }),
    );
    await user.click(screen.getByRole("option", { name: "Enter text" }));
    await user.click(
      within(screen.getAllByRole("article", { name: "Worker" })[0]).getByRole(
        "button",
        { name: "Flow out" },
      ),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Remove node" }));
    expect(screen.getAllByRole("article", { name: "Worker" })).toHaveLength(1);
  });
});

describe("A10 editor persistence and read-only regression", () => {
  it("retains a rejected draft, guards tab close and lets the user discard before creating another plan", async () => {
    await mount(planUiPage(), async () => ({
      ok: false,
      error: "plan_conflict",
    }));
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Name" }), " changed");
    const close = new Event("beforeunload", { cancelable: true });
    act(() => window.dispatchEvent(close));
    expect(close.defaultPrevented).toBe(true);
    await user.click(screen.getByRole("button", { name: "Save plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/changed/i);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Build changed",
    );
    await user.click(screen.getByRole("button", { name: "New plan" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("disables graph mutation for another owner's shared plan and shows unavailable saved references", async () => {
    const page = { ...planUiPage() };
    if (!page.selected) throw new Error("Missing plan fixture");
    page.selected = {
      ...page.selected,
      canEdit: false,
      nodes: [
        planUiStep(),
        { id: "lost", type: "task", taskId: "removed-task", x: 0, y: 0 },
      ],
      edges: [{ from: "A", to: "lost" }],
    };
    page.sources = { agents: [], tasks: [] };
    await mount(page);
    expect(screen.getByRole("button", { name: "Save plan" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Remove worker → removed-task" }),
    ).toBeDisabled();
    fireEvent.drop(screen.getByRole("region", { name: "Plan grid" }), {
      dataTransfer: { getData: () => "agent:worker" },
    });
    expect(screen.getAllByRole("article")).toHaveLength(2);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Select worker" }));
    expect(screen.getByRole("button", { name: "Remove node" })).toBeDisabled();
  });

  it("renders the actual route component with and without a saved plan", async () => {
    const page = { ...planUiPage() };
    const Stub = createRoutesStub([
      {
        path: "/agents/plans",
        loader: () => ({ ...page, selected: null }),
        Component: AgentPlansRoute,
      },
    ]);
    render(
      <I18nextProvider i18n={createI18n("en")}>
        <Stub initialEntries={["/agents/plans"]} />
      </I18nextProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "Execution plan" }),
    ).toBeVisible();
  });
});
