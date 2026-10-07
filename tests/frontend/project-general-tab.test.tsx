// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";

import { ProjectGeneralTab } from "@/app/components/projects/project-general-tab";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

import type {
  Project,
  ProjectEvent,
  ProjectGoal,
  ProjectMember,
} from "@/definition/Project";

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    createdAt: "2026-01-01",
    description: "Central platform.",
    departments: [],
    hasIcon: false,
    id: "abcdef123456",
    managerId: "user-1",
    managerName: "Alex Berger",
    name: "Pages",
    notes: "Key decisions.",
    parentId: null,
    placeholderColor: "#FCE3D3",
    progress: 62,
    startDate: "2026-09-05",
    status: "active",
    targetDate: "2026-12-15",
    updatedAt: "2026-09-05",
    ...overrides,
  };
}

const MEMBERS: readonly ProjectMember[] = [
  {
    displayName: "Alex Berger",
    joinedAt: "2026-01-01",
    projectRole: "manager",
    userId: "user-1",
    username: "alex",
  },
  {
    displayName: "Anna",
    joinedAt: "2026-01-02",
    projectRole: "member",
    userId: "user-2",
    username: "anna",
  },
];

function createGoal(overrides: Partial<ProjectGoal> = {}): ProjectGoal {
  return {
    id: "goal-1",
    isDone: false,
    position: 0,
    projectId: "abcdef123456",
    title: "Ship it",
    ...overrides,
  };
}

function createEvent(overrides: Partial<ProjectEvent> = {}): ProjectEvent {
  return {
    createdAt: "2026-01-01",
    description: "",
    eventDate: "2026-09-12",
    eventTime: null,
    id: "event-1",
    projectId: "abcdef123456",
    title: "Kickoff",
    type: "meeting",
    updatedAt: "2026-01-01",
    ...overrides,
  };
}

interface TabProps {
  readonly project?: Project;
  readonly goals?: readonly ProjectGoal[];
  readonly tags?: readonly string[];
  readonly events?: readonly ProjectEvent[];
  readonly canWrite?: boolean;
}

interface Rendered {
  readonly submissions: Record<string, string>[];
}

function renderTab(props: TabProps = {}): Rendered {
  const submissions: Rendered["submissions"] = [];

  async function action({ request }: { request: Request }): Promise<null> {
    const formData = await request.formData();

    submissions.push(
      Object.fromEntries(
        [...formData.entries()].map(([key, value]) => [
          key,
          value instanceof File ? `file:${value.name}` : String(value),
        ]),
      ),
    );

    return null;
  }

  const router = createMemoryRouter(
    [
      {
        action,
        element: (
          <ProjectGeneralTab
            permissions={{
              canEditGeneral: props.canWrite ?? true,
              canChangeDepartments: false,
              canArchive: false,
              canDelete: false,
            }}
            departmentChoices={{ available: [], selectionRequired: false }}
            canWrite={props.canWrite ?? true}
            events={props.events ?? []}
            goals={props.goals ?? []}
            members={MEMBERS}
            milestones={[]}
            project={props.project ?? createProject()}
            tags={props.tags ?? []}
            workItems={[]}
          />
        ),
        path: "/",
      },
      { action, element: <p>icon</p>, path: "/projekte/:id/icon" },
    ],
    { initialEntries: ["/"] },
  );

  render(
    <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );

  return { submissions };
}

function descriptionText(): HTMLElement {
  return screen.getByText("Central platform.");
}

