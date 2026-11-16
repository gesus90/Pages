import { expect, it } from "vitest";

import { readAgentAdministration } from "@/backend/service/agents/AgentAdministrationReads";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentAdministrationContext } from "@/backend/service/agents/AgentAdministrationContext";

function context(): AgentAdministrationContext {
  return partial<AgentAdministrationContext>({
    actor: { id: "admin" },
    snapshot: {
      roles: [{ id: "role", name: "Role" }],
      departments: [{ id: "department", name: "Department" }],
      accounts: [{ userId: "user", departments: ["department"] }],
    },
    repository: {
      groups: () => ({
        findAll: async () => [
          { id: "group", name: "Group", memberIds: ["user"] },
        ],
      }),
      users: () => ({
        findAll: async () => [
          { id: "user", username: "person", displayName: "Person" },
          { id: "hidden" },
        ],
      }),
    },
  });
}

it("lists the fixed permissions and pages roles and groups", async () => {
  const actor = context();
  await expect(
    readAgentAdministration(actor, "admin.permissions.list", {}),
  ).resolves.toMatchObject({ read: true, canDisableRead: false });
  await expect(
    readAgentAdministration(actor, "admin.roles.list", {}),
  ).resolves.toMatchObject({ total: 1, entries: [{ id: "role" }] });
  await expect(
    readAgentAdministration(actor, "admin.groups.list", {}),
  ).resolves.toMatchObject({ total: 1, entries: [{ id: "group" }] });
});

it("derives department members and includes only users with authorization facts", async () => {
  const actor = context();
  await expect(
    readAgentAdministration(actor, "admin.departments.list", {}),
  ).resolves.toMatchObject({
    entries: [{ id: "department", memberIds: ["user"] }],
  });
  await expect(
    readAgentAdministration(actor, "admin.users.list", {}),
  ).resolves.toMatchObject({
    total: 1,
    entries: [{ id: "user", groups: [{ id: "group", name: "Group" }] }],
  });
});
