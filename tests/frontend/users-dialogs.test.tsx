// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import UsersRoute from "@/app/routes/users";
import { ROLE } from "@/definition/Role";
import { LANGUAGE } from "@/language/Language";

import type { UsersActionData } from "@/app/lib/user-actions/user-action-support.server";
import type { Role } from "@/definition/Role";
import type { UserListItem } from "@/definition/User";

const mockedActionData = vi.mocked(useActionData);
const mockedLoaderData = vi.mocked(useLoaderData);
const mockedNavigation = vi.mocked(useNavigation);
const mockedSubmit = vi.mocked(useSubmit);

const ALL_ROLES: readonly Role[] = [ROLE.ADMIN, ROLE.MANAGER, ROLE.EMPLOYEE];

function createListItem(overrides: Partial<UserListItem> = {}): UserListItem {
  return {
    canManage: true,
    displayName: "Anna Berger",
    email: "anna@example.com",
    id: "user-1",
    isActive: true,
    role: ROLE.MANAGER,
    username: "anna",
    ...overrides,
  };
}

interface Harness {
  /** Changes what the route sees as action data or navigation, then renders. */
  readonly update: (state: {
    actionData?: UsersActionData | undefined;
    navigation?: unknown;
  }) => void;
}

function renderUsers(
  users: readonly UserListItem[] = [createListItem()],
  initial: { actionData?: UsersActionData; navigation?: unknown } = {},
  assignableRoles: readonly Role[] = ALL_ROLES,
): Harness {
  let forceRender: () => void = () => {};

  mockedLoaderData.mockReturnValue({ assignableRoles, users });
  mockedSubmit.mockReturnValue(vi.fn());
  mockedNavigation.mockReturnValue(
    (initial.navigation ?? { state: "idle" }) as ReturnType<
      typeof useNavigation
    >,
  );
  mockedActionData.mockReturnValue(initial.actionData);

  function RouteHarness(): React.ReactElement {
    const [, setCount] = useState(0);

    forceRender = () => setCount((count) => count + 1);

    return <UsersRoute />;
  }

  const router = createMemoryRouter(
    [{ element: <RouteHarness />, path: "/users" }],
    { initialEntries: ["/users"] },
  );

  render(
    <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );

  return {
    update: (state) => {
      if ("actionData" in state) {
        mockedActionData.mockReturnValue(state.actionData);
      }

      if ("navigation" in state) {
        mockedNavigation.mockReturnValue(
          state.navigation as ReturnType<typeof useNavigation>,
        );
      }

      act(() => forceRender());
    },
  };
}

function submitting(intent: string): unknown {
  const formData = new FormData();

  formData.append("intent", intent);

  return { formData, state: "submitting" };
}

function hiddenValue(dialog: HTMLElement, name: string): string {
  return (dialog.querySelector(`input[name="${name}"]`) as HTMLInputElement)
    .value;
}

async function openMenuItem(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  displayName = "Anna Berger",
): Promise<HTMLElement> {
  await user.click(
    screen.getByRole("button", { name: `Aktionen für ${displayName}` }),
  );
  await user.click(await screen.findByRole("menuitem", { name }));

  return screen.findByRole("dialog");
}

beforeEach(() => {
  mockedActionData.mockReturnValue(undefined);
});

