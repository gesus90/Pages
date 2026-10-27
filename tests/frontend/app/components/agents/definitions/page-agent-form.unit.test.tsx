import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PageAgentForm } from "@/app/components/agents/definitions/page-agent-form";
import { Dialog } from "@/app/components/ui/dialog";
import { createI18n } from "@/app/lib/i18n";
import {
  defaultAgentRunOptions,
  emptyAgentConfiguration,
} from "@/definition/AgentConfiguration";

import type {
  PageAgent,
  PageAgentModel,
  PageAgentPage,
} from "@/definition/PageAgent";

const i18n = createI18n("de");

// The rich-text editor needs a real layout engine; the form only hands it the markdown.
vi.mock("@/app/components/editor/block-editor", () => ({
  BlockEditor: (props: {
    readonly markdown: string;
    readonly label: string;
    readonly onChange: (markdown: string) => void;
  }) => (
    <textarea
      aria-label={props.label}
      value={props.markdown}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));

const MODEL: PageAgentModel = {
  id: "model-1",
  name: "Sonnet",
  model: "claude-sonnet",
  reasoning: "none",
  reasoningEfforts: [],
  catalogDefaultReasoningEffort: null,
  reasoningEffort: null,
  provider: "openrouter",
};

const PAGE: PageAgentPage = {
  isAdministrator: false,
  agents: [],
  models: [MODEL],
  directory: { persons: [], groups: [], departments: [] },
  workspaces: [],
};

/** A saved definition; `canEdit` decides between editing and the read-only view. */
function savedAgent(overrides: Partial<PageAgent> = {}): PageAgent {
  return {
    id: "agent-1",
    ownerId: "owner",
    name: "Reviewer",
    modelProfileId: MODEL.id,
    reasoningEffort: null,
    configuration: emptyAgentConfiguration(),
    revision: 3,
    model: MODEL.model,
    canEdit: true,
    hasDeletedTargets: false,
    availability: { isUsable: true, reason: null, personalChoices: [] },
    provider: "openrouter",
    ...overrides,
  };
}

interface Rendered {
  readonly onSaved: ReturnType<typeof vi.fn>;
  readonly action: ReturnType<typeof vi.fn>;
  /** The form fields of every submission the action received. */
  readonly submissions: FormData[];
}

/** Opens the form in a dialog; the `/agents/agents` action answers with `result`. */
function renderForm(
  agent: PageAgent | null,
  page: PageAgentPage = PAGE,
  result: { ok: boolean; intent: string } = { ok: true, intent: "save-agent" },
): Rendered {
  const onSaved = vi.fn();
  const submissions: FormData[] = [];
  const action = vi.fn(async ({ request }: { request: Request }) => {
    submissions.push(await request.formData());
    return result;
  });
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <Dialog open>
            <PageAgentForm agent={agent} page={page} onSaved={onSaved} />
          </Dialog>
        ),
      },
      { path: "/agents/agents", action },
    ],
    { initialEntries: ["/"] },
  );
  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
  return { onSaved, action, submissions };
}

function nameField(): HTMLInputElement {
  const field = screen.getByLabelText(i18n.t("pageAgents.name"));
  if (!(field instanceof HTMLInputElement))
    throw new Error("The name field is not an input.");
  return field;
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: i18n.t("pageAgents.save") });
}

it("creates an agent on the first released model and saves only a named draft", async () => {
  const { onSaved, submissions } = renderForm(null);

  expect(
    screen.getByRole("heading", { name: i18n.t("pageAgents.create") }),
  ).toBeDefined();
  expect(nameField().value).toBe("");
  expect(saveButton().hasAttribute("disabled")).toBe(true);

  fireEvent.change(nameField(), { target: { value: "Release notes" } });
  await waitFor(() =>
    expect(saveButton().hasAttribute("disabled")).toBe(false),
  );
  fireEvent.click(saveButton());

  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  const [formData] = submissions;
  expect(formData?.get("intent")).toBe("save-agent");
  expect(formData?.get("agentId")).toBe("");
  expect(JSON.parse(String(formData?.get("agent")))).toMatchObject({
    name: "Release notes",
    modelProfileId: "model-1",
  });
});

