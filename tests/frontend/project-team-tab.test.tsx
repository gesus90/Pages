// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";

import { ProjectTeamTab } from "@/app/components/projects/project-team-tab";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

import { createUser } from "../helpers/factories";

import type { ProjectMember } from "@/definition/Project";
import type { User } from "@/definition/User";

function createMember(overrides: Partial<ProjectMember> = {}): ProjectMember {
  return {
    avatarType: "initials",
    displayName: "Alex Berger",
    isActive: true,
    joinedAt: "2026-09-05 14:53:21",
    projectRole: "member",
    userId: "user-1",
    username: "alex",
    ...overrides,
  };
}

const TEAM: readonly ProjectMember[] = [
  createMember({
    displayName: "Manager Mia",
    projectRole: "manager",
    userId: "mia",
    username: "mia",
  }),
  createMember({ displayName: "Member Max", userId: "max", username: "max" }),
  createMember({
    displayName: "Invited Ida",
    isActive: false,
    projectRole: "viewer",
    userId: "ida",
    username: "ida",
  }),
];

interface Rendered {
  readonly submissions: Record<string, string>[];
}

function renderTab(
  members: readonly ProjectMember[] = TEAM,
  options: { canWrite?: boolean; eligibleUsers?: readonly User[] } = {},
): Rendered {
  const submissions: Rendered["submissions"] = [];

  async function action({ request }: { request: Request }): Promise<null> {
    const formData = await request.formData();

    submissions.push(
      Object.fromEntries(
        [...formData.entries()].map(([key, value]) => [key, String(value)]),
      ),
    );

    return null;
  }

  const router = createMemoryRouter(
    [
      {
        action,
        element: (
          <ProjectTeamTab
            canWrite={options.canWrite ?? true}
            eligibleUsers={options.eligibleUsers ?? []}
            members={members}
          />
        ),
        path: "/",
      },
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

function manyMembers(count: number): readonly ProjectMember[] {
  return Array.from({ length: count }, (_, index) =>
    createMember({
      displayName: `Person ${String(index).padStart(2, "0")}`,
      userId: `user-${index}`,
      username: `person${index}`,
    }),
  );
}

function rowNames(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]?.textContent ?? "");
}

async function openMemberMenu(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
): Promise<void> {
  await user.click(
    screen.getByRole("button", { name: `Aktionen für ${name}` }),
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ProjectTeamTab table", () => {
  it("lists the members with role, join date and invitation badge", () => {
    renderTab();

    expect(screen.getAllByText("05.09.2026")).toHaveLength(3);
    expect(screen.getAllByText("Eingeladen")).toHaveLength(1);
    expect(screen.getByText("3", { selector: "span" })).toBeInTheDocument();
    expect(
      screen.getByText("Mitglieder", { selector: "p" }),
    ).toBeInTheDocument();
    expect(rowNames()[0]).toContain("Manager Mia");
  });

  it("uses the singular for a single member", () => {
    renderTab([createMember()]);

    expect(screen.getByText("Mitglied", { selector: "p" })).toBeInTheDocument();
  });

  it("shows roles as text without write access", () => {
    renderTab(TEAM, { canWrite: false });

    expect(screen.queryByRole("button", { name: /Aktionen für/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "+ Mitglied hinzufügen" }),
    ).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Rolle" })).toBeNull();
    expect(screen.getAllByText("Projektmanager").length).toBeGreaterThan(0);
  });

  it("says so for a project without members", () => {
    renderTab([], { canWrite: true });

    expect(
      screen.getByText("Noch keine Personen in diesem Projekt."),
    ).toBeInTheDocument();
  });

  it("hides the search field for readers of an empty team", () => {
    renderTab([], { canWrite: false });

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("Zeilen pro Seite")).toBeNull();
  });

  it("filters by search and explains when nothing matches", async () => {
    const user = userEvent.setup();

    renderTab();
    await user.type(screen.getByRole("textbox"), "max");

    expect(rowNames()).toHaveLength(1);

    await user.type(screen.getByRole("textbox"), "zzz");

    expect(screen.getByText("Keine Mitglieder gefunden.")).toBeInTheDocument();
  });
});