describe("user directory search and rows", () => {
  const users = [
    createListItem(),
    createListItem({
      canManage: false,
      displayName: "Ben Wolf",
      email: null,
      id: "user-2",
      isActive: false,
      role: ROLE.EMPLOYEE,
      username: "bwolf",
    }),
  ];

  it("shows the email address or a dash", () => {
    renderUsers(users);

    expect(screen.getByText("anna@example.com")).toHaveAttribute(
      "title",
      "anna@example.com",
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it.each([
    ["Anna", "Anna Berger", "Ben Wolf"],
    ["  BWOLF ", "Ben Wolf", "Anna Berger"],
    ["EXAMPLE.com", "Anna Berger", "Ben Wolf"],
  ])("filters the directory by %j", async (query, shown, hidden) => {
    const user = userEvent.setup();

    renderUsers(users);
    await user.type(screen.getByRole("searchbox"), query);

    expect(screen.getByText(shown)).toBeInTheDocument();
    expect(screen.queryByText(hidden)).not.toBeInTheDocument();
  });

  it("says so when nobody matches and recovers when cleared", async () => {
    const user = userEvent.setup();

    renderUsers(users);
    await user.type(screen.getByRole("searchbox"), "zzz");

    expect(screen.getByText("Keine Benutzer gefunden.")).toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox"));

    expect(screen.getByText("Anna Berger")).toBeInTheDocument();
    expect(screen.getByText("Ben Wolf")).toBeInTheDocument();
  });
});

describe("CreateUserDialog", () => {
  it("closes after a successful creation", async () => {
    const user = userEvent.setup();
    const { update } = renderUsers();

    await user.click(
      screen.getByRole("button", { name: "Benutzer erstellen" }),
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    update({ actionData: { intent: "create-user", ok: true } });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays open for the success of another action", async () => {
    const user = userEvent.setup();
    const { update } = renderUsers();

    await user.click(
      screen.getByRole("button", { name: "Benutzer erstellen" }),
    );
    update({ actionData: { intent: "set-active", ok: true } });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("submits the chosen role and falls back to employee when reopened", async () => {
    const user = userEvent.setup();

    renderUsers();
    await user.click(
      screen.getByRole("button", { name: "Benutzer erstellen" }),
    );

    let dialog = await screen.findByRole("dialog");

    expect(hiddenValue(dialog, "role")).toBe("employee");

    await user.click(within(dialog).getByRole("combobox", { name: "Rolle" }));
    await user.click(screen.getByRole("option", { name: "Manager" }));

    expect(hiddenValue(dialog, "role")).toBe("manager");

    await user.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    await user.click(
      screen.getByRole("button", { name: "Benutzer erstellen" }),
    );
    dialog = await screen.findByRole("dialog");

    expect(hiddenValue(dialog, "role")).toBe("employee");
  });

  it("requires a password of the minimum length", async () => {
    const user = userEvent.setup();

    renderUsers();
    await user.click(
      screen.getByRole("button", { name: "Benutzer erstellen" }),
    );

    expect(await screen.findByLabelText("Passwort")).toHaveAttribute(
      "minlength",
      "8",
    );
    expect(screen.getByLabelText("E-Mail (optional)")).toHaveAttribute(
      "type",
      "email",
    );
  });
});

describe("EditUserDialog", () => {
  it("is prefilled with the stored values", async () => {
    const user = userEvent.setup();

    renderUsers();

    const dialog = await openMenuItem(user, "Bearbeiten");

    expect(within(dialog).getByLabelText("Name")).toHaveValue("Anna Berger");
    expect(within(dialog).getByLabelText("Benutzername")).toHaveValue("anna");
    expect(within(dialog).getByLabelText("E-Mail")).toHaveValue(
      "anna@example.com",
    );
    expect(hiddenValue(dialog, "userId")).toBe("user-1");
    expect(hiddenValue(dialog, "intent")).toBe("update-user");
  });

  it("starts with an empty email field for users without one", async () => {
    const user = userEvent.setup();

    renderUsers([createListItem({ email: null })]);

    const dialog = await openMenuItem(user, "Bearbeiten");

    expect(within(dialog).getByLabelText("E-Mail")).toHaveValue("");
  });

  it("shows a failure inside the dialog", async () => {
    const user = userEvent.setup();

    renderUsers([createListItem()], {
      actionData: { error: "emailTaken", intent: "update-user", ok: false },
    });

    const dialog = await openMenuItem(user, "Bearbeiten");

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Diese E-Mail-Adresse wird bereits verwendet.",
    );
  });

  it("marks a running save and closes after it succeeded", async () => {
    const user = userEvent.setup();
    const { update } = renderUsers([createListItem()], {
      navigation: submitting("update-user"),
    });

    const dialog = await openMenuItem(user, "Bearbeiten");

    expect(
      within(dialog).getByRole("button", { name: "Wird gespeichert …" }),
    ).toBeDisabled();

    update({
      actionData: { intent: "update-user", ok: true },
      navigation: { state: "idle" },
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ChangeRoleDialog", () => {
  it("shows the current role and submits the chosen one", async () => {
    const user = userEvent.setup();

    renderUsers();

    const dialog = await openMenuItem(user, "Rolle ändern");

    expect(hiddenValue(dialog, "role")).toBe("manager");
    expect(hiddenValue(dialog, "intent")).toBe("set-role");

    await user.click(within(dialog).getByRole("combobox", { name: "Rolle" }));
    await user.click(screen.getByRole("option", { name: "Administrator" }));

    expect(hiddenValue(dialog, "role")).toBe("admin");
  });

  it("starts from the current role again when reopened", async () => {
    const user = userEvent.setup();

    renderUsers();

    let dialog = await openMenuItem(user, "Rolle ändern");

    await user.click(within(dialog).getByRole("combobox", { name: "Rolle" }));
    await user.click(screen.getByRole("option", { name: "Administrator" }));
    await user.click(within(dialog).getByRole("button", { name: "Abbrechen" }));

    dialog = await openMenuItem(user, "Rolle ändern");

    expect(hiddenValue(dialog, "role")).toBe("manager");
  });

  it("explains that the last administrator keeps the role", async () => {
    const user = userEvent.setup();

    renderUsers([createListItem({ role: ROLE.ADMIN })], {
      actionData: {
        error: "demoteLastAdministrator",
        intent: "set-role",
        ok: false,
      },
    });

    const dialog = await openMenuItem(user, "Rolle ändern");

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Dem letzten aktiven Administrator",
    );
  });

  it("marks a running save and closes after it succeeded", async () => {
    const user = userEvent.setup();
    const { update } = renderUsers([createListItem()], {
      navigation: submitting("set-role"),
    });

    const dialog = await openMenuItem(user, "Rolle ändern");

    expect(
      within(dialog).getByRole("button", { name: "Wird gespeichert …" }),
    ).toBeDisabled();

    update({
      actionData: { intent: "set-role", ok: true },
      navigation: { state: "idle" },
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ResetPasswordDialog", () => {
  const RESULT: UsersActionData = {
    intent: "reset-password",
    ok: true,
    temporaryPassword: "Tmp-Secret-42",
    userId: "user-1",
  };

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });

  it("asks for confirmation first", async () => {
    const user = userEvent.setup();

    renderUsers();

    const dialog = await openMenuItem(user, "Passwort zurücksetzen");

    expect(
      within(dialog).getByText(/temporäres Einmalpasswort erstellt/),
    ).toBeInTheDocument();
    expect(hiddenValue(dialog, "intent")).toBe("reset-password");
    expect(hiddenValue(dialog, "userId")).toBe("user-1");
  });

  it("marks a running reset", async () => {
    const user = userEvent.setup();

    renderUsers([createListItem()], {
      navigation: submitting("reset-password"),
    });

    const dialog = await openMenuItem(user, "Passwort zurücksetzen");

    expect(
      within(dialog).getByRole("button", { name: "Wird zurückgesetzt …" }),
    ).toBeDisabled();
  });

  it("shows the temporary password of the reset user once", async () => {
    const user = userEvent.setup();
    const { update } = renderUsers();

    const dialog = await openMenuItem(user, "Passwort zurücksetzen");

    update({ actionData: RESULT });

    expect(
      within(dialog).getByRole("heading", { name: "Einmalpasswort erstellt" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Tmp-Secret-42")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Schließen" }));

    const reopened = await openMenuItem(user, "Passwort zurücksetzen");

    expect(
      within(reopened).queryByText("Tmp-Secret-42"),
    ).not.toBeInTheDocument();
    expect(
      within(reopened).getByRole("button", { name: "Zurücksetzen" }),
    ).toBeInTheDocument();
  });

  it("keeps the confirmation for the result of another user", async () => {
    const user = userEvent.setup();
    const { update } = renderUsers();

    const dialog = await openMenuItem(user, "Passwort zurücksetzen");

    update({ actionData: { ...RESULT, userId: "user-9" } });

    expect(within(dialog).queryByText("Tmp-Secret-42")).not.toBeInTheDocument();

    update({
      actionData: {
        error: "userNotFound",
        intent: "reset-password",
        ok: false,
      },
    });

    expect(within(dialog).queryByText("Tmp-Secret-42")).not.toBeInTheDocument();
  });

  it("copies the temporary password and confirms it for two seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const { update } = renderUsers();

    await openMenuItem(user, "Passwort zurücksetzen");
    update({ actionData: RESULT });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kopieren" }));
    });

    expect(writeText).toHaveBeenCalledWith("Tmp-Secret-42");
    expect(screen.getByRole("button", { name: "Kopiert" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(
      screen.getByRole("button", { name: "Kopieren" }),
    ).toBeInTheDocument();
  });

  it("does nothing without a clipboard", async () => {
    const user = userEvent.setup();
    const { update } = renderUsers();

    await openMenuItem(user, "Passwort zurücksetzen");
    update({ actionData: RESULT });

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    fireEvent.click(screen.getByRole("button", { name: "Kopieren" }));

    expect(
      screen.getByRole("button", { name: "Kopieren" }),
    ).toBeInTheDocument();
  });

  it("stays quiet when the clipboard refuses the write", async () => {
    const user = userEvent.setup();
    const { update } = renderUsers();

    await openMenuItem(user, "Passwort zurücksetzen");
    update({ actionData: RESULT });

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kopieren" }));
    });

    expect(
      screen.getByRole("button", { name: "Kopieren" }),
    ).toBeInTheDocument();
  });
});

describe("DeactivateDialog", () => {
  it("closes after the deactivation succeeded", async () => {
    const user = userEvent.setup();
    const { update } = renderUsers();

    await openMenuItem(user, "Deaktivieren");

    update({ actionData: { intent: "set-active", ok: true } });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
