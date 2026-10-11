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
import { createRoutesStub } from "react-router";
import { beforeAll, describe, expect, it } from "vitest";

import { AgentProfiles } from "@/app/components/settings/agents/agent-profiles";
import { AgentStatus } from "@/app/components/settings/agents/agent-status";
import { createI18n } from "@/app/lib/i18n";
import { readAgentProfileInput } from "@/backend/service/agents/AgentProfileValidation";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { emptyModelCatalog } from "@/definition/AgentModelCatalog";
import { EMPTY_AGENT_FILTERS } from "@/definition/AgentFilters";

import { createAgentConnection, createCatalogModel } from "../helpers/agents";
import { installEditorGeometry } from "../helpers/editor";
import { planUiPage } from "../helpers/agent-plan-ui";

import type { AgentUsage } from "@/definition/AgentUsage";
import type { AgentFilters } from "@/definition/AgentFilters";

import type {
  AgentProfile,
  AgentProfileDirectory,
} from "@/definition/AgentProfile";

beforeAll(installEditorGeometry);

const connection = createAgentConnection({
  id: "access",
  name: "Google account one",
  checks: {
    auth: {
      status: "passed",
      errorCode: null,
      detail: {},
      checkedAt: "now",
      durationMs: 1,
    },
    model: null,
  },
});
const directory: AgentProfileDirectory = {
  persons: [
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob" },
  ],
  groups: [{ id: "team", name: "Team" }],
  departments: [{ id: "engineering", name: "Engineering" }],
};
const catalog = {
  ...emptyModelCatalog(),
  models: [
    createCatalogModel({
      id: "model-a",
      name: "Model A",
      reasoning: "levels",
      reasoningEfforts: ["low", "medium"],
    }),
    createCatalogModel({ id: "plain", name: "Plain" }),
  ],
};
const assigned: AgentProfile = {
  id: "profile",
  name: "Personal",
  connectionId: "access",
  model: "model-a",
  reasoningEffort: "medium",
  isActive: true,
  purposes: ["text", "chat", "agent"],
  targets: [{ kind: "person", targetId: "alice" }],
  revision: 1,
  configuration: {
    ...emptyAgentConfiguration(),
    markdown: "# Work\n\n{{goal}}\n",
    tag: "coding",
    sharing: { isGlobal: true, targets: [] },
    parameters: [
      {
        name: "goal",
        type: "text",
        description: "Goal",
        isRequired: true,
        defaultValue: null,
      },
    ],
  },
};

function story(
  options: {
    readonly profiles?: readonly AgentProfile[];
    readonly locale?: "en" | "de";
    readonly response?: Promise<Response> | Response;
    readonly usages?: readonly AgentUsage[];
    readonly filters?: AgentFilters;
  } = {},
): {
  readonly forms: FormData[];
  readonly user: ReturnType<typeof userEvent.setup>;
} {
  let profiles = options.profiles ?? [];
  const forms: FormData[] = [];
  const Stub = createRoutesStub([
    {
      path: "/settings/agents",
      loader: () => profiles,
      action: async ({ request }) => {
        const form = await request.formData();
        forms.push(form);
        if (options.response) return (await options.response).clone();
        const id = String(form.get("profileId")) || "new-profile";
        if (form.get("intent") === "profile-usages") {
          const profile = profiles.find((entry) => entry.id === id);
          return Response.json({
            ok: true,
            intent: "profile-usages",
            usages:
              options.usages ??
              profile?.targets.map((target) => ({
                kind: "assignment",
                target,
              })) ??
              [],
          });
        }
        profiles = profiles.filter((profile) => profile.id !== id);
        if (form.get("intent") === "save-profile") {
          const parsed: unknown = JSON.parse(String(form.get("profile")));
          profiles = [...profiles, { ...readAgentProfileInput(parsed), id }];
        }
        return Response.json({ ok: true, intent: String(form.get("intent")) });
      },
      Component: () => (
        <AgentProfiles
          profiles={profiles}
          connections={[connection]}
          catalogs={{ access: catalog }}
          directory={directory}
          filters={options.filters}
          projects={[{ id: "project", name: "Project" }]}
          workspaceChoices={planUiPage().workspaces}
          availability={{
            profile: {
              isUsable: false,
              reason: "personal_access_missing",
              personalChoices: [],
            },
          }}
        />
      ),
    },
  ]);
  render(
    <I18nextProvider i18n={createI18n(options.locale ?? "en")}>
      <Stub initialEntries={["/settings/agents"]} />
    </I18nextProvider>,
  );
  return { forms, user: userEvent.setup() };
}

