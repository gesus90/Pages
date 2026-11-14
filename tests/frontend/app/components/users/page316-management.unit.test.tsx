import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { AgentAccessSection } from "@/app/components/users/agents/agent-access-section";
import { ManagementActivity } from "@/app/components/users/management-activity";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/app/components/users/agents/agent-template-confirm", () => ({
  AgentTemplateConfirm: () => null,
}));

it("offers safe agent access levels without a YOLO grant or host MCP details", () => {
  render(
    <AgentAccessSection
      value="read_only"
      savedValue="read_only"
      onChange={vi.fn()}
      canChange
      canAssignYolo={false}
      environment={{ isIsolationAvailable: true, mcpServers: [] }}
    />,
  );
  expect(
    screen.getByRole("radio", { name: /agentEmployees.access.read_only/u }),
  ).toHaveProperty("disabled", false);
  expect(
    screen.getByRole("radio", { name: /agentEmployees.access.workspace/u }),
  ).toHaveProperty("disabled", false);
  expect(
    screen.queryByRole("radio", { name: /agentEmployees.access.yolo/u }),
  ).toBeNull();
});

it("renders the administrator's audit evidence as escaped text with its account and ISO time", () => {
  render(
    <ManagementActivity
      entries={[
        {
          id: "event",
          actorId: "management-account",
          at: "2026-11-13T12:00:00.000Z",
          action: "UPDATE",
          target: "users:person",
          change: '{"after":{"display_name":"<script>unsafe</script>"}}',
        },
      ]}
    />,
  );
  expect(screen.getByText("management-account")).not.toBeNull();
  expect(screen.getByText("2026-11-13T12:00:00.000Z")).not.toBeNull();
  expect(screen.getByText("users:person")).not.toBeNull();
  expect(document.querySelector("script")).toBeNull();
});

it("hides the personal password action when the account may not set credentials", async () => {
  const { SecurityCard } =
    await import("@/app/components/settings/security-card");
  render(
    <SecurityCard
      sessions={[]}
      canChangePassword={false}
      onChangePassword={vi.fn()}
      onRevokeSession={vi.fn()}
      onRevokeOtherSessions={vi.fn()}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "settings.security.password.action" }),
  ).toBeNull();
});

it("localizes the protected role name without changing user-defined role names", async () => {
  const { createInstance } = await import("i18next");
  const { userRoleLabel } = await import("@/app/lib/user-role-label");
  const i18n = createInstance();
  await i18n.init({
    lng: "en",
    resources: {
      en: { translation: { users: { management: { role: "Management" } } } },
    },
  });
  expect(
    userRoleLabel({ id: "role-administration", name: "Verwaltung" }, i18n.t),
  ).toBe("Management");
  expect(userRoleLabel({ id: "custom", name: "Custom role" }, i18n.t)).toBe(
    "Custom role",
  );
});
