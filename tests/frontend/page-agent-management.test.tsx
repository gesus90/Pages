// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub } from "react-router";
import { beforeAll, describe, expect, it } from "vitest";

import { PageAgentPageView } from "@/app/components/agents/definitions/page-agent-page";
import { createI18n } from "@/app/lib/i18n";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { installEditorGeometry } from "../helpers/editor";

import type { PageAgentPage } from "@/definition/PageAgent";

beforeAll(installEditorGeometry);

function page(): PageAgentPage {
  return {
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
      return { ok: true };
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
      availability: { isUsable: true, reason: null, personalChoices: [] },
      configuration: { ...emptyAgentConfiguration(), accessMode: "shared" },
    } as const;
    const submitted: FormData[] = [];
    await mount({ ...proposed, agents: [existing] }, async (request) => {
      submitted.push(await request.formData());
      return { ok: false, error: "profile_conflict" };
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
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Sharing" })).toBeDisabled();
  });
});
