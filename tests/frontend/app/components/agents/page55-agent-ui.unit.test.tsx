import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useLoaderData,
} from "react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, afterAll, expect, it, vi } from "vitest";

import { AgentParameterFields } from "@/app/components/settings/agents/agent-parameter-fields";
import { AgentRunOptionsFields } from "@/app/components/settings/agents/agent-run-options-fields";
import { PageAgentRow } from "@/app/components/agents/definitions/page-agent-row";
import { PlanRunView } from "@/app/components/agents/plans/plan-run-view";
import { createI18n } from "@/app/lib/i18n";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { PageAgent } from "@/definition/PageAgent";
import type { AgentPlanRun } from "@/definition/AgentPlan";

const i18n = createI18n("de");
const scrollIntoView = HTMLElement.prototype.scrollIntoView;

it("displays a timed-out run as Gestört with the hard timeout cause", () => {
  const run: AgentPlanRun = {
    id: "run",
    planId: "plan",
    planName: "Plan",
    planRevision: 1,
    userId: "owner",
    startedAt: "2026-01-01",
    status: "failed",
    stopRequested: false,
    steps: [
      {
        id: "step",
        name: "Agent",
        status: "failed",
        isBlocked: false,
        cancellation: "none",
        output: null,
        error: "timeout",
      },
    ],
  };
  render(
    <I18nextProvider i18n={i18n}>
      <PlanRunView
        state={{
          run,
          selectedId: run.id,
          select: vi.fn(),
          runs: [run],
          error: null,
        }}
        onStop={vi.fn()}
        isPending={false}
      />
    </I18nextProvider>,
  );
  expect(screen.getByRole("status").textContent).toContain("Gestört");
  expect(
    screen.getByText(i18n.t("settings.agents.error.timeout")),
  ).toBeDefined();
});

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterAll(() => {
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
});

function Draft(props: {
  readonly initial: AgentConfiguration;
  readonly save: (configuration: AgentConfiguration) => void;
}): React.ReactElement {
  const [configuration, setConfiguration] = useState(props.initial);
  return (
    <div>
      <AgentParameterFields
        configuration={configuration}
        onChange={setConfiguration}
        disabled={false}
      />
      <AgentRunOptionsFields
        configuration={configuration}
        provider="claude_code"
        onChange={setConfiguration}
        disabled={false}
      />
      <button onClick={() => props.save(configuration)}>Save draft</button>
    </div>
  );
}

function DraftPersistence(): React.ReactElement {
  const [saved, setSaved] = useState(emptyAgentConfiguration());
  const [isEditing, setEditing] = useState(true);
  function save(configuration: AgentConfiguration): void {
    setSaved(structuredClone(configuration));
    setEditing(false);
  }
  return isEditing ? (
    <Draft initial={structuredClone(saved)} save={save} />
  ) : (
    <button onClick={() => setEditing(true)}>Reopen draft</button>
  );
}

function renderDraft(): void {
  const router = createMemoryRouter([
    { path: "/", element: <DraftPersistence /> },
    {
      path: "/agent-api/ticket-choices",
      loader: () => ({
        tickets: [
          {
            id: "ticket-id",
            key: "SYN-55",
            title: "Accessible synthetic ticket",
          },
          { id: "ticket-2", key: "SYN-56", title: "Another accessible ticket" },
        ],
      }),
    },
  ]);
  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

async function choose(label: string, option: string): Promise<void> {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

async function addParameter(
  name: string,
  type: "String" | "Zahl" | "Ticket",
): Promise<void> {
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("settings.agents.definition.addParameter"),
    }),
  );
  const names = screen.getAllByRole("textbox", {
    name: i18n.t("settings.agents.definition.parameterName"),
  });
  const field = names.at(-1);
  if (!field) throw new Error("Missing parameter name field");
  fireEvent.change(field, { target: { value: name } });
  const types = screen.getAllByRole("combobox", {
    name: i18n.t("settings.agents.definition.parameterType"),
  });
  const picker = types.at(-1);
  if (!picker) throw new Error("Missing parameter type picker");
  fireEvent.keyDown(picker, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: type }));
}

