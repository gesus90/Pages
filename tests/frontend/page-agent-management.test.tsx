// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub, Link } from "react-router";
import { beforeAll, describe, expect, it } from "vitest";

import { PageAgentPageView } from "@/app/components/agents/definitions/page-agent-page";
import { ErrorBoundary } from "@/app/routes/page-agents";
import { createI18n } from "@/app/lib/i18n";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { installEditorGeometry } from "../helpers/editor";

import type { PageAgentPage } from "@/definition/PageAgent";

beforeAll(installEditorGeometry);

function page(): PageAgentPage {
  return {
    isAdministrator: false,
    agents: [],
    models: [
      {
        id: "admin-model",
        name: "Approved",
        model: "model-a",
        reasoningEfforts: ["low", "medium"],
        reasoningEffort: "medium",
      },
    ],
    workspaces: [],
    directory: {
      persons: [],
      groups: [
        { id: "team", name: "Team" },
        { id: "qa", name: "QA" },
      ],
      departments: [{ id: "engineering", name: "Engineering" }],
    },
  };
}

async function mount(
  proposed: PageAgentPage,
  action?: (request: Request) => Promise<unknown>,
): Promise<void> {
  const i18n = await createI18n("en");
  const Stub = createRoutesStub([
    {
      path: "/agents/agents",
      Component: () => <PageAgentPageView page={proposed} />,
      action: action ? ({ request }) => action(request) : undefined,
    },
  ]);
  render(
    <I18nextProvider i18n={i18n}>
      <Stub initialEntries={["/agents/agents"]} />
    </I18nextProvider>,
  );
  await screen.findByRole("heading", { name: "Agents list", level: 1 });
}