describe("GeneralDescriptionSection", () => {
  it("shows the description and tags to readers without editing", () => {
    renderTab({ canWrite: false, tags: ["web", "internal"] });

    expect(descriptionText()).not.toHaveAttribute("tabindex");
    expect(
      screen.queryByRole("button", { name: "Central platform." }),
    ).toBeNull();
    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.getByText("internal")).toBeInTheDocument();

    fireEvent.doubleClick(descriptionText());
    fireEvent.keyDown(descriptionText(), { key: "Enter" });

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("falls back to a hint without description and tags", () => {
    renderTab({ project: createProject({ description: "" }) });

    expect(
      screen.getByText("Keine Beschreibung hinterlegt."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "" })).toBeNull();
  });

  it("starts editing by double click and offers saving only for changes", async () => {
    const user = userEvent.setup();
    const { submissions } = renderTab();

    await user.dblClick(descriptionText());

    const editor = screen.getByRole("textbox", { name: "Projektbeschreibung" });

    expect(editor).toHaveValue("Central platform.");
    expect(editor).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Speichern" })).toBeNull();

    await user.type(editor, " More.");

    expect(screen.getByText("23 / 5000 Zeichen")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Speichern" }));

    expect(submissions).toEqual([
      { description: "Central platform. More.", intent: "update-description" },
    ]);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("offers the description to writers as a button that starts editing", async () => {
    const user = userEvent.setup();

    renderTab();
    await user.click(screen.getByRole("button", { name: "Central platform." }));

    expect(screen.queryByRole("textbox")).toBeNull();

    await user.dblClick(
      screen.getByRole("button", { name: "Central platform." }),
    );

    expect(screen.getByRole("textbox")).toHaveValue("Central platform.");

    await user.keyboard("{Escape}");
    screen.getByRole("button", { name: "Central platform." }).focus();
    await user.keyboard(" ");

    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("groups long drafts with a thousands separator", async () => {
    const user = userEvent.setup();

    renderTab({ project: createProject({ description: "x".repeat(1234) }) });
    await user.dblClick(screen.getByText("x".repeat(1234)));

    expect(screen.getByText("1.234 / 5000 Zeichen")).toBeInTheDocument();
  });

  it("starts editing with Enter and ignores other keys", async () => {
    const user = userEvent.setup();

    renderTab();
    descriptionText().focus();
    await user.keyboard("a");

    expect(screen.queryByRole("textbox")).toBeNull();

    await user.keyboard("{Enter}");

    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("cancels with Escape or the cancel button and forgets the draft", async () => {
    const user = userEvent.setup();

    renderTab();
    await user.dblClick(descriptionText());
    await user.type(screen.getByRole("textbox"), "abc");
    await user.keyboard("x{Escape}");

    expect(screen.queryByRole("textbox")).toBeNull();

    await user.dblClick(descriptionText());

    expect(screen.getByRole("textbox")).toHaveValue("Central platform.");

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("GeneralGoalsSection", () => {
  it("explains that there are no goals", () => {
    renderTab();

    expect(
      screen.getByText("Noch keine Ziele hinterlegt."),
    ).toBeInTheDocument();
  });

  it("lists goals without controls for readers", () => {
    renderTab({
      canWrite: false,
      goals: [
        createGoal(),
        createGoal({ id: "goal-2", isDone: true, title: "Done" }),
      ],
    });

    expect(screen.getByText("Offen")).toBeInTheDocument();
    expect(screen.getByText("Erledigt")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ship it" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Ziel hinzufügen" }),
    ).toBeNull();
  });

  it("toggles and deletes goals for writers", async () => {
    const user = userEvent.setup();
    const { submissions } = renderTab({
      goals: [
        createGoal(),
        createGoal({ id: "goal-2", isDone: true, title: "Done" }),
      ],
    });

    await user.click(screen.getByRole("button", { name: "Ship it" }));
    await user.click(screen.getByRole("button", { name: /^.*: Done$/ }));

    expect(submissions).toEqual([
      { goalId: "goal-1", intent: "toggle-goal" },
      { goalId: "goal-2", intent: "delete-goal" },
    ]);
  });

  it("shows the form for a new goal on demand", async () => {
    const user = userEvent.setup();
    const { submissions } = renderTab();

    expect(screen.queryByRole("textbox", { name: "Projektziele" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Ziel hinzufügen" }));
    await user.type(
      screen.getByRole("textbox", { name: "Projektziele" }),
      "New goal",
    );
    await user.click(screen.getByRole("button", { name: "Erstellen" }));

    expect(submissions).toEqual([{ intent: "create-goal", title: "New goal" }]);

    await user.click(screen.getByRole("button", { name: "Ziel hinzufügen" }));

    expect(screen.queryByRole("textbox", { name: "Projektziele" })).toBeNull();
  });
});

describe("GeneralNextDatesSection", () => {
  it("lists at most four dates with their time", () => {
    renderTab({
      events: [
        createEvent({ eventTime: "10:30", id: "e1", title: "First" }),
        createEvent({ id: "e2", title: "Second" }),
        createEvent({ id: "e3", title: "Third" }),
        createEvent({ id: "e4", title: "Fourth" }),
        createEvent({ id: "e5", title: "Fifth" }),
      ],
    });

    expect(screen.getByText("10:30")).toBeInTheDocument();
    expect(screen.getByText("Fourth")).toBeInTheDocument();
    expect(screen.queryByText("Fifth")).toBeNull();
    expect(screen.getAllByText("12.09.2026")).toHaveLength(4);
  });

  it("says so without dates", () => {
    renderTab();

    expect(screen.getByText("Keine anstehenden Termine.")).toBeInTheDocument();
  });
});

describe("GeneralIconSection", () => {
  it("shows the stored icon", () => {
    renderTab({ project: createProject({ hasIcon: true }) });

    expect(
      document.querySelector('img[src="/projekte/abcdef123456/icon"]'),
    ).not.toBeNull();
  });

  it("falls back to the first letter of the name", () => {
    renderTab({ project: createProject({ name: " pages" }) });

    expect(screen.getByText("P")).toBeInTheDocument();
  });

  it("offers no upload to readers", () => {
    renderTab({ canWrite: false });

    expect(screen.queryByLabelText("Icon ändern")).toBeNull();
  });
});

describe("GeneralDetailsSection", () => {
  it("shows facts as text to readers", () => {
    renderTab({
      canWrite: false,
      project: createProject({
        managerId: null,
        managerName: null,
        startDate: null,
      }),
    });

    expect(screen.getByText("Aktiv")).toBeInTheDocument();
    expect(screen.getByText("Nicht zugewiesen")).toBeInTheDocument();
    expect(screen.getByText("---")).toBeInTheDocument();
    expect(screen.getByText("15.12.2026")).toBeInTheDocument();
    expect(screen.getByText("abcdef12")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bearbeiten" })).toBeNull();
  });

  it("shows the manager name to readers", () => {
    renderTab({ canWrite: false });

    expect(screen.getByText("Alex Berger")).toBeInTheDocument();
  });

  it("changes status and manager inline", async () => {
    const user = userEvent.setup();
    const { submissions } = renderTab();

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Pausiert" }));
    await user.click(screen.getByRole("combobox", { name: "Projektmanager" }));
    await user.click(await screen.findByRole("option", { name: "Anna" }));
    await user.click(screen.getByRole("combobox", { name: "Projektmanager" }));
    await user.click(
      await screen.findByRole("option", { name: "Nicht zugewiesen" }),
    );

    expect(submissions).toEqual([
      { intent: "update-status", status: "paused" },
      { intent: "update-manager", managerId: "user-2" },
      { intent: "update-manager", managerId: "" },
    ]);
  });

  it("changes the start date inline and keeps the target date", async () => {
    const user = userEvent.setup();
    const { submissions } = renderTab();

    await user.click(screen.getByRole("button", { name: "Startdatum" }));

    expect(screen.getByLabelText("Startdatum")).toHaveFocus();

    fireEvent.change(screen.getByLabelText("Startdatum"), {
      target: { value: "2026-10-01" },
    });

    await waitFor(() => expect(submissions).toHaveLength(1));

    expect(submissions[0]).toEqual({
      intent: "update-dates",
      startDate: "2026-10-01",
      targetDate: "2026-12-15",
    });
  });

  it("changes the target date inline and keeps the start date", async () => {
    const user = userEvent.setup();
    const { submissions } = renderTab({
      project: createProject({ startDate: null, targetDate: null }),
    });

    await user.click(screen.getByRole("button", { name: "Zieltermin" }));
    fireEvent.change(screen.getByLabelText("Zieltermin"), {
      target: { value: "2027-01-01" },
    });

    await waitFor(() => expect(submissions).toHaveLength(1));

    expect(submissions[0]).toEqual({
      intent: "update-dates",
      startDate: "",
      targetDate: "2027-01-01",
    });
  });

  it("closes the inline date picker with Escape or on blur", async () => {
    const user = userEvent.setup();

    renderTab();
    await user.click(screen.getByRole("button", { name: "Startdatum" }));
    await user.keyboard("a{Escape}");

    expect(
      screen.getByRole("button", { name: "Startdatum" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Startdatum" }));
    await user.click(document.body);

    expect(
      screen.getByRole("button", { name: "Startdatum" }),
    ).toBeInTheDocument();
  });

  it("edits all details in the dialog", async () => {
    const user = userEvent.setup();
    const { submissions } = renderTab({
      project: createProject({
        managerId: null,
        startDate: null,
        targetDate: null,
      }),
    });

    await user.click(screen.getByRole("button", { name: "Bearbeiten" }));

    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText(/^Name/)).toBeTruthy();
    await user.click(within(dialog).getByRole("combobox", { name: "Status" }));
    await user.click(
      await screen.findByRole("option", { name: "Abgeschlossen" }),
    );
    await user.click(
      within(dialog).getByRole("combobox", { name: "Projektmanager" }),
    );
    await user.click(await screen.findByRole("option", { name: "Anna" }));
    await user.type(within(dialog).getByLabelText("Notizen"), " Extra");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));

    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({
      intent: "update-details",
      managerId: "user-2",
      notes: "Key decisions. Extra",
      startDate: "",
      status: "completed",
      targetDate: "",
    });
  });

  it("closes the dialog without submitting", async () => {
    const user = userEvent.setup();
    const { submissions } = renderTab();

    await user.click(screen.getByRole("button", { name: "Bearbeiten" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Abbrechen",
      }),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(submissions).toEqual([]);
  });
});

describe("GeneralNotesSection and quick actions", () => {
  it("shows notes or a hint", () => {
    renderTab();

    expect(screen.getByText("Key decisions.")).toBeInTheDocument();
  });

  it("explains that there are no notes", () => {
    renderTab({ project: createProject({ notes: "" }) });

    expect(screen.getByText("Keine Notizen hinterlegt.")).toBeInTheDocument();
  });

  it("links to tasks, planning and the team", () => {
    renderTab();

    expect(screen.getByRole("link", { name: "Neue Aufgabe" })).toHaveAttribute(
      "href",
      "/aufgaben",
    );
    expect(screen.getByRole("link", { name: "Termin planen" })).toHaveAttribute(
      "href",
      "/?tab=planning",
    );
    expect(
      screen.getByRole("link", { name: "Team verwalten" }),
    ).toHaveAttribute("href", "/?tab=team");
  });
});