it.each(["String", "Zahl", "Ticket"] as const)(
  "creates, edits and retains %s parameters when saved and reopened",
  async (type) => {
    renderDraft();
    await addParameter("input", type);
    if (type === "String") {
      fireEvent.click(
        screen.getByRole("checkbox", {
          name: i18n.t("settings.agents.definition.useDefault"),
        }),
      );
      fireEvent.change(
        screen.getByRole("textbox", {
          name: i18n.t("settings.agents.definition.defaultValue"),
        }),
        { target: { value: "Complete string" } },
      );
    }
    if (type === "Zahl")
      fireEvent.change(
        screen.getByRole("spinbutton", {
          name: i18n.t("settings.agents.definition.defaultValue"),
        }),
        { target: { value: "12.5" } },
      );
    if (type === "Ticket") {
      await waitFor(() =>
        expect(
          screen
            .getByRole("combobox", {
              name: i18n.t("settings.agents.definition.ticket"),
            })
            .hasAttribute("disabled"),
        ).toBe(false),
      );
      await choose(
        i18n.t("settings.agents.definition.ticket"),
        "SYN-55: Accessible synthetic ticket",
      );
    }
    saveAndReopen();
    if (type === "String") {
      fireEvent.change(screen.getByDisplayValue("Complete string"), {
        target: { value: "Changed string" },
      });
    }
    if (type === "Zahl")
      fireEvent.change(screen.getByDisplayValue("12.5"), {
        target: { value: "-42.5" },
      });
    if (type === "Ticket") {
      await screen.findByText("SYN-55: Accessible synthetic ticket");
      await waitFor(() =>
        expect(
          screen
            .getByRole("combobox", {
              name: i18n.t("settings.agents.definition.ticket"),
            })
            .hasAttribute("disabled"),
        ).toBe(false),
      );
      await choose(
        i18n.t("settings.agents.definition.ticket"),
        "SYN-56: Another accessible ticket",
      );
    }
    saveAndReopen();
    if (type === "String")
      expect(screen.getByDisplayValue("Changed string")).toBeDefined();
    if (type === "Zahl")
      expect(screen.getByDisplayValue("-42.5")).toBeDefined();
    if (type === "Ticket")
      await screen.findByText("SYN-56: Another accessible ticket");
  },
);

function saveAndReopen(): void {
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Reopen draft" }));
}

it("removes all supported new parameter types and keeps them removed after saving and reopening", async () => {
  renderDraft();
  for (const [name, type] of [
    ["message", "String"],
    ["amount", "Zahl"],
    ["ticketID", "Ticket"],
  ] as const)
    await addParameter(name, type);
  for (const name of ["message", "amount", "ticketID"])
    fireEvent.click(
      screen.getByRole("button", {
        name: i18n.t("settings.agents.definition.removeParameter", { name }),
      }),
    );
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Reopen draft" }));
  expect(
    screen.queryAllByRole("textbox", {
      name: i18n.t("settings.agents.definition.parameterName"),
    }),
  ).toHaveLength(0);
});

it("shows the unlimited default, explains the hard deadline and retains zero when saved", () => {
  renderDraft();
  const timeout = screen.getByRole("spinbutton", {
    name: i18n.t("settings.agents.run.timeout"),
  });
  expect(timeout.getAttribute("value")).toBe("0");
  expect(
    screen.getByText(i18n.t("settings.agents.run.unlimited")),
  ).toBeDefined();
  expect(
    screen.getByText(i18n.t("settings.agents.run.timeoutHint")),
  ).toBeDefined();
  fireEvent.change(timeout, { target: { value: "1" } });
  expect(
    screen.getByText(i18n.t("settings.agents.run.hardTimeout", { minutes: 1 })),
  ).toBeDefined();
  fireEvent.change(timeout, { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Reopen draft" }));
  expect(
    screen
      .getByRole("spinbutton", { name: i18n.t("settings.agents.run.timeout") })
      .getAttribute("value"),
  ).toBe("0");
});

function Rows(): React.ReactElement {
  const agents = useLoaderData<readonly PageAgent[]>();
  return (
    <table>
      <tbody>
        {agents.map((entry) => (
          <PageAgentRow key={entry.id} agent={entry} onOpen={() => {}} />
        ))}
      </tbody>
    </table>
  );
}

function agent(canEdit: boolean): PageAgent {
  return {
    id: "agent",
    ownerId: "owner",
    name: "Synthetic agent",
    modelProfileId: "model",
    model: "synthetic:free",
    reasoningEffort: null,
    configuration: emptyAgentConfiguration(),
    canEdit,
    hasDeletedTargets: false,
    availability: { isUsable: true, reason: null, personalChoices: [] },
    provider: "openrouter",
  };
}

it("asks for confirmation, supports cancelling, and refreshes the real router list after removal", async () => {
  let agents: readonly PageAgent[] = [agent(true)];
  const action = vi.fn(async ({ request }: { readonly request: Request }) => {
    const form = await request.formData();
    expect(form.get("confirmation")).toBe("LÖSCHEN");
    agents = [];
    return { ok: true, intent: "delete-agent" };
  });
  const router = createMemoryRouter(
    [
      {
        path: "/agents/agents",
        loader: () => agents,
        action,
        element: <Rows />,
      },
    ],
    { initialEntries: ["/agents/agents"] },
  );
  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: i18n.t("settings.agents.remove"),
    }),
  );
  expect(screen.getByRole("dialog")).toBeDefined();
  expect(action).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("settings.agents.cancel") }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(action).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("settings.agents.remove") }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("pageAgents.confirmDelete") }),
  );
  await waitFor(() => expect(screen.queryByText("Synthetic agent")).toBeNull());
  expect(action).toHaveBeenCalledTimes(1);
});

it("offers no delete action to a person with read-only access", async () => {
  const router = createMemoryRouter([
    { path: "/", loader: () => [agent(false)], element: <Rows /> },
  ]);
  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
  await screen.findByText("Synthetic agent");
  expect(
    screen.queryByRole("button", { name: i18n.t("settings.agents.remove") }),
  ).toBeNull();
});
