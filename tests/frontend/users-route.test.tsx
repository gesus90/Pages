// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return {
    ...actual,
    useActionData: vi.fn(),
    useLoaderData: vi.fn(),
    useNavigation: vi.fn(),
    useSubmit: vi.fn(),
  };
});

import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";

import { createI18n } from "@/app/lib/i18n";
import { ROLE } from "@/definition/Role";
import { LANGUAGE } from "@/language/Language";
import UsersRoute from "@/app/routes/users";
import {
  administrationPage,
  directoryRoles,
  managedUser,
} from "../helpers/administration-page";

const mockedActionData = vi.mocked(useActionData);
const mockedLoaderData = vi.mocked(useLoaderData);
const mockedNavigation = vi.mocked(useNavigation);
const mockedSubmit = vi.mocked(useSubmit);

interface TestUser {
  readonly canManage: boolean;
  readonly displayName: string;
  readonly id: string;
  readonly isActive: boolean;
  readonly role: string;
  readonly username: string;
}

const MANAGEABLE_ADMIN: TestUser = {
  canManage: true,
  displayName: "Admin",
  id: "user-1",
  isActive: true,
  role: ROLE.ADMIN,
  username: "admin",
};

const LOCKED_EMPLOYEE: TestUser = {
  canManage: false,
  displayName: "Sam",
  id: "user-2",
  isActive: false,
  role: ROLE.EMPLOYEE,
  username: "sam",
};

function mockIdleNavigation(): void {
  mockedNavigation.mockReturnValue({
    state: "idle",
  } as unknown as ReturnType<typeof useNavigation>);
}

function mockSubmittingNavigation(entries: Record<string, string>): void {
  const formData = new FormData();

  for (const [key, value] of Object.entries(entries)) {
    formData.append(key, value);
  }

  mockedNavigation.mockReturnValue({
    formData,
    state: "submitting",
  } as unknown as ReturnType<typeof useNavigation>);
}

