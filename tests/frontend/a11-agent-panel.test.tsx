// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub } from "react-router";
import { beforeAll, describe, expect, it, vi } from "vitest";

const pending = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/app/components/users/use-management-pending", () => ({
  useManagementPending: pending,
}));

import { CatalogDeleteDialog } from "@/app/components/users/catalog-delete-dialog";
import { createI18n } from "@/app/lib/i18n";
import SettingsAgentsRoute from "@/app/routes/settings-agents";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { EMPTY_AGENT_FILTERS } from "@/definition/AgentFilters";
import { emptyModelCatalog } from "@/definition/AgentModelCatalog";

import {
  CLI_LOCATIONS,
  createAgentConnection,
  createCatalogModel,
} from "../helpers/agents";
import { installEditorGeometry } from "../helpers/editor";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type { UsersActionData } from "@/app/lib/user-actions/user-action-support.server";
import type { AgentProfile } from "@/definition/AgentProfile";

beforeAll(installEditorGeometry);

const connection = createAgentConnection({ id: "access" });
const systemAgent: AgentProfile = {
  id: "system",
  name: "System writer",
  connectionId: "access",
  model: "model-a",
  reasoningEffort: "medium",
  isActive: true,
  purposes: ["text", "chat"],
  targets: [{ kind: "system", targetId: "text" }],
  revision: 1,
  configuration: emptyAgentConfiguration("system"),
};
const personalAgent: AgentProfile = {
  ...systemAgent,
  id: "personal",
  name: "Personal worker",
  purposes: ["agent"],
  targets: [{ kind: "person", targetId: "alice" }],
  configuration: emptyAgentConfiguration("person"),
};