describe("PAGE-20 user agent management UI", () => {
  it("creates with a private default, chooses approved reasoning and submits instruction and existing parameter controls", async () => {
    const submitted: FormData[] = [];
    await mount(page(), async (request) => {
      submitted.push(await request.formData());
      return { ok: true, intent: "save-agent" };
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Create agent" }));
    expect(screen.getByRole("combobox", { name: "Sharing" })).toHaveTextContent(
      "Private",
    );
    await user.type(screen.getByLabelText("Name"), "Tests");
    await user.click(screen.getByRole("combobox", { name: "Reasoning" }));
    await user.click(screen.getByRole("option", { name: "low" }));
    await user.click(screen.getByRole("button", { name: "Add parameter" }));
    expect(screen.getByDisplayValue("parameter_1")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    const definition: unknown = JSON.parse(String(submitted[0].get("agent")));
    expect(definition).toMatchObject({
      name: "Tests",
      modelProfileId: "admin-model",
      reasoningEffort: "low",
      configuration: {
        markdown: "",
        sharing: { isGlobal: false, targets: [] },
        parameters: [{ name: "parameter_1", type: "text" }],
      },
    });
    expect(JSON.stringify(definition)).not.toMatch(
      /apiKey|connectionId|credentials/u,
    );
    await waitFor(() => expect(screen.queryByLabelText("Name")).toBeNull());
  });

  it("preserves revision and allows multiple groups and departments with AND, retaining a rejected save", async () => {
    const proposed = page();
    const existing = {
      id: "agent",
      ownerId: "bob",
      name: "Existing",
      canEdit: true,
      modelProfileId: "admin-model",
      model: "model-a",
      reasoningEffort: "medium",
      revision: 3,
      hasDeletedTargets: false,
      availability: { isUsable: true, reason: null, personalChoices: [] },
      configuration: { ...emptyAgentConfiguration(), accessMode: "shared" },
    } as const;
    const submitted: FormData[] = [];
    await mount({ ...proposed, agents: [existing] }, async (request) => {
      submitted.push(await request.formData());
      return { ok: false, intent: "save-agent", error: "profile_conflict" };
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("combobox", { name: "Sharing" }));
    await user.click(screen.getByRole("option", { name: "Restricted" }));
    await user.click(screen.getByLabelText("Team"));
    await user.click(screen.getByLabelText("QA"));
    await user.click(screen.getByLabelText("Engineering"));
    await user.click(screen.getByRole("combobox", { name: "Target matching" }));
    await user.click(
      screen.getByRole("option", { name: "AND – every target" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    const definition: unknown = JSON.parse(String(submitted[0].get("agent")));
    expect(definition).toMatchObject({
      revision: 3,
      configuration: {
        sharing: {
          isGlobal: false,
          operator: "and",
          targets: [
            { kind: "group", targetId: "team" },
            { kind: "group", targetId: "qa" },
            { kind: "department", targetId: "engineering" },
          ],
        },
      },
    });
    expect(screen.getByLabelText("Name")).toHaveValue("Existing");
  });

  it("offers shared agents read-only and disables creation without a current model grant", async () => {
    const proposed = page();
    await mount({
      ...proposed,
      models: [],
      agents: [
        {
          id: "agent",
          ownerId: "alice",
          name: "Shared",
          canEdit: false,
          modelProfileId: "admin-model",
          model: "model-a",
          reasoningEffort: "medium",
          revision: 1,
          hasDeletedTargets: false,
          availability: {
            isUsable: false,
            reason: "agent_usage_denied",
            personalChoices: [],
          },
          configuration: {
            ...emptyAgentConfiguration(),
            sharing: { isGlobal: true, targets: [] },
          },
        },
      ],
    });
    expect(screen.getByRole("button", { name: "Create agent" })).toBeDisabled();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View" }));
    expect(screen.getByLabelText("Name")).toBeDisabled();
    // Someone who only reads the agent is not told to replace its model.
    expect(screen.queryByText(/no longer released for you/u)).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Sharing" })).toBeDisabled();
  });
});

function listed(
  overrides: Partial<PageAgentPage["agents"][number]> = {},
): PageAgentPage["agents"][number] {
  return {
    id: "agent",
    ownerId: "bob",
    name: "Nightly checks",
    canEdit: true,
    modelProfileId: "admin-model",
    model: "model-a",
    reasoningEffort: null,
    revision: 1,
    hasDeletedTargets: false,
    availability: { isUsable: true, reason: null, personalChoices: [] },
    configuration: { ...emptyAgentConfiguration(), accessMode: "shared" },
    ...overrides,
  };
}

describe("PAGE-20 agent list and form states", () => {
  it("shows model, reasoning, sharing and why an agent cannot run", async () => {
    const base = page();
    await mount({
      ...base,
      agents: [
        listed({ name: "Private one" }),
        listed({
          id: "shared",
          name: "Shared one",
          reasoningEffort: "low",
          configuration: {
            ...emptyAgentConfiguration(),
            sharing: { isGlobal: true, targets: [] },
          },
        }),
        listed({
          id: "team",
          name: "Team one",
          availability: {
            isUsable: false,
            reason: "agent_usage_denied",
            personalChoices: [],
          },
          configuration: {
            ...emptyAgentConfiguration(),
            sharing: {
              isGlobal: false,
              targets: [{ kind: "group", targetId: "team" }],
            },
          },
        }),
        listed({
          id: "model",
          name: "Model gone",
          availability: {
            isUsable: false,
            reason: "modelUnavailable",
            personalChoices: [],
          },
        }),
      ],
    });
    const row = (name: string): HTMLElement => {
      const cell = screen.getByRole("rowheader", { name });
      const container = cell.closest("tr");
      if (!container) throw new Error("Missing row");
      return container;
    };
    expect(row("Private one")).toHaveTextContent("Default");
    expect(row("Private one")).toHaveTextContent("Private");
    expect(row("Private one")).toHaveTextContent("Ready");
    expect(row("Shared one")).toHaveTextContent("Global");
    expect(row("Shared one")).toHaveTextContent("low");
    expect(row("Team one")).toHaveTextContent("Restricted");
    expect(row("Team one")).toHaveTextContent(
      "No usage share or authorized access in the selected project context.",
    );
    expect(row("Model gone")).toHaveTextContent(
      "The configured model is absent from the available catalog.",
    );
  });

  it("asks before it discards a draft and closes without asking when nothing changed", async () => {
    await mount(page());
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Create agent" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByLabelText("Name")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Create agent" }));
    await user.type(screen.getByLabelText("Name"), "Draft");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    const discard = await screen.findByRole("dialog", {
      name: "Discard changes?",
    });
    await user.click(within(discard).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Discard changes?" }),
      ).toBeNull(),
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Draft");
    await user.keyboard("{Escape}");
    const again = await screen.findByRole("dialog", {
      name: "Discard changes?",
    });
    await user.click(
      within(again).getByRole("button", { name: "Discard changes" }),
    );
    await waitFor(() => expect(screen.queryByLabelText("Name")).toBeNull());
  });

  it("disables creation and says why while no authorized admin model exists", async () => {
    await mount({ ...page(), models: [] });
    expect(screen.getByRole("status")).toHaveTextContent(
      "No authorized admin model is available.",
    );
    expect(screen.getByText("No visible agents.")).toBeVisible();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Create agent" }));
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("keeps save closed until the name, the model and the parameters are valid", async () => {
    await mount({
      ...page(),
      agents: [listed({ modelProfileId: "withdrawn" })],
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const save = screen.getByRole("button", { name: "Save" });
    // The model grant of this agent is gone, so another one has to be chosen.
    expect(save).toBeDisabled();
    expect(screen.getByText(/no longer released for you/u)).toBeVisible();
    await user.click(screen.getByRole("combobox", { name: "Admin model" }));
    await user.click(
      screen.getByRole("option", { name: "Approved · model-a" }),
    );
    expect(save).toBeEnabled();
    expect(screen.queryByText(/no longer released for you/u)).toBeNull();
    await user.clear(screen.getByLabelText("Name"));
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText("Name"), "Renamed");
    expect(save).toBeEnabled();
    // Two parameters with one name cannot be saved.
    await user.click(screen.getByRole("button", { name: "Add parameter" }));
    await user.click(screen.getByRole("button", { name: "Add parameter" }));
    const second = screen.getByDisplayValue("parameter_2");
    await user.clear(second);
    await user.type(second, "parameter_1");
    expect(save).toBeDisabled();
  });

  it("shows a loading state while the list is being reloaded", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const i18n = await createI18n("en");
    const Stub = createRoutesStub([
      {
        path: "/agents/agents",
        loader: async ({ request }) => {
          if (new URL(request.url).searchParams.has("reload")) await gate;
          return null;
        },
        Component: () => (
          <>
            <Link to="?reload=1">Reload</Link>
            <PageAgentPageView page={{ ...page(), agents: [listed()] }} />
          </>
        ),
      },
    ]);
    render(
      <I18nextProvider i18n={i18n}>
        <Stub initialEntries={["/agents/agents"]} />
      </I18nextProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Reload" }));
    expect(
      await screen.findByRole("status", { name: "Loading agents" }),
    ).toBeVisible();
    release();
    await waitFor(() =>
      expect(
        screen.queryByRole("status", { name: "Loading agents" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Nightly checks")).toBeVisible();
  });
});

describe("PAGE-20 failure state of the agent list", () => {
  async function mountFailing(status: number): Promise<() => number> {
    let loads = 0;
    const i18n = await createI18n("en");
    const Stub = createRoutesStub([
      {
        path: "/agents/agents",
        loader: () => {
          loads += 1;
          if (loads === 1) throw new Response("failure", { status });
          return null;
        },
        Component: () => <PageAgentPageView page={page()} />,
        ErrorBoundary,
      },
    ]);
    render(
      <I18nextProvider i18n={i18n}>
        <Stub initialEntries={["/agents/agents"]} />
      </I18nextProvider>,
    );
    return () => loads;
  }

  it("keeps the page chrome, says that loading failed and retries on request", async () => {
    const loads = await mountFailing(500);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The agents could not be loaded.",
    );
    expect(
      screen.getByRole("heading", { name: "Agents list", level: 1 }),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("No visible agents.");
    expect(loads()).toBe(2);
  });

  it("offers no retry when access was refused", async () => {
    await mountFailing(403);
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("PAGE-20 share with a deleted target", () => {
  it("tells the owner that a target is gone and a reader nothing of it", async () => {
    await mount({
      ...page(),
      agents: [
        listed({ hasDeletedTargets: true }),
        listed({
          id: "shared",
          name: "Shared with me",
          canEdit: false,
          hasDeletedTargets: true,
        }),
      ],
    });
    const user = userEvent.setup();
    const [edit] = screen.getAllByRole("button", { name: "Edit" });
    await user.click(edit);
    expect(screen.getByText(/no longer exists/u)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByLabelText("Name")).toBeNull());
    await user.click(screen.getByRole("button", { name: "View" }));
    expect(screen.queryByText(/no longer exists/u)).toBeNull();
  });
});

describe("PAGE-20 link to the central administration", () => {
  it("offers administrators the way to the agent management and nobody else", async () => {
    await mount({ ...page(), isAdministrator: true });
    expect(
      screen.getByRole("link", { name: "Agent management" }),
    ).toHaveAttribute("href", "/settings/agents");
  });

  it("does not show the link to people without administration", async () => {
    await mount(page());
    expect(screen.queryByRole("link", { name: "Agent management" })).toBeNull();
  });
});

describe("PAGE-20 form controls", () => {
  it("switches between private, global and restricted and keeps targets only while restricted", async () => {
    const submitted: FormData[] = [];
    await mount(page(), async (request) => {
      submitted.push(await request.formData());
      return { ok: true, intent: "save-agent" };
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Create agent" }));
    await user.type(screen.getByLabelText("Name"), "Shared");
    const sharing = screen.getByRole("combobox", { name: "Sharing" });
    await user.click(sharing);
    await user.click(screen.getByRole("option", { name: "Restricted" }));
    await user.click(screen.getByLabelText("Team"));
    await user.click(sharing);
    await user.click(screen.getByRole("option", { name: "Private" }));
    expect(screen.queryByLabelText("Team")).toBeNull();
    await user.click(sharing);
    await user.click(screen.getByRole("option", { name: "Restricted" }));
    expect(screen.getByLabelText("Team")).not.toBeChecked();
    await user.click(sharing);
    await user.click(screen.getByRole("option", { name: "Global" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    const definition: unknown = JSON.parse(String(submitted[0].get("agent")));
    expect(definition).toMatchObject({
      configuration: { sharing: { isGlobal: true, targets: [] } },
    });
  });

  it("resets the reasoning to the default of the chosen model and fixes it for a model without levels", async () => {
    const submitted: FormData[] = [];
    const base = page();
    await mount(
      {
        ...base,
        models: [
          ...base.models,
          {
            id: "plain-model",
            name: "Plain",
            model: "model-b",
            reasoningEfforts: [],
            reasoningEffort: null,
          },
        ],
      },
      async (request) => {
        submitted.push(await request.formData());
        return { ok: true, intent: "save-agent" };
      },
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Create agent" }));
    await user.type(screen.getByLabelText("Name"), "Plain agent");
    const reasoning = screen.getByRole("combobox", { name: "Reasoning" });
    expect(reasoning).toHaveTextContent("medium");
    await user.click(reasoning);
    await user.click(screen.getByRole("option", { name: "low" }));
    expect(reasoning).toHaveTextContent("low");
    await user.click(screen.getByRole("combobox", { name: "Admin model" }));
    await user.click(screen.getByRole("option", { name: "Plain · model-b" }));
    expect(reasoning).toHaveTextContent("Default");
    expect(reasoning).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(JSON.parse(String(submitted[0].get("agent")))).toMatchObject({
      modelProfileId: "plain-model",
      reasoningEffort: null,
    });
  });

  it("keeps the form open when it is dismissed while a save is running", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mount(page(), async () => {
      await gate;
      return { ok: true, intent: "save-agent" };
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Create agent" }));
    await user.type(screen.getByLabelText("Name"), "Slow");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled(),
    );
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("Name")).toBeVisible();
    release();
    await waitFor(() => expect(screen.queryByLabelText("Name")).toBeNull());
  });
});
