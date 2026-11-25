import { expect, it, vi } from "vitest";

import {
  WorkItemAccessDeniedError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";

import { TaskDepartmentService } from "./TaskDepartmentService";

import { ROLE } from "@/definition/Role";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "./TaskAccessGuard";
import type { TaskHistoryRecorder } from "./TaskHistoryRecorder";
import type { AccountAccess } from "@/definition/Authorization";
import type { User } from "@/definition/User";

const actor: User = {
  displayName: "U",
  id: "u",
  isActive: true,
  mustChangePassword: false,
  role: ROLE.EMPLOYEE,
  username: "u",
};

const catalog = [
  { id: "d1", name: "One" },
  { id: "d2", name: "Two" },
  { id: "d3", name: "Three" },
];

type Mock = ReturnType<typeof vi.fn>;

function doubleOf<Type extends object>(members: object): Type {
  return members as Type;
}

function accountOf(departments: readonly string[]): AccountAccess {
  return {
    allDepartments: false,
    allProjects: false,
    departments,
    firstName: "F",
    hasHadDepartment: true,
    isActive: true,
    isAdmin: false,
    lastName: "L",
    managedDepartments: [],
    mode: "role",
    role: null,
    userId: "u",
  };
}

interface Facts {
  readonly current?: readonly string[];
  readonly changed?: boolean;
  readonly own?: readonly string[];
  readonly visibility?: Record<string, readonly string[] | null>;
  readonly memberDepartments?: readonly string[];
  readonly groups?: readonly object[];
}

function setup(facts: Facts = {}): {
  readonly service: TaskDepartmentService;
  readonly repository: Record<string, Mock>;
  readonly history: Record<string, Mock>;
  readonly cache: Record<string, Mock>;
} {
  const repository: Record<string, Mock> = {
    findAssigneeGroupsWithMembers: vi.fn(async () => facts.groups ?? []),
    findEligibleAssignees: vi.fn(async () => [
      { displayName: "Ann", id: "m1" },
      { displayName: "Bob", id: "m2" },
    ]),
    setDepartments: vi.fn(async () => facts.changed ?? true),
  };
  const history: Record<string, Mock> = {
    recordDepartmentChanged: vi.fn(async () => {}),
  };
  const cache: Record<string, Mock> = { invalidateWorkItems: vi.fn() };
  const access = doubleOf<TaskAccessGuard>({
    authorizationFacts: vi.fn(async (user: User) => ({
      account: accountOf(
        user.id === "u"
          ? (facts.own ?? ["d1"])
          : (facts.memberDepartments ?? []),
      ),
      departments: catalog,
    })),
    requireWritableWorkItem: vi.fn(async () => ({
      departmentIds: facts.current ?? [],
    })),
    visibility: vi.fn(async (user: User) => ({
      departmentIds: facts.visibility?.[user.id] ?? null,
    })),
  });

  return {
    cache,
    history,
    repository,
    service: new TaskDepartmentService(
      doubleOf<TaskRepository>(repository),
      access,
      doubleOf<TaskHistoryRecorder>(history),
      doubleOf<ServerCache>(cache),
    ),
  };
}

it("lists the selectable and the known departments", async () => {
  await expect(setup().service.choices(actor)).resolves.toEqual({
    available: [catalog[0]],
    known: catalog,
  });
});

it("resolves no department for an empty selection", async () => {
  const { service } = setup();

  await expect(service.resolve(actor, null)).resolves.toEqual([]);
  await expect(service.resolve(actor, [" ", ""])).resolves.toEqual([]);
});

it("resolves distinct selectable departments", async () => {
  await expect(setup().service.resolve(actor, [" d1 ", "d1"])).resolves.toEqual(
    ["d1"],
  );
});

it("rejects an unknown or not selectable department", async () => {
  const { service } = setup();

  await expect(service.resolve(actor, ["x"])).rejects.toThrow(
    WorkItemValidationError,
  );
  await expect(service.resolve(actor, ["d2"])).rejects.toThrow(
    WorkItemAccessDeniedError,
  );
});

it("replaces the departments and records the change", async () => {
  const { cache, history, repository, service } = setup({
    current: ["d1", "gone"],
    own: ["d1", "d2"],
  });

  await service.setDepartments(
    actor,
    "t",
    ["d1", "gone", "d2"],
    ["gone", "d1"],
  );

  expect(repository.setDepartments).toHaveBeenCalledWith(
    "t",
    ["d1", "gone", "d2"],
    ["gone", "d1"],
  );
  expect(cache.invalidateWorkItems).toHaveBeenCalledTimes(1);
  expect(history.recordDepartmentChanged).toHaveBeenCalledWith(actor, "t", {
    newName: "One, gone, Two",
    oldName: "One, gone",
  });
});

it("records an opened ticket without department names", async () => {
  const { history, repository, service } = setup({ current: ["d1"] });

  await service.setDepartments(actor, "t", []);

  expect(repository.setDepartments).toHaveBeenCalledWith("t", [], undefined);
  expect(history.recordDepartmentChanged).toHaveBeenCalledWith(actor, "t", {
    newName: null,
    oldName: "One",
  });
});

it("rejects an outdated expectation", async () => {
  const { service } = setup({ current: ["d1"] });

  await expect(
    service.setDepartments(actor, "t", ["d1"], ["d2"]),
  ).rejects.toMatchObject({ code: "ticketConflict" });
});

it("does nothing when the departments stay the same", async () => {
  const { repository, service } = setup({ current: ["d1"] });

  await service.setDepartments(actor, "t", ["d1"], ["d1"]);

  expect(repository.setDepartments).not.toHaveBeenCalled();
});

it("rejects adding a department the actor cannot select", async () => {
  const { service } = setup({ current: [] });

  await expect(service.setDepartments(actor, "t", ["d2"])).rejects.toThrow(
    WorkItemAccessDeniedError,
  );
});

it("rejects removing a department the actor cannot select", async () => {
  const { service } = setup({ current: ["d2"], own: ["d1"] });

  await expect(service.setDepartments(actor, "t", ["d1"])).rejects.toThrow(
    WorkItemAccessDeniedError,
  );
});

it("rejects a conflicting write", async () => {
  const { service } = setup({ changed: false, current: ["d1"] });

  await expect(service.setDepartments(actor, "t", [])).rejects.toMatchObject({
    code: "ticketConflict",
  });
});

it("answers that a member sees a ticket without departments", async () => {
  const { service } = setup();

  await expect(
    service.assigneeSight(actor, {
      departmentIds: [],
      groupId: null,
      personId: "m1",
    }),
  ).resolves.toEqual({
    canSee: true,
    isGroup: false,
    offer: [],
    targetName: "Ann",
  });
});

it("answers that a member with a matching department sees the ticket", async () => {
  const { service } = setup({ visibility: { m1: ["d1"] } });

  await expect(
    service.assigneeSight(actor, {
      departmentIds: ["d1"],
      groupId: null,
      personId: "m1",
    }),
  ).resolves.toMatchObject({ canSee: true });
});

it("offers the departments of a group member without sight", async () => {
  const { service } = setup({
    groups: [
      { id: "other", memberIds: [], name: "Other" },
      { id: "g", memberIds: ["m1", "m2"], name: "Team" },
    ],
    memberDepartments: ["d1", "d2", "d3"],
    own: ["d1", "d2"],
    visibility: { m1: ["d9"], m2: null },
  });

  await expect(
    service.assigneeSight(actor, {
      departmentIds: ["d1"],
      groupId: "g",
      personId: null,
    }),
  ).resolves.toEqual({
    canSee: false,
    isGroup: true,
    offer: [catalog[1]],
    targetName: "Team",
  });
});

it("names an unknown person and an unknown group by what is known", async () => {
  const { service } = setup();

  await expect(
    service.assigneeSight(actor, {
      departmentIds: [],
      groupId: "missing",
      personId: "x",
    }),
  ).resolves.toMatchObject({ isGroup: false, targetName: "x" });
  await expect(
    service.assigneeSight(actor, {
      departmentIds: [],
      groupId: null,
      personId: null,
    }),
  ).resolves.toMatchObject({ targetName: "" });
});
