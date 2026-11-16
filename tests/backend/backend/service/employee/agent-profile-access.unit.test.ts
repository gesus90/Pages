import { expect, it } from "vitest";

import { AgentProfileAccess } from "@/backend/service/employee/profile/AgentProfileAccess";
import { PROJECT_ROLE } from "@/definition/Project";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AccountAccess } from "@/definition/Authorization";
import type { UserGroup } from "@/definition/UserGroup";

const READER = partial<AccountAccess>({
  userId: "reader",
  isActive: true,
  isAdmin: false,
  mode: "user",
  isAgent: false,
});

it("grants leaders only agents in led groups and managed projects", () => {
  const access = new AgentProfileAccess(
    {
      reader: READER,
      agentIds: ["group-agent", "project-agent", "other-agent"],
      groups: [
        partial<UserGroup>({
          id: "group",
          leaderIds: ["reader"],
          memberIds: ["reader", "group-agent", "human"],
        }),
      ],
      projectsByUser: new Map([
        [
          "reader",
          [{ id: "project", name: "Project", role: PROJECT_ROLE.MANAGER }],
        ],
        ["project-agent", [{ id: "project", name: "Project", role: "member" }]],
      ]),
    },
    "ui",
  );
  expect([...access.agentIds]).toEqual(["group-agent", "project-agent"]);
  expect(access.canRead("other-agent")).toBe(false);
  expect(access.isAdministrator).toBe(false);
  expect(access.hiddenFields.length).toBeGreaterThan(0);
});

it("grants active administrators all agents and denies inactive readers", () => {
  const input = {
    reader: { ...READER, isAdmin: true, mode: "admin" as const },
    agentIds: ["a", "b"],
    groups: [],
    projectsByUser: new Map(),
  };
  const admin = new AgentProfileAccess(input, "ui");
  expect(admin.isAdministrator).toBe(true);
  expect(admin.canRead("a")).toBe(true);
  const inactive = new AgentProfileAccess(
    { ...input, reader: { ...input.reader, isActive: false } },
    "ui",
  );
  expect(inactive.isAdministrator).toBe(false);
  expect(inactive.canRead("a")).toBe(false);
});
