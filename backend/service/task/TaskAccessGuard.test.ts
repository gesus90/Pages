import { expect, it, vi } from "vitest";

import {
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
} from "@/backend/error/WorkItemErrors";

import { TaskAccessGuard } from "./TaskAccessGuard";

import { ROLE } from "@/definition/Role";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { User } from "@/definition/User";

const actor: User = {
  displayName: "U",
  id: "u",
  isActive: true,
  mustChangePassword: false,
  role: ROLE.EMPLOYEE,
  username: "u",
};

interface Facts {
  readonly capabilities?: readonly string[];
  readonly writable?: readonly string[];
  readonly item?: object | null;
}

function doubleOf<Type extends object>(members: object): Type {
  return members as Type;
}

function setup(facts: Facts = {}): {
  readonly guard: TaskAccessGuard;
  readonly projects: Record<string, ReturnType<typeof vi.fn>>;
} {
  const capabilities = facts.capabilities ?? ["write", "milestones"];
  const writable = facts.writable ?? ["p1"];
  const projects: Record<string, ReturnType<typeof vi.fn>> = {
    authorizationFacts: vi.fn(async () => ({ departments: [] })),
    canDeleteProjects: vi.fn(async () => true),
    canWriteProject: vi.fn(async (ignoredActor: User, id: string) =>
      writable.includes(id),
    ),
    filterAssignees: vi.fn(async (input: unknown) => input),
    findAll: vi.fn(async () => [{ id: "p1" }, { id: "p2" }]),
    getById: vi.fn(async (ignoredActor: User, id: string) => ({ id })),
    workItemVisibility: vi.fn(async () => ({ departmentIds: null })),
  };
  const repository = doubleOf<TaskRepository>({
    findById: vi.fn(async () =>
      facts.item === undefined ? { projectId: "p1" } : facts.item,
    ),
  });
  const permissions = doubleOf<PermissionService>({
    hasCapability: vi.fn(async (ignoredActor: User, capability: string) =>
      capabilities.includes(capability),
    ),
  });

  return {
    guard: new TaskAccessGuard(
      repository,
      doubleOf<ProjectService>(projects),
      permissions,
    ),
    projects,
  };
}

it("requires a capability", async () => {
  await expect(
    setup().guard.requireCapability(actor, "write"),
  ).resolves.toBeUndefined();
  await expect(
    setup({ capabilities: [] }).guard.requireCapability(actor, "write"),
  ).rejects.toThrow(WorkItemAccessDeniedError);
});

it("returns a writable project only with the write capability", async () => {
  await expect(
    setup().guard.requireWritableProject(actor, "p1"),
  ).resolves.toEqual({ id: "p1" });
  await expect(
    setup({ capabilities: [] }).guard.requireWritableProject(actor, "p1"),
  ).rejects.toThrow(WorkItemAccessDeniedError);
});

it("returns a visible work item and rejects a missing one", async () => {
  await expect(setup().guard.requireWorkItem(actor, "w")).resolves.toEqual({
    projectId: "p1",
  });
  await expect(
    setup({ item: null }).guard.requireWorkItem(actor, "w"),
  ).rejects.toThrow(WorkItemNotFoundError);
});

it("returns a writable work item", async () => {
  await expect(
    setup().guard.requireWritableWorkItem(actor, "w"),
  ).resolves.toEqual({ projectId: "p1" });
  await expect(
    setup({ capabilities: [] }).guard.requireWritableWorkItem(actor, "w"),
  ).rejects.toThrow(WorkItemAccessDeniedError);
});

it("delegates visibility, assignee filtering, facts and deletion", async () => {
  const { guard } = setup();
  const candidates = new Map<string, readonly User[]>();

  await expect(guard.visibility(actor)).resolves.toEqual({
    departmentIds: null,
  });
  await expect(guard.filterAssignees(candidates)).resolves.toBe(candidates);
  await expect(guard.authorizationFacts(actor)).resolves.toEqual({
    departments: [],
  });
  await expect(guard.canDelete(actor)).resolves.toBe(true);
});

it("requires planning access to a project", async () => {
  await expect(
    setup().guard.requirePlanningProject(actor, "p1"),
  ).resolves.toBeUndefined();
  await expect(
    setup().guard.requirePlanningProject(actor, "p2"),
  ).rejects.toThrow(WorkItemAccessDeniedError);
});

it("tells whether the actor can write", async () => {
  await expect(setup().guard.canWrite(actor)).resolves.toBe(true);
  await expect(setup({ capabilities: [] }).guard.canWrite(actor)).resolves.toBe(
    false,
  );
});

it("decides the archive right by capability and project", async () => {
  await expect(setup().guard.canArchive(actor, "p1")).resolves.toBe(true);
  await expect(setup().guard.canArchive(actor, "p2")).resolves.toBe(false);
  await expect(
    setup({ capabilities: [] }).guard.canArchive(actor, "p1"),
  ).resolves.toBe(false);
});

it("requires the archive right", async () => {
  await expect(
    setup().guard.requireArchiveRight(actor, "p1"),
  ).resolves.toBeUndefined();
  await expect(setup().guard.requireArchiveRight(actor, "p2")).rejects.toThrow(
    WorkItemAccessDeniedError,
  );
});

it("returns an archivable work item", async () => {
  await expect(
    setup().guard.requireArchivableWorkItem(actor, "w"),
  ).resolves.toEqual({ projectId: "p1" });
  await expect(
    setup({ writable: [] }).guard.requireArchivableWorkItem(actor, "w"),
  ).rejects.toThrow(WorkItemAccessDeniedError);
});

it("narrows projects to archivable ones", async () => {
  await expect(
    setup().guard.archivableProjectIds(actor, ["p1", "p2"]),
  ).resolves.toEqual(["p1"]);
  await expect(
    setup({ capabilities: [] }).guard.archivableProjectIds(actor, ["p1"]),
  ).resolves.toEqual([]);
});

it("tells whether any project is archivable", async () => {
  await expect(setup().guard.canArchiveAny(actor, ["p2", "p1"])).resolves.toBe(
    true,
  );
  await expect(setup().guard.canArchiveAny(actor, ["p2"])).resolves.toBe(false);
  await expect(
    setup({ capabilities: [] }).guard.canArchiveAny(actor, ["p1"]),
  ).resolves.toBe(false);
});

it("resolves the accessible projects of a query", async () => {
  const { guard } = setup();

  await expect(guard.resolveAccessibleProjectIds(actor)).resolves.toEqual([
    "p1",
    "p2",
  ]);
  await expect(
    guard.resolveAccessibleProjectIds(actor, ["p2", "x"]),
  ).resolves.toEqual(["p2"]);
});