function renderUsers(
  users: readonly TestUser[] = [MANAGEABLE_ADMIN, LOCKED_EMPLOYEE],
  assignableRoles: readonly string[] = [
    ROLE.ADMIN,
    ROLE.MANAGER,
    ROLE.EMPLOYEE,
  ],
  actionData: unknown = undefined,
  submitting: Record<string, string> | null = null,
  submit: ReturnType<typeof useSubmit> = vi.fn(),
): void {
  mockedLoaderData.mockReturnValue(
    administrationPage(
      users.map((user) => managedUser(user)),
      directoryRoles(assignableRoles),
    ),
  );
  mockedActionData.mockReturnValue(actionData);
  mockedSubmit.mockReturnValue(submit);

  if (submitting) {
    mockSubmittingNavigation(submitting);
  } else {
    mockIdleNavigation();
  }

  const i18n = createI18n(LANGUAGE.GERMAN);
  const router = createMemoryRouter(
    [{ element: <UsersRoute />, path: "/users" }],
    { initialEntries: ["/users"] },
  );

  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("UsersRoute", () => {
  it("renders the directory with one row per user", () => {
    renderUsers();

    expect(
      screen.getByRole("heading", { name: "Benutzerverwaltung" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("sam")).toBeInTheDocument();
    expect(screen.getByText("Administrator")).toBeInTheDocument();
    expect(screen.getByText("Angestellter")).toBeInTheDocument();
  });

  it("marks active and inactive accounts", () => {
    renderUsers();

    expect(screen.getByText("Aktiv")).toBeInTheDocument();
    expect(screen.getByText("Inaktiv")).toBeInTheDocument();
  });

  it("shows state-change errors above the directory", () => {
    renderUsers([MANAGEABLE_ADMIN], [ROLE.ADMIN], {
      error: "lastAdministrator",
      intent: "set-active",
      ok: false,
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Der letzte aktive Administrator kann nicht deaktiviert werden.",
    );
  });

  it("hides creation errors from the directory level", () => {
    renderUsers([MANAGEABLE_ADMIN], [ROLE.ADMIN], {
      error: "usernameTaken",
      intent: "create-user",
      ok: false,
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("CreateUserDialog", () => {
  it("opens the creation form from the trigger", async () => {
    const user = userEvent.setup();
    renderUsers();

    await user.click(
      screen.getByRole("button", { name: "Benutzer erstellen" }),
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Vorname")).toBeInTheDocument();
    expect(screen.getByLabelText("Nachname")).toBeRequired();
    expect(screen.getByLabelText("Benutzername")).toBeInTheDocument();
    expect(screen.queryByLabelText("Passwort")).not.toBeInTheDocument();
  });

  it("offers every assignable role to administrators", async () => {
    const user = userEvent.setup();
    renderUsers();

    await user.click(
      screen.getByRole("button", { name: "Benutzer erstellen" }),
    );

    const roleSelect = await screen.findByLabelText("Rolle");

    expect(roleSelect).toHaveTextContent("Angestellter");

    await user.click(roleSelect);
    await user.click(
      await screen.findByRole("option", { name: "Administrator" }),
    );

    expect(roleSelect).toHaveTextContent("Administrator");
  });

  it("shows the sole role and the roleless administrator exception", async () => {
    const user = userEvent.setup();
    renderUsers([MANAGEABLE_ADMIN], [ROLE.EMPLOYEE]);

    await user.click(
      screen.getByRole("button", { name: "Benutzer erstellen" }),
    );

    await screen.findByRole("dialog");

    expect(screen.getByLabelText("Rolle")).toBeInTheDocument();
  });

  it("shows creation errors inside the dialog", async () => {
    const user = userEvent.setup();
    renderUsers([MANAGEABLE_ADMIN], [ROLE.ADMIN], {
      error: "usernameTaken",
      intent: "create-user",
      ok: false,
    });

    await user.click(
      screen.getByRole("button", { name: "Benutzer erstellen" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Dieser Benutzername ist bereits vergeben.",
    );
  });

  it("disables submission while creating a user", async () => {
    const user = userEvent.setup();
    renderUsers(
      [MANAGEABLE_ADMIN, LOCKED_EMPLOYEE],
      [ROLE.ADMIN, ROLE.MANAGER, ROLE.EMPLOYEE],
      undefined,
      { intent: "create-user" },
    );

    await user.click(
      screen.getByRole("button", { name: "Benutzer erstellen" }),
    );

    const submit = await screen.findByRole("button", {
      name: "Erstellen",
    });

    expect(submit).toBeDisabled();
  });

  it("keeps the dialog interactive while other forms submit", async () => {
    const user = userEvent.setup();
    renderUsers(
      [MANAGEABLE_ADMIN, LOCKED_EMPLOYEE],
      [ROLE.ADMIN, ROLE.MANAGER, ROLE.EMPLOYEE],
      undefined,
      { intent: "set-active", userId: "user-2" },
    );

    await user.click(
      screen.getByRole("button", { name: "Benutzer erstellen" }),
    );

    const submit = await screen.findByRole("button", { name: "Erstellen" });

    expect(submit).not.toBeDisabled();
  });

  it("keeps the dialog closed after a successful creation", async () => {
    const user = userEvent.setup();
    renderUsers([MANAGEABLE_ADMIN], [ROLE.ADMIN, ROLE.MANAGER, ROLE.EMPLOYEE], {
      intent: "create-user",
      ok: true,
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Benutzer erstellen" }),
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("UserRow", () => {
  it("offers deactivation for active manageable users", async () => {
    const user = userEvent.setup();
    renderUsers([MANAGEABLE_ADMIN]);

    await user.click(
      screen.getByRole("button", { name: "Aktionen für Admin" }),
    );

    expect(
      await screen.findByRole("menuitem", { name: "Deaktivieren" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Aktivieren" }),
    ).not.toBeInTheDocument();
  });

  it("asks for confirmation before deactivating a user", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    renderUsers(
      [MANAGEABLE_ADMIN],
      [ROLE.ADMIN],
      undefined,
      null,
      submit as ReturnType<typeof useSubmit>,
    );

    await user.click(
      screen.getByRole("button", { name: "Aktionen für Admin" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Deaktivieren" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Benutzer deaktivieren?" }),
    ).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it("offers activation for inactive manageable users and submits it directly", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    renderUsers(
      [{ ...LOCKED_EMPLOYEE, canManage: true }],
      [ROLE.ADMIN],
      undefined,
      null,
      submit as ReturnType<typeof useSubmit>,
    );

    await user.click(screen.getByRole("button", { name: "Aktionen für Sam" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Aktivieren" }),
    );

    expect(submit).toHaveBeenCalledWith(
      { intent: "set-active", isActive: "true", userId: "user-2" },
      { method: "post" },
    );
  });

  it("hides the actions for users outside the actor scope", () => {
    renderUsers([LOCKED_EMPLOYEE]);

    expect(
      screen.queryByRole("button", { name: "Aktionen für Sam" }),
    ).not.toBeInTheDocument();
  });

  it("disables the deactivation confirmation while the change is submitted", async () => {
    const user = userEvent.setup();
    renderUsers(
      [MANAGEABLE_ADMIN, { ...LOCKED_EMPLOYEE, canManage: true }],
      [ROLE.ADMIN, ROLE.MANAGER, ROLE.EMPLOYEE],
      undefined,
      { intent: "set-active", userId: MANAGEABLE_ADMIN.id },
    );

    await user.click(
      screen.getByRole("button", { name: "Aktionen für Admin" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Deaktivieren" }),
    );

    expect(
      await screen.findByRole("button", { name: "Wird deaktiviert …" }),
    ).toBeDisabled();
  });

  it("shows failed state changes of the directory above the table", () => {
    renderUsers([MANAGEABLE_ADMIN], [ROLE.ADMIN], {
      error: "userNotFound",
      intent: "reset-password",
      ok: false,
    });

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
