// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentProfileDelete } from "@/app/components/settings/agents/agent-profile-delete";
import { readBlockingAgents } from "@/app/components/settings/agents/use-agent-actions";
import { createI18n } from "@/app/lib/i18n";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type { AgentUsage } from "@/definition/AgentUsage";

const profile = {
  id: "profile-1",
  name: "Worker",
  connectionId: "access",
  model: "model-a",
  reasoningEffort: null,
  isActive: true,
  purposes: ["agent" as const],
  targets: [],
};
const directory = { persons: [], groups: [], departments: [] };

let router: ReturnType<typeof createMemoryRouter> | undefined;
afterEach(() => {
  router?.dispose();
});

function renderDelete(usages: readonly AgentUsage[]): void {
  router = createMemoryRouter([
    {
      path: "/",
      element: (
        <AgentProfileDelete
          profile={profile}
          directory={directory}
          onClose={vi.fn()}
        />
      ),
      hydrateFallbackElement: <p>Loading</p>,
    },
    {
      path: "/settings/agents",
      action: () => ({ ok: true, intent: "profile-usages", usages }),
    },
  ]);
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("A11.10 agent profile deletion usages", () => {
  it("names the agent that uses the profile and blocks removal while a use remains", async () => {
    renderDelete([
      { kind: "agent", id: "agent-1", name: "Reviewer" },
      { kind: "global" },
    ]);
    expect(await screen.findByText("Agent “Reviewer”")).toBeVisible();
    expect(
      screen.getByText("Share the template with all active users"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
  });

  it("allows removal when the server reports no use", async () => {
    renderDelete([]);
    const remove = await screen.findByRole("button", { name: "Remove" });
    await vi.waitFor(() => expect(remove).toBeEnabled());
    expect(screen.queryByText("Current uses")).not.toBeInTheDocument();
  });
});

describe("A11.10 blocking agents of a rejected deletion", () => {
  const usages: readonly AgentUsage[] = [
    { kind: "global" },
    { kind: "agent", id: "agent-1", name: "Reviewer" },
    { kind: "project", id: "project-1" },
    { kind: "agent", id: "agent-2", name: "Planner" },
  ];

  it("lists only agent names of a failed result", () => {
    const failed: AgentActionResult = {
      ok: false,
      intent: "delete-connection",
      error: "connection_in_use",
      usages,
    };
    expect(readBlockingAgents(failed)).toEqual(["Reviewer", "Planner"]);
  });

  it("returns nothing for a missing, successful or reference-free result", () => {
    expect(readBlockingAgents(undefined)).toEqual([]);
    expect(
      readBlockingAgents({ ok: true, intent: "delete-connection", usages }),
    ).toEqual([]);
    expect(
      readBlockingAgents({
        ok: false,
        intent: "delete-connection",
        error: "general",
      }),
    ).toEqual([]);
    expect(
      readBlockingAgents({
        ok: false,
        intent: "delete-connection",
        error: "general",
        usages: [{ kind: "global" }],
      }),
    ).toEqual([]);
  });
});
