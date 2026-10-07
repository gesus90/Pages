// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";

import { TemplateManagerDialog } from "@/app/components/tasks/templates/template-manager-dialog";
import { TicketTemplateSaveDialog } from "@/app/components/tasks/templates/ticket-template-save-dialog";
import { useTemplateFetcher } from "@/app/components/tasks/templates/use-template-fetcher";
import { TicketAccessProvider } from "@/app/components/tasks/ticket-access";
import { createI18n } from "@/app/lib/i18n";
import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";
import { LANGUAGE } from "@/language/Language";

import type { WorkItemDetail } from "@/definition/Task";
import type { WorkItemTemplateView } from "@/definition/WorkItemTemplate";

type Submission = Readonly<Record<string, string | string[]>>;

interface Harness {
  readonly submissions: Submission[];
}

function createTemplate(
  overrides: Partial<WorkItemTemplateView> = {},
): WorkItemTemplateView {
  return {
    canManage: true,
    checklist: [],
    createdAt: "2026-01-01",
    departmentIds: [],
    description: "",
    id: "template-1",
    labelIds: [],
    name: "Fehlerbericht",
    ownerId: "user-1",
    priority: WORK_ITEM_PRIORITY.NORMAL,
    projectIds: [],
    scope: "private",
    title: "Fehler: ",
    type: WORK_ITEM_TYPE.TASK,
    updatedAt: "2026-01-01",
    ...overrides,
  };
}

const TICKET = {
  id: "item-1",
  key: "PAGE-1",
  title: "Absturz beim Speichern",
} as WorkItemDetail;

function readSubmission(formData: FormData): Submission {
  const entries: Record<string, string | string[]> = {};

  for (const key of new Set(formData.keys())) {
    const values = formData.getAll(key).map(String);

    entries[key] = values.length === 1 ? (values[0] ?? "") : values;
  }

  return entries;
}

function renderWithAction(
  element: React.ReactElement,
  result: Record<string, unknown>,
  access: { departments?: boolean; projects?: boolean } = {
    departments: true,
    projects: true,
  },
): Harness {
  const submissions: Submission[] = [];
  const router = createMemoryRouter(
    [
      {
        action: async ({ request }) => {
          submissions.push(readSubmission(await request.formData()));

          return result;
        },
        element,
        path: "/",
      },
    ],
    { initialEntries: ["/"] },
  );

  render(
    <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
      <TicketAccessProvider
        value={{
          assigneeGroupIdsByProject: {},
          assigneeGroups: [],
          canDelete: false,
          canWrite: true,
          departments: access.departments
            ? [
                { id: "department-1", name: "Entwicklung" },
                { id: "department-2", name: "Support" },
              ]
            : [],
          projects: access.projects
            ? [
                { id: "project-1", name: "Pages" },
                { id: "project-2", name: "AstroLab" },
              ]
            : [],
        }}
      >
        <RouterProvider router={router} />
      </TicketAccessProvider>
    </I18nextProvider>,
  );

  return { submissions };
}

const SAVED = { intent: "save-template", ok: true };