it("does not report a save that the server refused", async () => {
  const { onSaved, action } = renderForm(null, PAGE, {
    ok: false,
    intent: "save-agent",
  });

  fireEvent.change(nameField(), { target: { value: "Rejected" } });
  await waitFor(() =>
    expect(saveButton().hasAttribute("disabled")).toBe(false),
  );
  fireEvent.click(saveButton());

  await waitFor(() => expect(action).toHaveBeenCalledOnce());
  expect(onSaved).not.toHaveBeenCalled();
});

it("keeps saving blocked while the draft has no model", () => {
  renderForm(null, { ...PAGE, models: [] });

  fireEvent.change(nameField(), { target: { value: "Orphan" } });

  expect(saveButton().hasAttribute("disabled")).toBe(true);
});

it("edits a saved definition under its own title", () => {
  renderForm(savedAgent());

  expect(
    screen.getByRole("heading", { name: i18n.t("pageAgents.editAgent") }),
  ).toBeDefined();
  expect(nameField().value).toBe("Reviewer");
  expect(saveButton().hasAttribute("disabled")).toBe(false);
});

it("shows a definition the person may not edit as read-only", () => {
  const { onSaved } = renderForm(savedAgent({ canEdit: false }));

  expect(
    screen.getByRole("heading", { name: i18n.t("pageAgents.viewAgent") }),
  ).toBeDefined();
  expect(nameField().disabled).toBe(true);
  expect(
    screen.queryByRole("button", { name: i18n.t("pageAgents.save") }),
  ).toBe(null);

  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("pageAgents.close") }),
  );

  expect(onSaved).toHaveBeenCalledOnce();
});

it("closes an untouched form at once and asks before it drops a change", async () => {
  const { onSaved } = renderForm(savedAgent());
  const cancel = screen.getByRole("button", {
    name: i18n.t("settings.agents.cancel"),
  });

  fireEvent.click(cancel);
  expect(onSaved).toHaveBeenCalledOnce();

  fireEvent.change(nameField(), { target: { value: "Reviewer v2" } });
  fireEvent.click(cancel);

  expect(onSaved).toHaveBeenCalledOnce();
  expect(
    await screen.findByText(i18n.t("settings.agents.definition.discardTitle")),
  ).toBeDefined();
});

it("refuses an ACP agent whose saved write mode is neither of the two modes", () => {
  const configuration = emptyAgentConfiguration();
  renderForm(
    savedAgent({
      provider: "claude_code",
      configuration: {
        ...configuration,
        run: {
          ...defaultAgentRunOptions("openrouter"),
          access: "workspace_write",
        },
      },
    }),
    { ...PAGE, models: [{ ...MODEL, provider: "claude_code" }] },
  );

  expect(saveButton().hasAttribute("disabled")).toBe(true);
});

it("warns the owner that a saved model is no longer released", () => {
  renderForm(savedAgent({ modelProfileId: "withdrawn" }));

  expect(
    screen.getAllByText(i18n.t("pageAgents.missingModel")).length,
  ).toBeGreaterThan(0);
  expect(saveButton().hasAttribute("disabled")).toBe(true);
});

it("saves the edited template and the chosen sharing with the definition", async () => {
  const { onSaved, submissions } = renderForm(savedAgent());

  fireEvent.change(
    screen.getByRole("textbox", {
      name: i18n.t("settings.agents.definition.markdown"),
    }),
    { target: { value: "Summarize the open tickets" } },
  );
  const sharing = screen
    .getAllByRole("combobox")
    .find((field) => field.textContent === i18n.t("pageAgents.private"));
  if (!sharing) throw new Error("The sharing picker is missing.");
  fireEvent.keyDown(sharing, { key: "Enter" });
  fireEvent.click(
    await screen.findByRole("option", { name: i18n.t("pageAgents.global") }),
  );
  fireEvent.click(saveButton());

  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  const [formData] = submissions;
  expect(formData?.get("agentId")).toBe("agent-1");
  expect(JSON.parse(String(formData?.get("agent")))).toMatchObject({
    revision: 3,
    configuration: {
      markdown: "Summarize the open tickets",
      sharing: { isGlobal: true },
    },
  });
});
