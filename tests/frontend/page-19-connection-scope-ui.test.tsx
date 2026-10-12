// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { createI18n } from "@/app/lib/i18n";
import SettingsAgentsRoute from "@/app/routes/settings-agents";

import {
  CLI_LOCATIONS,
  createAgentConnection,
  createCliConnection,
} from "../helpers/agents";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type { AgentConnectionSummary } from "@/definition/AgentConnection";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";

const DIRECTORY: AgentProfileDirectory = {
  persons: [
    { id: "carol", name: "Carol Example" },
    { id: "bob", name: "Bob Example" },
  ],
  groups: [{ id: "team", name: "Team Atlas" }],
  departments: [
    { id: "engineering", name: "Engineering" },
    { id: "finance", name: "Finance" },
  ],
};

interface Story {
  readonly connections: AgentConnectionSummary[];
  readonly onAction?: (form: FormData) => AgentActionResult;
}

function renderStory(story: Story): {
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly received: FormData[];
} {
  const received: FormData[] = [];
  const Stub = createRoutesStub([
    {
      path: "/settings/agents",
      Component: SettingsAgentsRoute,
      loader: () => ({
        access: "granted",
        connections: story.connections,
        cliTools: CLI_LOCATIONS,
        profileDirectory: DIRECTORY,
      }),
      action: async ({ request }) => {
        const form = await request.formData();
        received.push(form);
        return (
          story.onAction?.(form) ?? {
            ok: true,
            intent: String(form.get("intent")),
            connectionId: String(form.get("connectionId") || "created"),
          }
        );
      },
    },
  ]);
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <Stub initialEntries={["/settings/agents"]} />
    </I18nextProvider>,
  );
  return { user: userEvent.setup(), received };
}

function scopeOf(form: FormData): unknown {
  return JSON.parse(String(form.get("scope")));
}

describe("PAGE-19 usage scope in the connection settings", () => {
  it("shows the scope of every connection in the list", async () => {
    renderStory({
      connections: [
        createAgentConnection({ name: "Open API" }),
        createCliConnection({
          id: "22222222-2222-4222-8222-222222222222",
          name: "Closed CLI",
          scope: {
            mode: "restricted",
            targets: [
              { kind: "person", targetId: "carol" },
              { kind: "group", targetId: "team" },
              { kind: "department", targetId: "engineering" },
            ],
          },
        }),
      ],
    });
    const open = (
      await screen.findByRole("button", { name: "Open API" })
    ).closest("tr");
    const closed = screen
      .getByRole("button", { name: "Closed CLI" })
      .closest("tr");
    expect(open).not.toBeNull();
    expect(closed).not.toBeNull();
    if (!open || !closed) return;
    expect(
      screen.getAllByRole("columnheader", { name: "Use" }).length,
    ).toBeGreaterThan(0);
    expect(within(open).getByText("Global")).toBeVisible();
    expect(within(closed).getByText("Restricted (3)")).toBeVisible();
  });

  it("creates a connection with a restricted scope of mixed targets", async () => {
    const { user, received } = renderStory({ connections: [] });
    await user.click(
      await screen.findByRole("button", { name: "Add API connection" }),
    );
    const dialog = await screen.findByRole("dialog");
    // New connections start global, as every connection did before scopes.
    expect(within(dialog).getByRole("radio", { name: /Global/ })).toBeChecked();
    expect(
      within(dialog).queryByRole("region", {
        name: "Permitted users, groups and departments",
      }),
    ).toBeNull();
    await user.type(within(dialog).getByLabelText("Name"), "Scoped key");
    await user.type(
      within(dialog).getByLabelText("API key"),
      "synthetic-key-for-page-19-ui",
    );
    await user.click(within(dialog).getByRole("radio", { name: /Restricted/ }));
    expect(
      within(dialog).getByText(
        "Select at least one user, group or department.",
      ),
    ).toBeVisible();
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Carol Example" }),
    );
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Team Atlas" }),
    );
    await user.click(within(dialog).getByRole("checkbox", { name: "Finance" }));
    expect(
      within(dialog).queryByText(
        "Select at least one user, group or department.",
      ),
    ).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(received).toHaveLength(1));
    const form = received[0];
    expect(form.get("intent")).toBe("create-connection");
    expect(scopeOf(form)).toEqual({
      mode: "restricted",
      targets: [
        { kind: "person", targetId: "carol" },
        { kind: "group", targetId: "team" },
        { kind: "department", targetId: "finance" },
      ],
    });
  });

  it("shows the saved selection exactly and saves a change back to global", async () => {
    const { user, received } = renderStory({
      connections: [
        createAgentConnection({
          name: "Closed API",
          scope: {
            mode: "restricted",
            targets: [
              { kind: "person", targetId: "bob" },
              { kind: "department", targetId: "engineering" },
            ],
          },
        }),
      ],
    });
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("radio", { name: /Restricted/ }),
    ).toBeChecked();
    const checked = within(dialog)
      .getAllByRole("checkbox")
      .filter((box) => (box as HTMLInputElement).checked)
      .map((box) => box.parentElement?.textContent);
    expect(checked.sort()).toEqual(["Bob Example", "Engineering"]);
    await user.click(within(dialog).getByRole("radio", { name: /Global/ }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].get("intent")).toBe("update-connection");
    expect(scopeOf(received[0])).toEqual({ mode: "global", targets: [] });
  });

  it("reports a rejected scope with its own message", async () => {
    const { user } = renderStory({
      connections: [createAgentConnection({ name: "Closed API" })],
      onAction: (form) => ({
        ok: false,
        intent: String(form.get("intent")),
        error: "connection_scope_invalid",
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: /Restricted/ }));
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Bob Example" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(
      await within(dialog).findByText(
        "Choose Global, or at least one user, group or department.",
      ),
    ).toBeVisible();
  });
});
