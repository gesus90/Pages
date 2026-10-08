// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useActionData,
  useNavigation,
  useSubmit,
} from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ManagementWorkspace } from "@/app/components/users/management-workspace";
import { Toaster } from "@/app/components/ui/toast";
import { createI18n } from "@/app/lib/i18n";
import { CAPABILITY } from "@/definition/Authorization";
import {
  administrationPage,
  managedUser,
} from "../helpers/administration-page";
import { createAccess, createRole } from "../helpers/authorization";

import type { AdministrationPageData } from "@/definition/Authorization";
import type { UsersActionData } from "@/app/lib/user-actions/user-action-support.server";

vi.mock("react-router", async (original) => ({
  ...(await original<typeof import("react-router")>()),
  useActionData: vi.fn(),
  useNavigation: vi.fn(),
  useSubmit: vi.fn(),
}));

const ROLES = [
  createRole({ id: "reader", name: "Reader", rank: 1, permissions: [] }),
];
const DEPARTMENTS = [
  { id: "frontend", name: "Frontend" },
  { id: "backend", name: "Backend" },
  { id: "hr", name: "HR" },
];

function renderWorkspace(initial: AdministrationPageData): {
  update: (
    result: UsersActionData | undefined,
    directory?: AdministrationPageData,
  ) => void;
} {
  let updateDirectory: (directory: AdministrationPageData) => void = () => {};
  let refresh: () => void = () => {};
  function Harness(): React.ReactElement {
    const [directory, setDirectory] = useState(initial);
    const [, setVersion] = useState(0);
    updateDirectory = setDirectory;
    refresh = () => setVersion((current) => current + 1);
    return (
      <>
        <ManagementWorkspace directory={directory} privateWikiPages={{}} />
        <Toaster />
      </>
    );
  }
  const router = createMemoryRouter(
    [{ path: "/users", element: <Harness /> }],
    { initialEntries: ["/users"] },
  );
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
  return {
    update(result, directory): void {
      act(() => {
        vi.mocked(useActionData).mockReturnValue(result);
        if (directory) updateDirectory(directory);
        refresh();
      });
    },
  };
}

function directory(): AdministrationPageData {
  return {
    ...administrationPage([], ROLES),
    departments: DEPARTMENTS,
    manageableDepartmentIds: ["frontend", "backend"],
    adoptableDepartmentIds: ["frontend"],
  };
}

