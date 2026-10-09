// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub, useLoaderData } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { AgentAssignments } from "@/app/components/settings/agents/agent-assignments";
import { AgentsSection } from "@/app/components/settings/agents/agents-section";
import { createI18n } from "@/app/lib/i18n";
import { emptyModelCatalog } from "@/definition/AgentModelCatalog";
import { isAgentFunction } from "@/definition/AgentAssignment";

import {
  CLI_LOCATIONS,
  createAgentConnection,
  createCatalogModel,
  createCliConnection,
} from "../helpers/agents";

import type { AgentAssignmentView } from "@/definition/AgentAssignment";

const api = createAgentConnection({
  id: "acc1",
  name: "API one",
  checks: {
    auth: {
      status: "passed",
      errorCode: null,
      checkedAt: "now",
      durationMs: 1,
      detail: {},
    },
    model: null,
  },
});
const apiTwo = { ...api, id: "acc2", name: "API two" };
const cli = createCliConnection({
  id: "cli",
  name: "CLI",
  cli: {
    binaryFound: true,
    loggedInAt: "now",
    accountLabel: null,
    login: null,
    terminalCommand: "synthetic",
  },
});
const catalogs = {
  acc1: {
    ...emptyModelCatalog(),
    models: [
      createCatalogModel({
        id: "reasoner",
        name: "Reasoner",
        reasoning: "levels",
        reasoningEfforts: ["low", "medium"],
      }),
    ],
  },
  acc2: {
    ...emptyModelCatalog(),
    models: [
      createCatalogModel({
        id: "other-account",
        name: "Other account",
      }),
    ],
  },
  cli: {
    ...emptyModelCatalog(),
    models: [createCatalogModel({ id: "cli-model", name: "CLI Model" })],
  },
};
const connections = [
  api,
  apiTwo,
  cli,
  createAgentConnection({ id: "unverified", name: "Unverified" }),
  createAgentConnection({ id: "no-key", name: "No key", hasApiKey: false }),
  { ...api, id: "empty", name: "No catalog" },
];
const ASSIGNED: AgentAssignmentView = {
  function: "text",
  connectionId: "acc1",
  model: "reasoner",
  reasoningEffort: "medium",
  error: null,
};

function story(
  input: {
    readonly assignments?: readonly AgentAssignmentView[];
    readonly lang?: "de" | "en";
    readonly action?: (form: FormData) => Promise<Response>;
    readonly completeSection?: boolean;
  } = {},
) {
  let assignments = input.assignments ?? [];
  const forms: FormData[] = [];
  const action = vi.fn(async ({ request }: { readonly request: Request }) => {
    const form = await request.formData();
    forms.push(form);
    if (input.action) return input.action(form);
    const assignedFunction = form.get("function");
    if (!isAgentFunction(assignedFunction)) throw new Error("Invalid fixture");
    if (form.get("intent") === "delete-assignment")
      assignments = assignments.filter(
        (entry) => entry.function !== assignedFunction,
      );
    else
      assignments = [
        ...assignments.filter((entry) => entry.function !== assignedFunction),
        {
          function: assignedFunction,
          connectionId: String(form.get("connectionId")),
          model: String(form.get("model")),
          reasoningEffort: String(form.get("reasoningEffort")) || null,
          error: null,
        },
      ];
    return Response.json({ ok: true });
  });
  const Stub = createRoutesStub([
    {
      path: "/settings/agents",
      loader: () => ({ assignments }),
      action,
      Component: () => {
        const loaded = useLoaderData<{
          assignments: readonly AgentAssignmentView[];
        }>();
        if (input.completeSection)
          return (
            <AgentsSection
              connections={connections}
              catalogs={catalogs}
              cliTools={CLI_LOCATIONS}
              assignments={loaded.assignments}
            />
          );
        return (
          <AgentAssignments
            connections={connections}
            catalogs={catalogs}
            assignments={loaded.assignments}
          />
        );
      },
    },
  ]);
  render(
    <I18nextProvider i18n={createI18n(input.lang ?? "de")}>
      <Stub initialEntries={["/settings/agents"]} />
    </I18nextProvider>,
  );
  return { user: userEvent.setup(), action, forms };
}