function renderPanel(
  onAction: (form: FormData) => AgentActionResult = (form) => ({
    ok: true,
    intent: String(form.get("intent")),
  }),
): ReturnType<typeof userEvent.setup> {
  const Stub = createRoutesStub([
    {
      path: "/settings/agents",
      Component: SettingsAgentsRoute,
      loader: () => ({
        access: "granted",
        connections: [connection],
        cliTools: CLI_LOCATIONS,
        catalogs: {
          access: {
            ...emptyModelCatalog(),
            models: [
              createCatalogModel({
                id: "model-a",
                name: "Model A",
                reasoning: "levels",
                reasoningEfforts: ["low", "medium"],
              }),
            ],
          },
        },
        assistantSettings: { role: null, retentionDays: 30 },
        assignments: [],
        profiles: [systemAgent, personalAgent],
        profileDirectory: {
          persons: [{ id: "alice", name: "Alice" }],
          groups: [{ id: "team", name: "Team" }],
          departments: [{ id: "engineering", name: "Engineering" }],
        },
        workspaceChoices: [],
        availability: {
          system: { isUsable: true, reason: null, personalChoices: [] },
          personal: {
            isUsable: false,
            reason: "personal_access_missing",
            personalChoices: [],
          },
        },
        filters: EMPTY_AGENT_FILTERS,
        projects: [],
        taskAssignments: {
          system: [
            {
              planId: "plan",
              planName: "Release",
              taskId: "task",
              key: "PAGE-7",
              title: "Write release notes",
            },
          ],
        },
      }),
      action: async ({ request }) => onAction(await request.formData()),
    },
  ]);
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <Stub initialEntries={["/settings/agents"]} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

async function openMenu(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  item: string,
): Promise<void> {
  await user.click(
    await screen.findByRole("button", { name: `Actions for ${name}` }),
  );
  await user.click(screen.getByRole("menuitem", { name: item }));
}

describe("A11.3 central agent panel", () => {
  it("lists every agent with scope, access, model, purpose, status and usability", async () => {
    renderPanel();
    const table = (
      await screen.findByRole("rowheader", { name: /System/ })
    ).closest("table");
    if (!table) throw new Error("Missing agent table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual([
      "Name",
      "Scope",
      "Connection",
      "Model / reasoning",
      "Purposes",
      "Status",
      "Usability",
      "Actions",
    ]);
    const blocked = within(table)
      .getByRole("rowheader", { name: "Personal worker" })
      .closest("tr");
    if (!blocked) throw new Error("Missing blocked row");
    expect(within(blocked).getByText("People: Alice")).toBeVisible();
    expect(within(blocked).getByText("Access blocked")).toBeVisible();
    expect(
      within(blocked).getByText(
        "No matching personal model access is assigned.",
      ),
    ).toBeVisible();
    expect(
      within(blocked).getByRole("rowheader", { name: "Personal worker" }),
    ).toHaveClass("opacity-60");
    const usable = within(table)
      .getByRole("rowheader", { name: "System writer" })
      .closest("tr");
    if (!usable) throw new Error("Missing usable row");
    expect(within(usable).getByText("System → Text")).toBeVisible();
    expect(within(usable).getByText("Access available")).toBeVisible();
    expect(within(usable).getByText("Active")).toBeVisible();
  });

  it("disables the scope fields that do not match, explains System and lists plan tickets under Assigned to", async () => {
    const user = renderPanel();
    await openMenu(user, "System writer", "Edit");
    const dialog = screen.getByRole("dialog");
    const assigned = within(dialog).getByRole("region", {
      name: "Assigned to",
    });
    expect(
      within(assigned).getByText(/Assignments are maintained here only/),
    ).toBeVisible();
    expect(
      within(dialog).getByText(/applies to the whole instance/),
    ).toBeVisible();
    for (const name of ["People", "Groups", "Departments"])
      expect(within(assigned).getByRole("group", { name })).toBeDisabled();
    expect(
      within(assigned).getByRole("group", { name: "System" }),
    ).toBeEnabled();
    expect(within(assigned).getByText("PAGE-7")).toBeVisible();
    expect(within(assigned).getByText(/Write release notes/)).toBeVisible();
    expect(
      within(assigned).getByText(/Execution plan “Release”/),
    ).toBeVisible();

    await user.click(within(dialog).getByRole("combobox", { name: "Scope" }));
    await user.click(await screen.findByRole("option", { name: "People" }));
    expect(
      within(dialog).queryByText(/applies to the whole instance/),
    ).toBeNull();
    expect(
      within(assigned).getByRole("group", { name: "People" }),
    ).toBeEnabled();
    for (const name of ["Groups", "Departments", "System"])
      expect(within(assigned).getByRole("group", { name })).toBeDisabled();
  });

  it("offers no plan ticket list for a new agent", async () => {
    const user = renderPanel();
    await user.click(await screen.findByRole("button", { name: "Add agent" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("region", { name: "Assigned to" }),
    ).toBeVisible();
    expect(within(dialog).queryByText("Project tasks and tickets")).toBeNull();
  });

  it("shows the references returned by a rejected agent deletion and keeps the action disabled", async () => {
    const submitted: string[] = [];
    const user = renderPanel((form) => {
      const intent = String(form.get("intent"));
      submitted.push(intent);
      if (intent === "profile-usages") return { ok: true, intent, usages: [] };
      return {
        ok: false,
        intent: "",
        error: "profile_in_use",
        usages: [
          { kind: "plan", id: "release" },
          { kind: "assignment", target: { kind: "person", targetId: "alice" } },
        ],
      };
    });
    await openMenu(user, "Personal worker", "Remove");
    const dialog = await screen.findByRole("dialog", {
      name: "Remove agent “Personal worker”?",
    });
    const remove = within(dialog).getByRole("button", { name: "Remove" });
    await waitFor(() => expect(remove).toBeEnabled());
    await user.click(remove);
    expect(
      await within(dialog).findByText("Execution plan release"),
    ).toBeVisible();
    expect(within(dialog).getByText("Assignment: People: Alice")).toBeVisible();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Remove assignments, project context and usage shares before deleting.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Remove" }),
    ).toBeDisabled();
    expect(submitted).toEqual(["profile-usages", "delete-profile"]);
  });

  it("names the agents that block removing a connection", async () => {
    const user = renderPanel((form) => ({
      ok: false,
      intent: String(form.get("intent")),
      error: "connection_in_use",
      usages: [{ kind: "agent", id: "system", name: "System writer" }],
    }));
    await openMenu(user, "Test connection", "Remove");
    const dialog = screen.getByRole("dialog", { name: "Remove connection?" });
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Remove or change this connection’s agent assignments first.",
    );
    expect(within(alert).getByRole("listitem")).toHaveTextContent(
      "System writer",
    );
  });
});

describe("A11.3 deletion lock for groups and departments", () => {
  it("lists the agents that block deleting a group and keeps the dialog open", async () => {
    const result: UsersActionData = {
      ok: false,
      intent: "delete-group",
      error: "agentInUse",
      agents: ["Team agent"],
    };
    const Stub = createRoutesStub([
      {
        path: "/users",
        action: () => result,
        Component: () => (
          <CatalogDeleteDialog
            id="team"
            name="Team"
            kind="group"
            disabled={false}
          />
        ),
      },
    ]);
    render(
      <I18nextProvider i18n={createI18n("en")}>
        <Stub initialEntries={["/users"]} />
      </I18nextProvider>,
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Delete Team?" }),
    );
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Agents still use this entry as their scope or usage share.",
    );
    expect(within(dialog).getByText("Used by these agents:")).toBeVisible();
    expect(within(dialog).getByRole("listitem")).toHaveTextContent(
      "Team agent",
    );
  });
});
