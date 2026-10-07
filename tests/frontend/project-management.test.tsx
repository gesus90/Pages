// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArchivedProjectsContent } from "@/app/components/projects/overview/archived-projects-content";
import { ProjectManagementSection } from "@/app/components/projects/project-management-section";
import { ProjectDepartmentDialog } from "@/app/components/projects/project-department-dialog";
import { showSuccessToast } from "@/app/components/ui/toast";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

import type { Project, ProjectActionPermissions } from "@/definition/Project";

vi.mock("@/app/components/ui/toast", () => ({ showSuccessToast: vi.fn() }));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useActionData: vi.fn(), useNavigation: vi.fn() };
});

const PROJECT: Project = {
  id: "project",
  name: "Project",
  description: "Description",
  status: "active",
  progress: 0,
  departments: [{ id: "frontend", name: "Frontend" }],
  hasIcon: false,
  managerId: null,
  managerName: null,
  notes: "",
  parentId: null,
  placeholderColor: "#FCE3D3",
  startDate: null,
  targetDate: null,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
const CHOICES = {
  available: [
    { id: "frontend", name: "Frontend" },
    { id: "backend", name: "Backend" },
  ],
  selectionRequired: true,
};
const PERMISSIONS = {
  canEditGeneral: true,
  canChangeDepartments: true,
  canArchive: true,
  canDelete: true,
};
const IDLE = {
  state: "idle" as const,
  location: undefined,
  formAction: undefined,
  formMethod: undefined,
  formEncType: undefined,
  formData: undefined,
  json: undefined,
  text: undefined,
};

function renderSection(
  permissions: ProjectActionPermissions = PERMISSIONS,
  project = PROJECT,
  choices = CHOICES,
  outcome:
    | { ok: boolean; error?: string }
    | Promise<{ ok: boolean; error?: string }> = {
    ok: false,
    error: "forbidden",
  },
) {
  const submissions: FormData[] = [];
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <ProjectManagementSection
            project={project}
            permissions={permissions}
            departmentChoices={choices}
          />
        ),
        action: async ({ request }) => {
          submissions.push(await request.formData());
          return outcome;
        },
      },
    ],
    { initialEntries: ["/"] },
  );
  render(
    <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
  return submissions;
}