async function choose(name: string, option: string): Promise<void> {
  const user = userEvent.setup();
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("combobox", { name }));
  await user.click(await screen.findByRole("option", { name: option }));
}

async function menu(name: string, action: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: `Actions for ${name}` }),
  );
  await user.click(screen.getByRole("menuitem", { name: action }));
}

function submittedProfile(
  form: FormData,
): ReturnType<typeof readAgentProfileInput> {
  const parsed: unknown = JSON.parse(String(form.get("profile")));
  return readAgentProfileInput(parsed);
}

describe("central agent administration", () => {
  it("edits parameter types, defaults, directory use and manual declarations without changing the access assignment", async () => {
    const { user, forms } = story({
      profiles: [
        {
          ...assigned,
          configuration: {
            ...assigned.configuration,
            ...emptyAgentConfiguration(),
            markdown: "",
            parameters: [
              {
                name: "goal",
                type: "text",
                description: "Goal",
                isRequired: true,
                defaultValue: null,
              },
              {
                name: "parameter_1",
                type: "text",
                description: "",
                isRequired: false,
                defaultValue: null,
              },
            ],
          },
        },
      ],
    });
    await menu("Personal", "Edit");
    await user.click(screen.getByRole("button", { name: "Add parameter" }));
    expect(
      screen
        .getAllByLabelText("Parameter name")
        .map((entry) => entry.getAttribute("value")),
    ).toEqual(["goal", "parameter_1", "parameter_2"]);
    const row = screen
      .getAllByLabelText("Parameter name")[0]
      .closest("fieldset");
    if (!row) throw new Error("Missing parameter row");
    fireEvent.change(within(row).getByLabelText("Description"), {
      target: { value: "Changed description" },
    });
    await user.click(within(row).getByLabelText("Required value"));
    await user.click(within(row).getByLabelText("Use default value"));
    fireEvent.change(within(row).getByLabelText("Default value"), {
      target: { value: "Default task" },
    });
    await user.click(within(row).getByLabelText("Use default value"));
    const parameterRow = row;
    async function type(option: string): Promise<void> {
      await user.click(
        within(parameterRow).getByRole("combobox", { name: "Type" }),
      );
      await user.click(screen.getByRole("option", { name: option }));
    }
    await type("Workspace reference");
    await user.click(
      within(row).getByRole("combobox", { name: "Default value" }),
    );
    await user.click(
      screen.getByRole("option", { name: "Development · Project" }),
    );
    await choose("Workspace parameter for the future start directory", "goal");
    await choose(
      "Workspace parameter for the future start directory",
      "No start directory from parameters",
    );
    await type("Wiki page reference");
    await type("Text");
    fireEvent.change(within(row).getByLabelText("Parameter name"), {
      target: { value: "renamed_goal" },
    });
    await user.click(
      screen.getByRole("button", { name: "Remove parameter parameter_1" }),
    );
    await user.click(screen.getByLabelText("Active"));
    await user.click(screen.getByRole("button", { name: "Save agent" }));
    await waitFor(() => expect(forms).toHaveLength(1));
    expect(submittedProfile(forms[0]).configuration?.parameters).toEqual([
      {
        name: "renamed_goal",
        type: "text",
        description: "Changed description",
        isRequired: false,
        defaultValue: null,
      },
      {
        name: "parameter_2",
        type: "text",
        description: "",
        isRequired: true,
        defaultValue: null,
      },
    ]);
    expect(submittedProfile(forms[0]).targets).toEqual(assigned.targets);
  });

  it("keeps usage sharing separate while changing project context and system purposes", async () => {
    const { user } = story({
      profiles: [
        {
          ...assigned,
          targets: [
            { kind: "system", targetId: "text" },
            { kind: "system", targetId: "agent" },
          ],
          configuration: {
            ...emptyAgentConfiguration("system"),
            markdown: "",
            parameters: [
              {
                name: "workspace",
                type: "workspace",
                description: "",
                isRequired: false,
                defaultValue: null,
              },
            ],
          },
        },
      ],
    });
    await menu("Personal", "Edit");
    const purposes = screen.getByRole("group", { name: "Purposes" });
    await user.click(within(purposes).getByLabelText("Text"));
    await user.click(within(purposes).getByLabelText("Text"));
    await choose("Project context", "Project");
    await choose("Project context", "Global");
    const sharing = screen.getByRole("heading", {
      name: "Usage sharing",
    }).parentElement;
    if (!sharing) throw new Error("Missing sharing section");
    await user.click(within(sharing).getByLabelText("Bob"));
    const profile = document.querySelector('input[name="profile"]');
    if (!(profile instanceof HTMLInputElement))
      throw new Error("Missing serialized profile");
    const parsed = readAgentProfileInput(JSON.parse(profile.value));
    expect(parsed.targets).toEqual([{ kind: "system", targetId: "agent" }]);
    expect(parsed.configuration?.sharing.targets).toEqual([
      { kind: "person", targetId: "bob" },
    ]);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Dirty draft" },
    });
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(
      await screen.findByRole("button", { name: "Discard changes" }),
    ).toBeVisible();
  });

  it("shows every deletion reference kind, including unavailable assignment names", async () => {
    const { user } = story({
      profiles: [assigned],
      usages: [
        { kind: "global" },
        { kind: "project", id: "project" },
        { kind: "plan", id: "build" },
        { kind: "legacy", id: "skills" },
        { kind: "assignment", target: { kind: "system", targetId: "agent" } },
        {
          kind: "sharing",
          target: { kind: "group", targetId: "missing-team" },
        },
      ],
    });
    await menu("Personal", "Remove");
    expect(
      await screen.findByText("Assignment: Agent execution"),
    ).toBeVisible();
    expect(screen.getByText(/missing-team/)).toBeVisible();
    expect(screen.getByText(/build/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
  });

  it("retains empty filtered state and updates submitted filters", async () => {
    const { user } = story({
      filters: { ...EMPTY_AGENT_FILTERS, search: "missing" },
    });
    expect(
      await screen.findByText("No agents match these filters."),
    ).toBeVisible();
    await user.click(screen.getByRole("combobox", { name: "Scope" }));
    await user.click(screen.getByRole("option", { name: "Groups" }));
    expect(document.querySelector('input[name="agent_scope"]')).toHaveValue(
      "group",
    );
    expect(screen.getAllByRole("link", { name: "Reset filters" })).toHaveLength(
      2,
    );
  });

  it("renders legacy scope fallbacks and an unavailable saved workspace default", async () => {
    const { user } = story({
      profiles: [
        { ...assigned, configuration: undefined },
        {
          ...assigned,
          id: "unassigned",
          name: "Unassigned",
          configuration: undefined,
          targets: [],
        },
        {
          ...assigned,
          id: "stale",
          name: "Stale default",
          configuration: {
            ...emptyAgentConfiguration(),
            parameters: [
              {
                name: "workspace",
                type: "workspace",
                description: "",
                isRequired: true,
                defaultValue: { type: "workspace", workspaceId: "gone" },
              },
            ],
          },
        },
      ],
    });
    expect(
      await screen.findByRole("rowheader", { name: "Unassigned" }),
    ).toBeVisible();
    await menu("Stale default", "Edit");
    expect(
      screen.getByRole("combobox", { name: "Default value" }),
    ).toHaveTextContent("Saved workspace is not accessible");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
  });

  it("creates from one connection's catalog, persists one scope and reopens the same definition", async () => {
    const { user, forms } = story();
    expect(await screen.findByText("No agents yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add agent" }));
    expect(screen.getByRole("button", { name: "Save agent" })).toBeDisabled();
    await user.type(screen.getByLabelText("Name"), "Named access");
    await choose("Connection", "Google account one (OpenAI API)");
    await choose("Model", "Model A (model-a)");
    await choose("Reasoning level", "medium");
    const targets = screen.getByRole("region", { name: "Assignments" });
    await user.click(within(targets).getByLabelText("Alice"));
    await user.type(screen.getByLabelText("Tag"), "coding");
    await user.click(
      screen.getByLabelText("Share the template with all active users"),
    );
    await user.click(screen.getByRole("button", { name: "Save agent" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(submittedProfile(forms[0])).toMatchObject({
      name: "Named access",
      connectionId: "access",
      model: "model-a",
      reasoningEffort: "medium",
      purposes: ["agent"],
      targets: [{ kind: "person", targetId: "alice" }],
      configuration: {
        scope: "person",
        tag: "coding",
        sharing: { isGlobal: true },
      },
    });
    await menu("Named access", "Edit");
    expect(screen.getByLabelText("Name")).toHaveValue("Named access");
    await choose("Model", "Plain (plain)");
    await user.click(screen.getByRole("button", { name: "Save agent" }));
    await waitFor(() => expect(forms).toHaveLength(2));
    expect(forms[1].get("profileId")).toBe("new-profile");
    expect(submittedProfile(forms[1]).reasoningEffort).toBeNull();
  });

  it("renders scoped and unavailable rows, shows current deletion uses, and deletes only an unused definition", async () => {
    const unused: AgentProfile = {
      ...assigned,
      id: "unused",
      name: "Unused",
      isActive: false,
      targets: [],
      configuration: emptyAgentConfiguration(),
    };
    const { user, forms } = story({
      profiles: [
        assigned,
        unused,
        {
          ...assigned,
          id: "missing",
          name: "Unavailable",
          connectionId: "removed",
          model: "gone",
          reasoningEffort: null,
          isActive: false,
          targets: [{ kind: "person", targetId: "deleted" }],
        },
      ],
    });
    expect(await screen.findByText("People: Alice")).toBeInTheDocument();
    expect(screen.getByText("People: deleted")).toBeInTheDocument();
    expect(screen.getByText("removed")).toBeInTheDocument();
    expect(
      screen.getByText(/matching personal model access/),
    ).toBeInTheDocument();
    await menu("Personal", "Edit");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(forms).toHaveLength(0);
    await menu("Personal", "Remove");
    expect(
      await screen.findByText("Assignment: People: Alice"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await menu("Unused", "Remove");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(screen.queryByRole("rowheader", { name: "Unused" })).toBeNull(),
    );
    expect(forms.at(-1)?.get("intent")).toBe("delete-profile");
    expect(forms.at(-1)?.get("profileId")).toBe("unused");
  });

  it("disables pending writes and displays safe server errors while retaining markdown and declarations", async () => {
    let finish: (response: Response) => void = () => undefined;
    const response = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const { user } = story({ profiles: [assigned], response });
    await menu("Personal", "Edit");
    expect(
      await screen.findByRole("textbox", {
        name: "Markdown base configuration",
      }),
    ).toHaveTextContent("{{goal}}");
    await user.click(screen.getByRole("button", { name: "Save agent" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeDisabled());
    await act(async () =>
      finish(Response.json({ ok: false, error: "profile_target_invalid" })),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose an existing assignment target.",
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Personal");
    expect(screen.getByLabelText("Parameter name")).toHaveValue("goal");
    expect(
      screen.getByRole("textbox", { name: "Markdown base configuration" }),
    ).toHaveTextContent("{{goal}}");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await menu("Personal", "Remove");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose an existing assignment target.",
    );
  });

  it("renders German labels and disables organizational assignments for System without turning usage sharing into a function assignment", async () => {
    const { user } = story({ locale: "de" });
    await user.click(
      await screen.findByRole("button", { name: "Agent hinzufügen" }),
    );
    await choose("Geltung", "System");
    const targets = screen.getByRole("region", { name: "Zuweisungen" });
    for (const label of ["Alice", "Team", "Engineering"])
      expect(within(targets).getByLabelText(label)).toBeDisabled();
    const system = within(targets).getByRole("group", { name: "System" });
    await user.click(
      screen.getByLabelText("Vorlage für alle aktiven Benutzer freigeben"),
    );
    expect(within(system).getByLabelText("Agent-Ausführung")).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
    expect(
      screen.getByRole("button", { name: "Agent speichern" }),
    ).toBeDisabled();
    const status = render(
      <I18nextProvider i18n={createI18n("de")}>
        <AgentStatus connection={{ ...connection, isActive: false }} />
      </I18nextProvider>,
    );
    expect(within(status.container).getByText("Inaktiv")).toBeInTheDocument();
  });

  it("allows stale assignments to be withdrawn as an inactive draft without clearing the template", async () => {
    const { user, forms } = story({
      profiles: [
        {
          ...assigned,
          targets: [{ kind: "person", targetId: "removed-person" }],
        },
      ],
    });
    await menu("Personal", "Edit");
    const targets = screen.getByRole("region", { name: "Assignments" });
    const removed = within(targets).getByLabelText("removed-person");
    expect(removed).toBeChecked();
    await user.click(removed);
    expect(screen.getByRole("button", { name: "Save agent" })).toBeDisabled();
    await user.click(screen.getByLabelText("Active"));
    await user.click(screen.getByRole("button", { name: "Save agent" }));
    await waitFor(() => expect(forms).toHaveLength(1));
    expect(submittedProfile(forms[0])).toMatchObject({
      isActive: false,
      targets: [],
      configuration: {
        markdown: assigned.configuration?.markdown,
        parameters: assigned.configuration?.parameters,
      },
    });
  });

  it("requires discovered parameters to be confirmed and protects unsaved changes", async () => {
    const { user, forms } = story({
      profiles: [
        {
          ...assigned,
          configuration: { ...emptyAgentConfiguration(), markdown: "{{goal}}" },
        },
      ],
    });
    await menu("Personal", "Edit");
    expect(screen.getByRole("button", { name: "Save agent" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Confirm parameter" }));
    expect(screen.getByLabelText("Parameter name")).toHaveValue("goal");
    expect(screen.getByRole("button", { name: "Save agent" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("dialog", { name: "Discard changes?" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(forms).toHaveLength(0);
  });
});
