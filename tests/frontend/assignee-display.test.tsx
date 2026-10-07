// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import { AssigneeAvatar } from "@/app/components/tasks/assignee-avatar";
import { useAssigneeOptions } from "@/app/components/tasks/assignee-options";
import { TicketAccessProvider } from "@/app/components/tasks/ticket-access";
import { createI18n } from "@/app/lib/i18n";
import { createUser } from "../helpers/factories";

import type { AssigneeScope } from "@/app/components/tasks/assignee-options";
import type { TicketAccess } from "@/app/components/tasks/ticket-access";

function OptionList({
  scope,
}: {
  readonly scope?: AssigneeScope;
}): React.ReactElement {
  const options = useAssigneeOptions(
    [createUser({ id: "u1", displayName: "Anna" })],
    scope,
  );

  return (
    <ul>
      {options.map((option) => (
        <li key={option.value} data-value={option.value}>
          {option.label}
        </li>
      ))}
    </ul>
  );
}

const ACCESS: TicketAccess = {
  assigneeGroupIdsByProject: { open: ["full"], quiet: [] },
  projects: [],
  assigneeGroups: [
    { id: "full", memberCount: 2, name: "Platform" },
    { id: "empty", memberCount: 0, name: "Ghosts" },
    { id: "other-empty", memberCount: 0, name: "Others" },
  ],
  canDelete: false,
  canWrite: true,
  departments: [],
};

function renderWithI18n(element: React.ReactElement): void {
  render(<I18nextProvider i18n={createI18n("de")}>{element}</I18nextProvider>);
}

describe("assignee avatar", () => {
  it("shows a person, a group chip or a question mark", () => {
    renderWithI18n(
      <>
        <AssigneeAvatar
          item={{ assigneeGroupName: null, assigneeName: "Anna Berg" }}
        />
        <AssigneeAvatar
          item={{ assigneeGroupName: "Platform", assigneeName: null }}
        />
        <AssigneeAvatar
          item={{ assigneeGroupName: null, assigneeName: null }}
        />
      </>,
    );

    expect(screen.getByTitle("Anna Berg")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Gruppe: Platform" })).toBeVisible();
    expect(screen.getByTitle("Nicht zugewiesen")).toHaveTextContent("?");
  });
});

describe("assignee options", () => {
  it("lists nobody, people and assignable groups", () => {
    renderWithI18n(
      <TicketAccessProvider value={ACCESS}>
        <OptionList />
      </TicketAccessProvider>,
    );

    expect(
      screen.getAllByRole("listitem").map((item) => item.dataset.value),
    ).toEqual(["", "u1", "group:full"]);
    expect(screen.getByText("Gruppe: Platform")).toBeInTheDocument();
  });

  it("keeps the current group selectable and marks it as empty", () => {
    renderWithI18n(
      <TicketAccessProvider value={ACCESS}>
        <OptionList scope={{ currentGroupId: "empty" }} />
      </TicketAccessProvider>,
    );

    expect(
      screen.getByText("Gruppe: Ghosts (keine Mitglieder)"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Others/)).not.toBeInTheDocument();
  });

  it("offers a project only the groups with a member who can work in it", () => {
    renderWithI18n(
      <TicketAccessProvider value={ACCESS}>
        <OptionList scope={{ projectId: "open" }} />
        <OptionList scope={{ projectId: "quiet" }} />
        <OptionList scope={{ projectId: "unknown" }} />
      </TicketAccessProvider>,
    );

    expect(
      screen.getAllByRole("listitem").map((item) => item.dataset.value),
    ).toEqual(["", "u1", "group:full", "", "u1", "", "u1"]);
  });

  it("keeps the current group of a ticket even when the project has no member of it", () => {
    renderWithI18n(
      <TicketAccessProvider value={ACCESS}>
        <OptionList scope={{ currentGroupId: "full", projectId: "quiet" }} />
      </TicketAccessProvider>,
    );

    expect(
      screen.getAllByRole("listitem").map((item) => item.dataset.value),
    ).toEqual(["", "u1", "group:full"]);
  });

  it("offers no groups without a provider", () => {
    renderWithI18n(<OptionList />);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