function renderArchive(projects: readonly Project[], canDelete: boolean): void {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <ArchivedProjectsContent projects={projects} canDelete={canDelete} />
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  render(
    <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("project assignment and lifecycle UI", () => {
  beforeEach(() => {
    vi.mocked(useNavigation).mockReturnValue(IDLE);
    vi.mocked(useActionData).mockReturnValue(undefined);
  });

  it("reports template save success only after its own request and prevents duplicate submissions", async () => {
    const user = userEvent.setup();
    let finish: (result: { ok: boolean }) => void = () => {
      throw new Error("Missing save callback");
    };
    const pending = new Promise<{ ok: boolean }>((resolve) => {
      finish = resolve;
    });
    const submissions = renderSection(PERMISSIONS, PROJECT, CHOICES, pending);
    const save = screen.getByRole("button", { name: "Als Vorlage speichern" });
    await user.click(save);
    expect(save).toBeDisabled();
    expect(submissions[0]?.get("intent")).toBe("save-template");
    expect(showSuccessToast).not.toHaveBeenCalled();
    await act(async () => {
      finish({ ok: true });
    });
    expect(save).toBeEnabled();
    expect(showSuccessToast).toHaveBeenCalledOnce();
    expect(showSuccessToast).toHaveBeenCalledWith(
      "Projektvorlage gespeichert.",
    );
  });

  it("keeps failed template saves local and unavailable to read-only viewers", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(
      screen.getByRole("button", { name: "Als Vorlage speichern" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "nicht berechtigt",
    );
    expect(showSuccessToast).not.toHaveBeenCalled();
  });

  it("hides template saving for read-only viewers", () => {
    renderSection({ ...PERMISSIONS, canEditGeneral: false });
    expect(
      screen.queryByRole("button", { name: "Als Vorlage speichern" }),
    ).toBeNull();
  });

  it.each([true, false])(
    "shows archive and permanent deletion according to their separate hints: archive=%s",
    (canArchive) => {
      renderSection({ ...PERMISSIONS, canArchive, canDelete: !canArchive });
      expect(
        screen.queryByRole("button", { name: "Archivieren" }) !== null,
      ).toBe(canArchive);
      expect(
        screen.queryByRole("button", { name: "Endgültig löschen" }) !== null,
      ).toBe(!canArchive);
    },
  );

  it("protects the last choice, submits all selected departments and restores the current assignment on reopen", async () => {
    const user = userEvent.setup();
    const submissions = renderSection();
    await user.click(
      screen.getByRole("button", { name: "Abteilungen bearbeiten" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("checkbox", { name: "Frontend" }),
    ).toBeDisabled();
    await user.click(within(dialog).getByRole("checkbox", { name: "Backend" }));
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Frontend" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(submissions[0]?.get("intent")).toBe("set-departments");
    expect(submissions[0]?.getAll("departmentIds")).toEqual(["backend"]);
    await user.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    await user.click(
      screen.getByRole("button", { name: "Abteilungen bearbeiten" }),
    );
    expect(screen.getByRole("checkbox", { name: "Frontend" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Backend" })).not.toBeChecked();
  });

  it("closes the assignment editor after fresh project data arrives from a successful redirect", async () => {
    const user = userEvent.setup();
    let currentProject = PROJECT;
    function ReloadedDialog(): React.ReactElement {
      const project = useLoaderData<Project>();
      return <ProjectDepartmentDialog project={project} choices={CHOICES} />;
    }
    const router = createMemoryRouter([
      { path: "/", loader: () => currentProject, element: <ReloadedDialog /> },
    ]);
    render(
      <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    );
    await user.click(
      await screen.findByRole("button", { name: "Abteilungen bearbeiten" }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    currentProject = {
      ...PROJECT,
      departments: [{ id: "backend", name: "Backend" }],
    };
    await act(async () => {
      await router.revalidate();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("explains partial responsibility and the orphan repair requirement without showing unavailable actions", () => {
    renderSection(
      {
        canEditGeneral: true,
        canChangeDepartments: false,
        canArchive: false,
        canDelete: false,
      },
      { ...PROJECT, departments: [] },
    );
    expect(
      screen.getByText(/erfordern Zuständigkeit für alle/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/bevor du Projektangaben speicherst/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Abteilungen bearbeiten" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Archivieren" })).toBeNull();
  });

  it("keeps orphan project saving disabled until a department is selected and shows service errors", async () => {
    const user = userEvent.setup();
    vi.mocked(useActionData).mockReturnValue({
      ok: false,
      error: "departmentRequired",
    });
    renderSection(PERMISSIONS, { ...PROJECT, departments: [] });
    await user.click(
      screen.getByRole("button", { name: "Abteilungen bearbeiten" }),
    );
    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "mindestens eine Abteilung",
    );
    await user.click(screen.getByRole("checkbox", { name: "Frontend" }));
    expect(screen.getByRole("button", { name: "Speichern" })).toBeEnabled();
  });

  it.each(["Archivieren", "Endgültig löschen"])(
    "requires confirmation before %s",
    async (label) => {
      const user = userEvent.setup();
      const submissions = renderSection();
      await user.click(screen.getByRole("button", { name: label }));
      expect(submissions).toHaveLength(0);
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent(
        label === "Archivieren"
          ? "Daten bleiben im Archiv"
          : "nicht rückgängig",
      );
      await user.click(within(dialog).getByRole("button", { name: label }));
      expect(submissions[0]?.get("intent")).toBe(
        label === "Archivieren" ? "archive-project" : "delete-project",
      );
      expect(submissions[0]?.get("projectId")).toBe("project");
    },
  );

  it("disables repeated submissions and preserves readable errors", async () => {
    const user = userEvent.setup();
    const formData = new FormData();
    formData.set("intent", "archive-project");
    vi.mocked(useNavigation).mockReturnValue({
      ...IDLE,
      state: "submitting",
      location: {
        pathname: "/",
        search: "",
        hash: "",
        state: null,
        key: "default",
      },
      formData,
      formMethod: "POST",
      formAction: "/",
      formEncType: "application/x-www-form-urlencoded",
    });
    vi.mocked(useActionData).mockReturnValue({ ok: false, error: "forbidden" });
    renderSection();
    await user.click(screen.getByRole("button", { name: "Archivieren" }));
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Archivieren",
      }),
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("nicht berechtigt");
  });

  it("does not replay successful outcomes as error messages", async () => {
    const user = userEvent.setup();
    vi.mocked(useActionData).mockReturnValue({ ok: true });
    renderSection();
    await user.click(
      screen.getByRole("button", { name: "Abteilungen bearbeiten" }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("allows the empty catalog exception and blocks duplicate assignment saves", async () => {
    const user = userEvent.setup();
    const formData = new FormData();
    formData.set("intent", "set-departments");
    vi.mocked(useNavigation).mockReturnValue({
      ...IDLE,
      state: "submitting",
      location: {
        pathname: "/",
        search: "",
        hash: "",
        state: null,
        key: "default",
      },
      formData,
      formMethod: "POST",
      formAction: "/",
      formEncType: "application/x-www-form-urlencoded",
    });
    renderSection(
      PERMISSIONS,
      { ...PROJECT, departments: [] },
      { available: [], selectionRequired: false },
    );
    await user.click(
      screen.getByRole("button", { name: "Abteilungen bearbeiten" }),
    );
    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
    expect(
      screen.getByText(/noch keine Abteilungen vorhanden/),
    ).toBeInTheDocument();
  });

  it("offers retained archive metadata without active project links", () => {
    renderArchive([PROJECT], true);
    expect(
      screen.getByRole("heading", { name: "Project" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Frontend")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Endgültig löschen" }),
    ).toBeInTheDocument();
  });

  it("keeps archive deletion unavailable to non-admin readers", () => {
    renderArchive([PROJECT], false);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("explains an empty archive selection", () => {
    renderArchive([], false);
    expect(screen.getByText(/Keine archivierten Projekte/)).toBeInTheDocument();
  });
});