describe("TicketTemplateSaveDialog", () => {
  it("saves a private template under the ticket's title by default", async () => {
    const user = userEvent.setup();
    const { submissions } = renderWithAction(
      <TicketTemplateSaveDialog ticket={TICKET} />,
      SAVED,
    );

    await user.click(
      screen.getByRole("button", { name: "Als Vorlage speichern" }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "PAGE-1 als Vorlage speichern",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Name der Vorlage")).toHaveValue(
      "Absturz beim Speichern",
    );
    expect(screen.getByLabelText("Freigegeben für")).toHaveTextContent(
      "Nur ich",
    );

    await user.click(screen.getByRole("button", { name: "Vorlage speichern" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(submissions).toEqual([
      {
        intent: "save-template",
        name: "Absturz beim Speichern",
        scope: "private",
        ticketId: "item-1",
      },
    ]);
  });

  it("shares with the chosen departments", async () => {
    const user = userEvent.setup();
    const { submissions } = renderWithAction(
      <TicketTemplateSaveDialog ticket={TICKET} />,
      SAVED,
    );

    await user.click(
      screen.getByRole("button", { name: "Als Vorlage speichern" }),
    );
    await user.click(await screen.findByLabelText("Freigegeben für"));
    await user.click(
      await screen.findByRole("option", { name: "Abteilungen" }),
    );
    await user.click(screen.getByRole("checkbox", { name: "Support" }));
    await user.click(screen.getByRole("checkbox", { name: "Entwicklung" }));
    await user.click(screen.getByRole("checkbox", { name: "Entwicklung" }));
    await user.click(screen.getByRole("button", { name: "Vorlage speichern" }));

    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0]).toMatchObject({
      departmentIds: "department-2",
      scope: "departments",
    });
  });

  it("shares with the chosen projects", async () => {
    const user = userEvent.setup();
    const { submissions } = renderWithAction(
      <TicketTemplateSaveDialog ticket={TICKET} />,
      SAVED,
    );

    await user.click(
      screen.getByRole("button", { name: "Als Vorlage speichern" }),
    );
    await user.click(await screen.findByLabelText("Freigegeben für"));
    await user.click(await screen.findByRole("option", { name: "Projekte" }));
    await user.click(screen.getByRole("checkbox", { name: "Pages" }));
    await user.click(screen.getByRole("checkbox", { name: "AstroLab" }));
    await user.click(screen.getByRole("button", { name: "Vorlage speichern" }));

    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0]).toMatchObject({
      projectIds: ["project-1", "project-2"],
      scope: "projects",
    });
  });

  it("explains when there is nothing to share with", async () => {
    const user = userEvent.setup();

    renderWithAction(<TicketTemplateSaveDialog ticket={TICKET} />, SAVED, {});

    await user.click(
      screen.getByRole("button", { name: "Als Vorlage speichern" }),
    );
    await user.click(await screen.findByLabelText("Freigegeben für"));
    await user.click(
      await screen.findByRole("option", { name: "Abteilungen" }),
    );

    expect(screen.getByText(/Keine verfügbar/)).toBeInTheDocument();

    await user.click(screen.getByLabelText("Freigegeben für"));
    await user.click(await screen.findByRole("option", { name: "Projekte" }));

    expect(screen.getByText("Kein Projekt verfügbar.")).toBeInTheDocument();
  });

  it("keeps the dialog open and shows the failure", async () => {
    const user = userEvent.setup();

    renderWithAction(<TicketTemplateSaveDialog ticket={TICKET} />, {
      error: "forbidden",
      intent: "save-template",
      ok: false,
    });

    await user.click(
      screen.getByRole("button", { name: "Als Vorlage speichern" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Vorlage speichern" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Du bist nicht berechtigt",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes without saving on cancel", async () => {
    const user = userEvent.setup();
    const { submissions } = renderWithAction(
      <TicketTemplateSaveDialog ticket={TICKET} />,
      SAVED,
    );

    await user.click(
      screen.getByRole("button", { name: "Als Vorlage speichern" }),
    );
    await user.click(await screen.findByRole("button", { name: "Abbrechen" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(submissions).toEqual([]);
  });
});

describe("TemplateManagerDialog", () => {
  const OWN = createTemplate();
  const FOREIGN = createTemplate({
    canManage: false,
    id: "template-2",
    name: "Fremde Vorlage",
  });

  it("renders nothing without a template the visitor may manage", () => {
    renderWithAction(<TemplateManagerDialog templates={[FOREIGN]} />, SAVED);

    expect(
      screen.queryByRole("button", { name: "Vorlagen" }),
    ).not.toBeInTheDocument();
  });

  it("lists only manageable templates with their audience", async () => {
    const user = userEvent.setup();

    renderWithAction(
      <TemplateManagerDialog
        templates={[
          OWN,
          { ...OWN, id: "t3", name: "Teamvorlage", scope: "all" },
          FOREIGN,
        ]}
      />,
      SAVED,
    );

    await user.click(screen.getByRole("button", { name: "Vorlagen" }));

    expect(await screen.findByText("Fehlerbericht")).toBeInTheDocument();
    expect(screen.getByText("Nur ich")).toBeInTheDocument();
    expect(screen.getByText("Teamvorlage")).toBeInTheDocument();
    expect(screen.getByText("Alle")).toBeInTheDocument();
    expect(screen.queryByText("Fremde Vorlage")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("renames and reshares a template", async () => {
    const user = userEvent.setup();
    const { submissions } = renderWithAction(
      <TemplateManagerDialog
        templates={[
          createTemplate({
            departmentIds: ["department-1"],
            scope: "departments",
          }),
        ]}
      />,
      SAVED,
    );

    await user.click(screen.getByRole("button", { name: "Vorlagen" }));
    await user.click(
      await screen.findByRole("button", {
        name: "Vorlage Fehlerbericht bearbeiten",
      }),
    );

    expect(screen.getByLabelText("Name der Vorlage")).toHaveValue(
      "Fehlerbericht",
    );
    expect(screen.getByRole("checkbox", { name: "Entwicklung" })).toBeChecked();

    await user.clear(screen.getByLabelText("Name der Vorlage"));
    await user.type(screen.getByLabelText("Name der Vorlage"), "Bugreport");
    await user.click(screen.getByRole("button", { name: "Vorlage speichern" }));

    await waitFor(() =>
      expect(
        screen.queryByLabelText("Name der Vorlage"),
      ).not.toBeInTheDocument(),
    );
    expect(submissions).toEqual([
      {
        departmentIds: "department-1",
        intent: "save-template",
        name: "Bugreport",
        scope: "departments",
        templateId: "template-1",
      },
    ]);
  });

  it("leaves the edit form on cancel", async () => {
    const user = userEvent.setup();

    renderWithAction(<TemplateManagerDialog templates={[OWN]} />, SAVED);

    await user.click(screen.getByRole("button", { name: "Vorlagen" }));
    await user.click(
      await screen.findByRole("button", {
        name: "Vorlage Fehlerbericht bearbeiten",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(screen.queryByLabelText("Name der Vorlage")).not.toBeInTheDocument();
  });

  it("asks before it deletes a template", async () => {
    const user = userEvent.setup();
    const { submissions } = renderWithAction(
      <TemplateManagerDialog templates={[OWN]} />,
      { intent: "delete-template", ok: true },
    );

    await user.click(screen.getByRole("button", { name: "Vorlagen" }));
    await user.click(
      await screen.findByRole("button", {
        name: "Vorlage Fehlerbericht löschen",
      }),
    );

    expect(screen.getByText(/Vorlage „Fehlerbericht“ löschen/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Vorlage löschen" }));

    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0]).toEqual({
      intent: "delete-template",
      templateId: "template-1",
    });
  });

  it("shows why a template could not be deleted and can be cancelled", async () => {
    const user = userEvent.setup();

    renderWithAction(<TemplateManagerDialog templates={[OWN]} />, {
      error: "forbidden",
      intent: "delete-template",
      ok: false,
    });

    await user.click(screen.getByRole("button", { name: "Vorlagen" }));
    await user.click(
      await screen.findByRole("button", {
        name: "Vorlage Fehlerbericht löschen",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Vorlage löschen" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Du bist nicht berechtigt",
    );

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("useTemplateFetcher", () => {
  function Probe({
    onSucceeded,
  }: {
    readonly onSucceeded: () => void;
  }): React.ReactElement {
    const { fetcher, error } = useTemplateFetcher("save-template", onSucceeded);

    return (
      <fetcher.Form method="post">
        <input name="intent" type="hidden" value="anything" />
        <button type="submit">Los</button>
        <p>{error ?? "kein Fehler"}</p>
      </fetcher.Form>
    );
  }

  it("ignores results of other intents", async () => {
    const user = userEvent.setup();
    let succeeded = 0;

    renderWithAction(<Probe onSucceeded={() => (succeeded += 1)} />, {
      intent: "other",
      ok: true,
    });
    await user.click(screen.getByRole("button", { name: "Los" }));

    await waitFor(() => expect(screen.getByText("kein Fehler")).toBeVisible());
    expect(succeeded).toBe(0);
  });

  it("does not show failures of other intents", async () => {
    const user = userEvent.setup();

    renderWithAction(<Probe onSucceeded={() => undefined} />, {
      error: "forbidden",
      intent: "other",
      ok: false,
    });
    await user.click(screen.getByRole("button", { name: "Los" }));

    expect(await screen.findByText("kein Fehler")).toBeVisible();
  });
});