async function choose(name: string, option: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("agent assignment administration", () => {
  it.each(["de", "en"] as const)(
    "creates only assignments in %s and limits choices to the named connection's catalog",
    async (lang) => {
      const { user, action, forms } = story({ lang });
      await user.click(
        await screen.findByRole("button", {
          name: lang === "de" ? "Zuordnung hinzufügen" : "Add assignment",
        }),
      );
      const labels =
        lang === "de"
          ? [
              "Funktion",
              "Anbindung",
              "Modell",
              "Reasoning-Stufe",
              "Zuordnung speichern",
            ]
          : [
              "Function",
              "Connection",
              "Model",
              "Reasoning level",
              "Save assignment",
            ];
      expect(action).not.toHaveBeenCalled();
      expect(screen.getByRole("combobox", { name: labels[2] })).toBeDisabled();
      await choose(labels[0], "SKILLS");
      await choose(labels[1], "API one (OpenAI API)");
      await choose(labels[2], "Reasoner (reasoner)");
      expect(screen.getByRole("button", { name: labels[4] })).toBeDisabled();
      await choose(labels[3], "medium");
      await user.click(screen.getByRole("button", { name: labels[4] }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(action).toHaveBeenCalledTimes(1);
      expect(Object.fromEntries(forms[0])).toEqual({
        intent: "create-assignment",
        function: "skills",
        connectionId: "acc1",
        model: "reasoner",
        reasoningEffort: "medium",
      });
      const row = screen.getByRole("row", { name: /SKILLS API one/ });
      expect(row).toHaveTextContent("reasoner");
      expect(row).toHaveTextContent("medium");
      await user.click(
        screen.getByRole("button", {
          name:
            lang === "de"
              ? "SKILLS-Zuordnung bearbeiten"
              : "Edit SKILLS assignment",
        }),
      );
      expect(screen.getByRole("combobox", { name: labels[0] })).toBeDisabled();
      await choose(labels[1], "API two (OpenAI API)");
      expect(document.querySelector('input[name="model"]')).toHaveValue("");
      expect(
        document.querySelector('input[name="reasoningEffort"]'),
      ).toHaveValue("");
      await user.click(screen.getByRole("combobox", { name: labels[2] }));
      expect(
        screen.queryByRole("option", { name: "Reasoner (reasoner)" }),
      ).toBeNull();
      await user.click(
        screen.getByRole("option", { name: "Other account (other-account)" }),
      );
      await choose(labels[1], "CLI (Codex CLI)");
      await choose(labels[2], "CLI Model (cli-model)");
      await user.click(screen.getByRole("button", { name: labels[4] }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(screen.getByRole("row", { name: /SKILLS CLI/ })).toHaveTextContent(
        "cli-model",
      );
      expect(action).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps invalid saved choices visible, explains access and catalog failures, and permits explicit repair", async () => {
    const { user, action } = story({
      assignments: [
        {
          ...ASSIGNED,
          connectionId: "missing",
          model: "missing-model",
          reasoningEffort: "xhigh",
          error: "connectionUnavailable",
        },
      ],
    });
    expect(
      await screen.findByRole("row", { name: /Text missing/ }),
    ).toHaveTextContent("missing-model");
    await user.click(
      screen.getByRole("button", { name: "Text-Zuordnung bearbeiten" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Anbindung");
    expect(
      within(dialog).getByRole("combobox", { name: "Modell" }),
    ).toHaveTextContent("missing-model");
    expect(
      within(dialog).getByRole("combobox", { name: "Reasoning-Stufe" }),
    ).toHaveTextContent("xhigh");
    expect(
      screen.getByRole("button", { name: "Zuordnung speichern" }),
    ).toBeDisabled();
    await choose("Anbindung", "Unverified (OpenAI API)");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "nicht bestätigt",
    );
    await choose("Anbindung", "No key (OpenAI API)");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "nicht bestätigt",
    );
    await choose("Anbindung", "No catalog (OpenAI API)");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "nicht im verfügbaren Katalog",
    );
    await choose("Anbindung", "API one (OpenAI API)");
    await choose("Modell", "Reasoner (reasoner)");
    await user.click(screen.getByRole("combobox", { name: "Reasoning-Stufe" }));
    expect(screen.queryByRole("option", { name: "xhigh" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "low" }));
    await user.click(
      screen.getByRole("button", { name: "Zuordnung speichern" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("marks unavailable saved models and levels instead of replacing them", async () => {
    const { user } = story({
      assignments: [
        { ...ASSIGNED, model: "removed", error: "modelUnavailable" },
        {
          ...ASSIGNED,
          function: "skills",
          reasoningEffort: "xhigh",
          error: "reasoningUnsupported",
        },
      ],
    });
    await user.click(
      await screen.findByRole("button", { name: "Text-Zuordnung bearbeiten" }),
    );
    expect(
      within(screen.getByRole("dialog")).getByRole("alert"),
    ).toHaveTextContent("nicht im verfügbaren Katalog");
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    await user.click(
      screen.getByRole("button", { name: "SKILLS-Zuordnung bearbeiten" }),
    );
    expect(
      within(screen.getByRole("dialog")).getByRole("alert"),
    ).toHaveTextContent("Reasoning");
    expect(
      screen.getByRole("button", { name: "Zuordnung speichern" }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
  });

  it("shows save failures and disables inputs during the request", async () => {
    let finish: (response: Response) => void = () => undefined;
    const { user } = story({
      assignments: [ASSIGNED],
      action: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    await user.click(
      await screen.findByRole("button", { name: "Text-Zuordnung bearbeiten" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Zuordnung speichern" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Anbindung" }),
      ).toBeDisabled(),
    );
    await act(async () =>
      finish(Response.json({ ok: false, error: "assignment_exists" })),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "bereits zugeordnet",
    );
  });

  it("places assignments below connections, disables + when all functions exist and removes only a chosen assignment", async () => {
    const { user, action } = story({
      completeSection: true,
      assignments: [
        ASSIGNED,
        {
          ...ASSIGNED,
          function: "skills",
          model: "plain",
          reasoningEffort: null,
        },
      ],
    });
    const add = await screen.findByRole("button", {
      name: "Zuordnung hinzufügen",
    });
    expect(add).toBeDisabled();
    const headings = screen
      .getAllByRole("heading")
      .map((heading) => heading.textContent);
    expect(headings.indexOf("Agent-Aufgaben")).toBeGreaterThan(
      headings.indexOf("CLI-Anbindungen"),
    );
    await user.click(
      screen.getByRole("button", { name: "SKILLS-Zuordnung entfernen" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("row", { name: /SKILLS API one/ })).toBeNull(),
    );
    expect(
      screen.getByRole("button", { name: "Zuordnung hinzufügen" }),
    ).toBeEnabled();
    expect(action).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole("button", { name: "Text-Zuordnung bearbeiten" }),
    ).toBeEnabled();
  });

  it("shows a failed assignment removal in its row", async () => {
    const { user } = story({
      assignments: [ASSIGNED],
      action: async () => Response.json({ ok: false, error: "general" }),
    });
    await user.click(
      await screen.findByRole("button", { name: "Text-Zuordnung entfernen" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "nicht gespeichert",
    );
  });
});