beforeEach(() => {
  vi.mocked(useSubmit).mockReturnValue(vi.fn());
  vi.mocked(useNavigation).mockReturnValue({
    state: "idle",
    location: undefined,
    formAction: undefined,
    formMethod: undefined,
    formEncType: undefined,
    formData: undefined,
    json: undefined,
    text: undefined,
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("management catalogs", () => {
  it("creates roles with immutable reading, department binding and a scoped rank", async () => {
    const user = userEvent.setup();
    const harness = renderWorkspace({
      ...directory(),
      assignableRoles: [],
      editableRoleIds: [],
    });
    await user.click(screen.getByRole("tab", { name: "Rollen" }));
    expect(screen.getByText("Noch keine Rollen angelegt.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rolle anlegen" }));
    const panel = screen.getByRole("dialog");
    expect(
      within(panel).getByRole("checkbox", { name: "Lesen (immer aktiv)" }),
    ).toBeChecked();
    expect(
      within(panel).getByRole("checkbox", { name: "Lesen (immer aktiv)" }),
    ).toBeDisabled();
    expect(
      within(panel).getByRole("checkbox", { name: "Abteilungsbindung" }),
    ).toBeChecked();
    await user.type(within(panel).getByLabelText("Name"), "Reader");
    await user.clear(within(panel).getByLabelText("Hierarchierang"));
    await user.type(within(panel).getByLabelText("Hierarchierang"), "4");
    const form = panel.querySelector("form");
    if (!form) throw new Error("Missing role form");
    expect(new FormData(form).get("rank")).toBe("4");
    harness.update({ intent: "save-role", ok: false, error: "forbidden" });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    harness.update({ intent: "save-role", ok: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Gespeichert");
    await user.click(screen.getByRole("button", { name: "Rolle anlegen" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("edits existing roles and disables forbidden delegation even when the actor holds it", async () => {
    const user = userEvent.setup();
    const actor = createAccess({
      role: createRole({ permissions: [CAPABILITY.MANAGE_ROLES] }),
    });
    renderWorkspace({ ...directory(), actor });
    await user.click(screen.getByRole("tab", { name: "Rollen" }));
    await user.click(screen.getByRole("button", { name: "Reader bearbeiten" }));
    const panel = screen.getByRole("dialog");
    expect(within(panel).getByLabelText("Name")).toHaveValue("Reader");
    expect(
      within(panel).getByRole("checkbox", { name: "Rollen verwalten" }),
    ).toBeDisabled();
    expect(
      within(panel).getByRole("checkbox", { name: "Schreiben" }),
    ).toBeDisabled();
    await user.click(within(panel).getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("blocks deletion for assigned or uneditable roles and confirms unassigned deletion", async () => {
    const user = userEvent.setup();
    const assigned = {
      ...managedUser(),
      account: createAccess({ role: ROLES[0] }),
    };
    const harness = renderWorkspace({ ...directory(), users: [assigned] });
    await user.click(screen.getByRole("tab", { name: "Rollen" }));
    expect(
      screen.getByRole("button", { name: "Reader löschen?" }),
    ).toBeDisabled();
    harness.update(undefined, { ...directory(), editableRoleIds: [] });
    expect(
      screen.getByRole("button", { name: "Reader bearbeiten" }),
    ).toBeDisabled();
    harness.update(undefined, directory());
    await user.click(screen.getByRole("button", { name: "Reader löschen?" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Zugewiesene Benutzer",
    );
    harness.update({ intent: "delete-role", ok: false, error: "inUse" });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    harness.update({ intent: "delete-role", ok: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("creates and renames departments and explains the final-department deletion exception", async () => {
    const user = userEvent.setup();
    const harness = renderWorkspace(directory());
    await user.click(screen.getByRole("tab", { name: "Abteilungen" }));
    expect(
      screen.getByRole("button", { name: "HR bearbeiten" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Abteilung anlegen" }));
    await user.type(screen.getByLabelText("Name"), "Support");
    harness.update({ intent: "save-department", ok: true });
    await user.click(
      screen.getByRole("button", { name: "Frontend bearbeiten" }),
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Frontend");
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    await user.click(screen.getByRole("button", { name: "Frontend löschen?" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "abteilungslose Benutzer",
    );
    harness.update({ intent: "delete-department", ok: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    harness.update(undefined, { ...directory(), departments: [] });
    expect(
      screen.getByText("Noch keine Abteilungen verfügbar."),
    ).toBeInTheDocument();
  });

  it("lists groups, creates them with members and confirms deletion", async () => {
    const user = userEvent.setup();
    const harness = renderWorkspace({
      ...directory(),
      users: [
        managedUser({ id: "anna", displayName: "Anna" }),
        managedUser({ id: "ben", displayName: "Ben" }),
        {
          ...managedUser({ id: "gone", displayName: "Gone" }),
          account: createAccess({ userId: "gone", isActive: false }),
        },
      ],
      groups: {
        canManage: true,
        groups: [
          {
            canEdit: true,
            id: "team",
            memberCount: 1,
            memberIds: ["anna"],
            name: "Team",
          },
          {
            canEdit: false,
            id: "mixed",
            memberCount: 3,
            memberIds: [],
            name: "Mixed",
          },
          {
            canEdit: true,
            id: "empty",
            memberCount: 0,
            memberIds: [],
            name: "Empty",
          },
        ],
      },
    });
    await user.click(screen.getByRole("tab", { name: "Gruppen" }));
    expect(screen.getByText("Mitglieder: 1")).toBeInTheDocument();
    expect(screen.getByText("Leer – nicht zuweisbar")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mixed bearbeiten" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Mixed löschen?" }),
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Gruppe anlegen" }));
    const panel = screen.getByRole("dialog");
    expect(
      within(panel).getByRole("checkbox", { name: "Anna" }),
    ).not.toBeChecked();
    expect(
      within(panel).queryByRole("checkbox", { name: "Gone" }),
    ).not.toBeInTheDocument();
    await user.type(within(panel).getByLabelText("Name"), "Platform");
    await user.click(within(panel).getByRole("checkbox", { name: "Ben" }));
    const form = panel.querySelector("form");
    if (!form) throw new Error("Missing group form");
    expect(new FormData(form).getAll("member")).toEqual(["ben"]);
    harness.update({ intent: "save-group", ok: false, error: "invalidInput" });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    harness.update({ intent: "save-group", ok: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Team bearbeiten" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Team");
    expect(screen.getByRole("checkbox", { name: "Anna" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    await user.click(screen.getByRole("button", { name: "Team löschen?" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "nicht mehr zugewiesen",
    );
    harness.update({ intent: "delete-group", ok: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    harness.update(undefined, {
      ...directory(),
      users: [],
      groups: { canManage: true, groups: [] },
    });
    expect(
      screen.getByText("Noch keine Gruppen angelegt."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Gruppe anlegen" }));
    expect(
      screen.getByText("Keine aktiven Benutzer verfügbar."),
    ).toBeInTheDocument();
  });

  it("hides the group section without the right to manage users", () => {
    renderWorkspace({
      ...directory(),
      groups: { canManage: false, groups: [] },
    });
    expect(
      screen.queryByRole("tab", { name: "Gruppen" }),
    ).not.toBeInTheDocument();
  });

  it("hides unauthorized sections and returns to users if role management is revoked", async () => {
    const user = userEvent.setup();
    const harness = renderWorkspace(directory());
    await user.click(screen.getByRole("tab", { name: "Rollen" }));
    harness.update(undefined, {
      ...directory(),
      canManageRoles: false,
      canManageDepartments: false,
      canCreate: false,
    });
    expect(
      screen.queryByRole("tab", { name: "Rollen" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Abteilungen" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Benutzer" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.queryByRole("button", { name: "Benutzer erstellen" }),
    ).not.toBeInTheDocument();
  });
});

describe("account access dialogs", () => {
  it("assigns a role to an admin without a role and hides unavailable membership actions", async () => {
    const target = {
      ...managedUser({ displayName: "Unassigned" }),
      account: createAccess({ isAdmin: true, role: null }),
      canManageMemberships: false,
    };
    const harness = renderWorkspace({ ...directory(), users: [target] });
    await userEvent.click(
      screen.getByRole("button", { name: "Aktionen für Unassigned" }),
    );
    expect(
      screen.queryByRole("menuitem", { name: "Abteilungen zuordnen" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Rolle ändern" }),
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Rolle" }));
    await userEvent.click(screen.getByRole("option", { name: "Reader" }));
    harness.update({ intent: "set-role", ok: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("retains foreign memberships and keeps scopes and admin eligibility in separate actions", async () => {
    const user = userEvent.setup();
    const target = {
      ...managedUser({ displayName: "Alex" }),
      account: createAccess({
        userId: "target",
        departments: ["frontend", "hr"],
        allDepartments: true,
        allProjects: true,
      }),
    };
    const harness = renderWorkspace({ ...directory(), users: [target] });
    await user.click(screen.getByRole("button", { name: "Aktionen für Alex" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Abteilungen zuordnen" }),
    );
    const panel = screen.getByRole("dialog");
    expect(within(panel).getByRole("checkbox", { name: "HR" })).toBeDisabled();
    const form = panel.querySelector("form");
    if (!form) throw new Error("Missing membership form");
    expect(new FormData(form).getAll("department")).toEqual(["frontend", "hr"]);
    harness.update({ intent: "set-memberships", ok: true });
    await user.click(screen.getByRole("button", { name: "Aktionen für Alex" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Verwaltungsbereich" }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Alle Abteilungen verwalten" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Alle Projekte verwalten" }),
    ).toBeChecked();
    harness.update({ intent: "set-scope", ok: true });
    await user.click(screen.getByRole("button", { name: "Aktionen für Alex" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Persönliche Admin-Berechtigung" }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Persönliche Admin-Berechtigung" }),
    ).not.toBeChecked();
    harness.update({
      intent: "set-admin",
      ok: false,
      error: "lastAdministrator",
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("limits adoption to selectable departments and hides unrelated profile and scope actions", async () => {
    const user = userEvent.setup();
    const orphan = {
      ...managedUser({ displayName: "Orphan" }),
      account: createAccess({ departments: [] }),
      canEditProfile: false,
      canManageAccess: false,
      canManageScope: false,
    };
    renderWorkspace({ ...directory(), users: [orphan] });
    await user.click(
      screen.getByRole("button", { name: "Aktionen für Orphan" }),
    );
    expect(
      screen.queryByRole("menuitem", { name: "Bearbeiten" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Verwaltungsbereich" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Passwort zurücksetzen" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("menuitem", { name: "Abteilungen zuordnen" }),
    );
    expect(screen.getByRole("checkbox", { name: "Frontend" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Backend" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
  });

  it("shows admin accounts without a role and keeps users with no action rights read-only", () => {
    const target = {
      ...managedUser({ displayName: "Admin", canManage: false }),
      account: createAccess({ role: null }),
    };
    renderWorkspace({ ...directory(), users: [target] });
    expect(
      screen.queryByRole("button", { name: "Aktionen für Admin" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
  });
});

describe("onboarding panel dismissal", () => {
  it("selects from multiple roles as a normal manager and confirms discarding a role-only change", async () => {
    renderWorkspace({
      ...directory(),
      actor: createAccess(),
      assignableRoles: [...ROLES, createRole({ id: "writer", name: "Writer" })],
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Benutzer erstellen" }),
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Rolle" }));
    await userEvent.click(screen.getByRole("option", { name: "Reader" }));
    vi.mocked(window.confirm).mockReturnValue(false);
    await userEvent.click(screen.getByRole("button", { name: "Schließen" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("keeps changed fields when discard is declined and clears them after explicit dismissal", async () => {
    const user = userEvent.setup();
    renderWorkspace(directory());
    await user.click(
      screen.getByRole("button", { name: "Benutzer erstellen" }),
    );
    await user.type(screen.getByLabelText("Vorname"), "Changed");
    vi.mocked(window.confirm).mockReturnValue(false);
    await user.click(screen.getByRole("button", { name: "Schließen" }));
    expect(screen.getByLabelText("Vorname")).toHaveValue("Changed");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    vi.mocked(window.confirm).mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Benutzer erstellen" }),
    );
    expect(screen.getByLabelText("Vorname")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Schließen" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers the roleless admin exception and preserves optional departments", async () => {
    const user = userEvent.setup();
    renderWorkspace(directory());
    await user.click(
      screen.getByRole("button", { name: "Benutzer erstellen" }),
    );
    await user.click(screen.getByRole("combobox", { name: "Rolle" }));
    await user.click(
      screen.getByRole("option", { name: "Keine Rolle (Admin-Konto)" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Persönliche Admin-Berechtigung" }),
    );
    const form = screen.getByRole("dialog").querySelector("form");
    if (!form) throw new Error("Missing onboarding form");
    expect(new FormData(form).get("role")).toBe("");
    expect(new FormData(form).get("isAdmin")).toBe("true");
    expect(new FormData(form).getAll("department")).toEqual([]);
  });

  it("uses a sole role for normal users and explains empty role and department catalogs", async () => {
    const user = userEvent.setup();
    const harness = renderWorkspace({
      ...directory(),
      actor: createAccess(),
      departments: [],
    });
    await user.click(
      screen.getByRole("button", { name: "Benutzer erstellen" }),
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("Reader")).toBeInTheDocument();
    expect(
      screen.getByText("Noch keine Abteilungen verfügbar."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    harness.update(undefined, {
      ...directory(),
      actor: createAccess(),
      assignableRoles: [],
    });
    await user.click(
      screen.getByRole("button", { name: "Benutzer erstellen" }),
    );
    expect(screen.getByText("Noch keine Rollen angelegt.")).toBeInTheDocument();
  });
});

describe("scoped directory search", () => {
  it("resets an empty filtered result to the visible server scope", async () => {
    renderWorkspace({
      ...directory(),
      users: [managedUser({ displayName: "Visible" })],
    });
    await userEvent.type(screen.getByRole("searchbox"), "missing");
    await userEvent.click(
      screen.getByRole("button", { name: "Filter zurücksetzen" }),
    );
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByText("Visible")).toBeInTheDocument();
  });
});
