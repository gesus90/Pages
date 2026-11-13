import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, it, vi } from "vitest";

import { AgentDirectory } from "@/app/components/users/agents/agent-directory";
import { createI18n } from "@/app/lib/i18n";

import {
  sessionOverview,
  sessionView,
  stubSessionEndpoint,
} from "../../agent-settings/agent-session-fixture";

import type { AdministrationPageData } from "@/definition/Authorization";
import type { AgentEmployeeListItem } from "@/definition/AgentEmployee";
import type { AgentEmployeePageData } from "@/definition/AgentEmployeePage";

vi.mock("react-router", async (importOriginal) => {
  const { withMockedRouter } = await import("./agent-router-mock");
  return withMockedRouter(await importOriginal<object>());
});

const i18n = createI18n("en");

const ED: AgentEmployeeListItem = {
  id: "ed",
  username: "ed-user",
  displayName: "Ed",
  position: "Developer",
  avatarColor: null,
  avatarImageUrl: null,
  isActive: true,
  modelName: "Model One",
  provider: null,
  roleId: null,
  roleName: "Lead",
};

const DIRECTORY: AdministrationPageData = {
  users: [],
  assignableRoles: [],
  departments: [],
  actor: {
    userId: "person",
    role: null,
    isAdmin: false,
    mode: "role",
    firstName: "Pat",
    lastName: "Person",
    isActive: true,
    departments: [],
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: false,
  },
  canCreate: false,
  canManageRoles: false,
  canManageDepartments: false,
  editableRoleIds: [],
  manageableDepartmentIds: [],
  adoptableDepartmentIds: [],
  groups: { canManage: false, canSetLeaders: false, groups: [] },
};

const AGENTS: AgentEmployeePageData = {
  agents: [ED],
  models: [],
  canCreate: true,
  templates: { templates: [], canManage: false },
  voice: { status: "noModel", model: null },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

it("opens the popup of the agent from the menu of its row", async () => {
  const { calls } = stubSessionEndpoint(() => ({
    ok: true,
    overview: sessionOverview({ sessions: [sessionView("s-1")] }),
  }));
  render(
    <I18nextProvider i18n={i18n}>
      <AgentDirectory directory={DIRECTORY} agents={AGENTS} />
    </I18nextProvider>,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Actions for Ed" }),
    {
      button: 0,
      ctrlKey: false,
    },
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Agent settings …" }));
  const dialog = await screen.findByRole("dialog");
  expect(
    within(dialog).getByRole("heading", { name: "Ed · Agent settings" }),
  ).toBeTruthy();
  expect(within(dialog).getByText("Developer · Model One")).toBeTruthy();
  expect(await within(dialog).findByRole("table")).toBeTruthy();
  expect(calls[0]?.url).toBe("/chat-page-api/agent-sessions?agentId=ed");
  // No chat is open here, so no row stands out.
  expect(within(dialog).queryByText("this chat")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