describe("ProjectTeamTab sorting and paging", () => {
  it("toggles the direction of the active column and resets other columns", async () => {
    const user = userEvent.setup();

    renderTab();

    const roleHeader = screen.getByRole("columnheader", { name: /Rolle/ });

    expect(roleHeader).toHaveAttribute("aria-sort", "ascending");

    await user.click(within(roleHeader).getByRole("button"));

    expect(roleHeader).toHaveAttribute("aria-sort", "descending");
    expect(rowNames()[0]).toContain("Invited Ida");

    await user.click(within(roleHeader).getByRole("button"));

    expect(roleHeader).toHaveAttribute("aria-sort", "ascending");
    await user.click(within(roleHeader).getByRole("button"));

    await user.click(
      within(screen.getByRole("columnheader", { name: /^Name/ })).getByRole(
        "button",
      ),
    );

    expect(roleHeader).toHaveAttribute("aria-sort", "none");
    expect(screen.getByRole("columnheader", { name: /^Name/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(rowNames()[0]).toContain("Invited Ida");
  });

  it.each(["Benutzername", "Hinzugefügt am"])(
    "sorts by the %s column",
    async (label) => {
      const user = userEvent.setup();

      renderTab();
      await user.click(
        within(screen.getByRole("columnheader", { name: label })).getByRole(
          "button",
        ),
      );

      expect(screen.getByRole("columnheader", { name: label })).toHaveAttribute(
        "aria-sort",
        "ascending",
      );
    },
  );

  it("pages through many members and changes the page size", async () => {
    const user = userEvent.setup();

    renderTab(manyMembers(30));

    expect(rowNames()).toHaveLength(10);
    expect(screen.getByText("1–10 von 30")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Vorherige Seite" }),
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Nächste Seite" }));

    expect(screen.getByText("11–20 von 30")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Nächste Seite" }));

    expect(screen.getByText("21–30 von 30")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Nächste Seite" }),
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Vorherige Seite" }));

    expect(screen.getByText("11–20 von 30")).toBeInTheDocument();

    await user.click(
      screen.getByRole("combobox", { name: "Zeilen pro Seite" }),
    );
    await user.click(screen.getByRole("option", { name: "25" }));

    expect(rowNames()).toHaveLength(25);
    expect(screen.getByText("1–25 von 30")).toBeInTheDocument();
  });

  it("returns to the first page when searching", async () => {
    const user = userEvent.setup();

    renderTab(manyMembers(30));
    await user.click(screen.getByRole("button", { name: "Nächste Seite" }));
    await user.type(screen.getByRole("textbox"), "Person 0");

    expect(screen.getByText("1–10 von 10")).toBeInTheDocument();
  });
});

describe("ProjectTeamTab member actions", () => {
  it("submits the chosen role of a member", async () => {
    const user = userEvent.setup();
    const { submissions } = renderTab();

    await user.click(
      screen.getAllByRole("combobox", { name: "Rolle" })[1] as HTMLElement,
    );
    await user.click(await screen.findByRole("option", { name: "Betrachter" }));

    expect(submissions).toEqual([
      { intent: "update-member-role", role: "viewer", userId: "max" },
    ]);
  });

  it("promotes a member to project manager from the menu", async () => {
    const user = userEvent.setup();
    const { submissions } = renderTab();

    await openMemberMenu(user, "Member Max");
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Als Projektmanager festlegen",
      }),
    );

    expect(submissions).toEqual([
      { intent: "update-member-role", role: "manager", userId: "max" },
    ]);
  });

  it("does not offer the promotion to managers", async () => {
    const user = userEvent.setup();

    renderTab();
    await openMemberMenu(user, "Manager Mia");

    expect(
      await screen.findByRole("menuitem", { name: "Rolle ändern" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: "Als Projektmanager festlegen" }),
    ).toBeNull();
  });

  it("focuses the role select when asked to change the role", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderTab();
    await openMemberMenu(user, "Member Max");
    await user.click(
      await screen.findByRole("menuitem", { name: "Rolle ändern" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(document.getElementById("role-max")).toHaveFocus();
  });

  it("protects the last project manager from removal", async () => {
    const user = userEvent.setup();

    renderTab();
    await openMemberMenu(user, "Manager Mia");

    const item = await screen.findByRole("menuitem", {
      name: "Aus Projekt entfernen",
    });

    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAttribute(
      "title",
      "Dem Projekt muss mindestens ein Projektmanager zugewiesen sein.",
    );
  });

  it("allows removing a manager when there is another one", async () => {
    const user = userEvent.setup();

    renderTab([
      ...TEAM,
      createMember({
        displayName: "Manager Moe",
        projectRole: "manager",
        userId: "moe",
        username: "moe",
      }),
    ]);
    await openMemberMenu(user, "Manager Mia");

    expect(
      await screen.findByRole("menuitem", { name: "Aus Projekt entfernen" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("confirms before removing a member and submits the removal", async () => {
    const user = userEvent.setup();
    const { submissions } = renderTab();

    await openMemberMenu(user, "Member Max");
    await user.click(
      await screen.findByRole("menuitem", { name: "Aus Projekt entfernen" }),
    );

    const dialog = await screen.findByRole("dialog");

    expect(dialog).toHaveTextContent(
      "Member Max wird aus diesem Projekt entfernt.",
    );

    await user.click(within(dialog).getByRole("button", { name: "Entfernen" }));

    expect(submissions).toEqual([{ intent: "remove-member", userId: "max" }]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the removal dialog without submitting", async () => {
    const user = userEvent.setup();
    const { submissions } = renderTab();

    await openMemberMenu(user, "Member Max");
    await user.click(
      await screen.findByRole("menuitem", { name: "Aus Projekt entfernen" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Abbrechen",
      }),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(submissions).toEqual([]);
  });

  it("offers withdrawing an invitation instead of the role actions", async () => {
    const user = userEvent.setup();

    renderTab();
    await openMemberMenu(user, "Invited Ida");

    expect(
      await screen.findByRole("menuitem", { name: "Einladung erneut senden" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("menuitem", { name: "Rolle ändern" })).toBeNull();

    await user.click(
      screen.getByRole("menuitem", { name: "Einladung zurückziehen" }),
    );

    expect(await screen.findByRole("dialog")).toHaveTextContent("Invited Ida");
  });
});

describe("AddMemberDialog", () => {
  const ELIGIBLE: readonly User[] = [
    createUser({ displayName: "Eve", id: "eve" }),
  ];

  it("adds the chosen person with the chosen role", async () => {
    const user = userEvent.setup();
    const { submissions } = renderTab(TEAM, { eligibleUsers: ELIGIBLE });

    await user.click(
      screen.getByRole("button", { name: "+ Mitglied hinzufügen" }),
    );

    const dialog = await screen.findByRole("dialog");
    const add = within(dialog).getByRole("button", { name: "Hinzufügen" });

    expect(add).toBeDisabled();

    await user.click(
      within(dialog).getByRole("combobox", { name: "+ Mitglied hinzufügen" }),
    );
    await user.click(await screen.findByRole("option", { name: "Eve" }));
    await user.click(within(dialog).getByRole("combobox", { name: "Rolle" }));
    await user.click(await screen.findByRole("option", { name: /Betrachter/ }));

    expect(add).toBeEnabled();

    await user.click(add);

    expect(submissions).toEqual([
      { intent: "add-member", role: "viewer", userId: "eve" },
    ]);
  });
});
