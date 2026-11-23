import { beforeEach, expect, it, vi } from "vitest";

import { ProjectRepository } from "./ProjectRepository";

import type { Mock } from "vitest";
import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { ProjectRole, ProjectTemplate } from "@/definition/Project";
import type { PagesEventRecord } from "./events/PagesEventOutboxRepository";
import type { NewProjectActivity } from "./project/ProjectActivityRepository";
import type {
  NewProject,
  ProjectDetailsUpdate,
  ProjectUpdate,
} from "./project/ProjectCoreRepository";
import type {
  NewProjectEvent,
  ProjectEventUpdate,
} from "./project/ProjectEventRepository";
import type { NewProjectGoal } from "./project/ProjectGoalRepository";
import type { ProjectIcon } from "./project/ProjectIconRepository";
import type {
  NewProjectIntegration,
  ProjectSyncSchedule,
} from "./project/ProjectIntegrationRepository";

const fakes = vi.hoisted(() => {
  const methods = new Map<string, Mock>();
  const constructed: { readonly name: string; readonly database: unknown }[] =
    [];

  function method(key: string): Mock {
    const existing = methods.get(key);
    if (existing) return existing;
    const created = vi.fn();
    methods.set(key, created);
    return created;
  }

  function fakeClass(name: string): new (database: unknown) => object {
    return class {
      public constructor(database: unknown) {
        constructed.push({ name, database });

        return new Proxy(this, {
          get: (target, property) => method(`${name}.${String(property)}`),
        });
      }
    };
  }

  return { constructed, fakeClass, method, methods };
});

vi.mock("./project/ProjectActivityRepository", () => ({
  ProjectActivityRepository: fakes.fakeClass("activity"),
}));
vi.mock("./events/PagesEventOutboxRepository", () => ({
  PagesEventOutboxRepository: fakes.fakeClass("outbox"),
}));
vi.mock("./project/ProjectCoreRepository", () => ({
  ProjectCoreRepository: fakes.fakeClass("projects"),
}));
vi.mock("./project/ProjectDeletionScopeRepository", () => ({
  ProjectDeletionScopeRepository: fakes.fakeClass("deletionScope"),
}));
vi.mock("./project/ProjectDepartmentRepository", () => ({
  ProjectDepartmentRepository: fakes.fakeClass("departments"),
}));
vi.mock("./project/ProjectLifecycleRepository", () => ({
  ProjectLifecycleRepository: fakes.fakeClass("lifecycle"),
}));
vi.mock("./project/ProjectTemplateRepository", () => ({
  ProjectTemplateRepository: fakes.fakeClass("templates"),
}));
vi.mock("./AuthorizationRepository", () => ({
  AuthorizationRepository: fakes.fakeClass("authorization"),
}));
vi.mock("./project/ProjectEventRepository", () => ({
  ProjectEventRepository: fakes.fakeClass("events"),
}));
vi.mock("./project/ProjectGoalRepository", () => ({
  ProjectGoalRepository: fakes.fakeClass("goals"),
}));
vi.mock("./project/ProjectIconRepository", () => ({
  ProjectIconRepository: fakes.fakeClass("icons"),
}));
vi.mock("./project/ProjectIntegrationRepository", () => ({
  ProjectIntegrationRepository: fakes.fakeClass("integrations"),
}));
vi.mock("./project/ProjectMemberRepository", () => ({
  ProjectMemberRepository: fakes.fakeClass("members"),
}));
vi.mock("./project/ProjectTagRepository", () => ({
  ProjectTagRepository: fakes.fakeClass("tags"),
}));

interface Delegation {
  readonly name: string;
  readonly invoke: (repository: ProjectRepository) => Promise<unknown>;
  readonly target: string;
  readonly args: readonly unknown[];
  /** Whether the facade hands the answer of the aggregate on. */
  readonly passesResult: boolean;
}

const role: ProjectRole = "member";
const goal: NewProjectGoal = {
  id: "g",
  projectId: "p",
  title: "t",
  position: 1,
};
const projectUpdate: ProjectUpdate = {
  name: "n",
  description: "d",
  status: "active",
  progress: 1,
};
const detailsUpdate: ProjectDetailsUpdate = {
  ...projectUpdate,
  managerId: null,
  startDate: null,
  targetDate: null,
  notes: "",
};
const icon: ProjectIcon = {
  mimeType: "image/png",
  filename: "i.png",
  data: Buffer.from("i"),
};
const newEvent: NewProjectEvent = {
  id: "e",
  projectId: "p",
  title: "t",
  description: "d",
  eventDate: "2026-01-01",
  eventTime: null,
  type: "milestone",
};
const eventUpdate: ProjectEventUpdate = {
  title: "t",
  description: "d",
  eventDate: "2026-01-01",
  eventTime: null,
  type: "milestone",
};
const integration: NewProjectIntegration = {
  repoUrl: "https://github.com/o/r",
  tokenHash: null,
  tokenEncrypted: null,
  syncIssues: true,
  syncStatus: true,
  syncComments: true,
  syncPullRequests: true,
  syncCommits: true,
  syncDirection: "bidirectional",
  syncIntervalMinutes: 5,
  isConnected: false,
  repoName: null,
  lastSyncAt: null,
};
const schedule: ProjectSyncSchedule = { lastSyncAt: null, nextSyncAt: "n" };
const activityEntry: NewProjectActivity = {
  id: "a",
  projectId: "p",
  userId: "u",
  category: "project",
  action: "x",
  message: "m",
};
const template: ProjectTemplate = {
  id: "t",
  projectId: "p",
  name: "n",
  description: "d",
  status: "active",
  goals: [],
  tags: [],
};
const eventRecord: PagesEventRecord = { type: "k", id: "i" };
const newProject: NewProject = {
  id: "p",
  name: "n",
  description: "d",
  ownerId: "o",
  placeholderColor: "#FCE3D3",
  status: "active",
  departmentIds: ["d"],
};

function delegation(
  name: string,
  invoke: Delegation["invoke"],
  target: string,
  args: readonly unknown[],
): Delegation {
  return { name, invoke, target, args, passesResult: true };
}

function voidDelegation(
  name: string,
  invoke: Delegation["invoke"],
  target: string,
  args: readonly unknown[],
): Delegation {
  return { ...delegation(name, invoke, target, args), passesResult: false };
}

// The values below only travel through the facade; their shape is irrelevant.
const DELEGATIONS: readonly Delegation[] = [
  delegation(
    "findActiveIds",
    (r) => r.findActiveIds(),
    "projects.findActiveIds",
    [],
  ),
  delegation(
    "findTemplates",
    (r) => r.findTemplates(),
    "templates.findAll",
    [],
  ),
  delegation(
    "findDepartmentsByProjects",
    (r) => r.findDepartmentsByProjects(["p"]),
    "departments.findByProjectIds",
    [["p"]],
  ),
  delegation(
    "findDepartments",
    (r) => r.findDepartments("p"),
    "departments.findByProjectId",
    ["p"],
  ),
  voidDelegation(
    "setDepartments",
    (r) => r.setDepartments("p", ["d"]),
    "departments.replace",
    ["p", ["d"]],
  ),
  delegation("isMember", (r) => r.isMember("p", "u"), "members.isMember", [
    "p",
    "u",
  ]),
  delegation(
    "isProjectManager",
    (r) => r.isProjectManager("p", "u"),
    "members.isProjectManager",
    ["p", "u"],
  ),
  delegation(
    "findManagedProjectIds",
    (r) => r.findManagedProjectIds("u"),
    "members.findManagedProjectIds",
    ["u"],
  ),
  voidDelegation(
    "update",
    (r) => r.update("p", projectUpdate),
    "projects.update",
    ["p", projectUpdate],
  ),
  voidDelegation(
    "updateDetails",
    (r) => r.updateDetails("p", detailsUpdate),
    "projects.updateDetails",
    ["p", detailsUpdate],
  ),
  delegation("archive", (r) => r.archive("p"), "projects.archive", ["p"]),
  delegation(
    "findIconByProjectId",
    (r) => r.findIconByProjectId("p"),
    "icons.findByProjectId",
    ["p"],
  ),
  voidDelegation("upsertIcon", (r) => r.upsertIcon("p", icon), "icons.upsert", [
    "p",
    icon,
  ]),
  delegation(
    "findMembers",
    (r) => r.findMembers("p"),
    "members.findByProjectId",
    ["p"],
  ),
  voidDelegation(
    "addMember",
    (r) => r.addMember("p", "u", role, "joined"),
    "members.add",
    ["p", "u", role, "joined"],
  ),
  voidDelegation(
    "updateMemberRole",
    (r) => r.updateMemberRole("p", "u", role),
    "members.updateRole",
    ["p", "u", role],
  ),
  voidDelegation(
    "removeMember",
    (r) => r.removeMember("p", "u"),
    "members.remove",
    ["p", "u"],
  ),
  delegation("findGoals", (r) => r.findGoals("p"), "goals.findByProjectId", [
    "p",
  ]),
  voidDelegation("insertGoal", (r) => r.insertGoal(goal), "goals.insert", [
    goal,
  ]),
  voidDelegation(
    "updateGoal",
    (r) => r.updateGoal("g", "t", true),
    "goals.update",
    ["g", "t", true],
  ),
  voidDelegation("deleteGoal", (r) => r.deleteGoal("g"), "goals.delete", ["g"]),
  delegation("findTags", (r) => r.findTags("p"), "tags.findByProjectId", ["p"]),
  delegation("findEvents", (r) => r.findEvents("p"), "events.findByProjectId", [
    "p",
  ]),
  voidDelegation(
    "insertEvent",
    (r) => r.insertEvent(newEvent),
    "events.insert",
    [newEvent],
  ),
  voidDelegation(
    "updateEvent",
    (r) => r.updateEvent("e", eventUpdate),
    "events.update",
    ["e", eventUpdate],
  ),
  voidDelegation("archiveEvent", (r) => r.archiveEvent("e"), "events.archive", [
    "e",
  ]),
  delegation(
    "findIntegration",
    (r) => r.findIntegration("p"),
    "integrations.findByProjectId",
    ["p"],
  ),
  delegation(
    "findIntegrationsByProjectIds",
    (r) => r.findIntegrationsByProjectIds(["p"]),
    "integrations.findByProjectIds",
    [["p"]],
  ),
  delegation(
    "findTokenEncrypted",
    (r) => r.findTokenEncrypted("p"),
    "integrations.findTokenEncrypted",
    ["p"],
  ),
  delegation(
    "findDueSyncIntegrations",
    (r) => r.findDueSyncIntegrations("now"),
    "integrations.findDueSyncs",
    ["now"],
  ),
  voidDelegation(
    "updateSyncSchedule",
    (r) => r.updateSyncSchedule("p", schedule),
    "integrations.updateSyncSchedule",
    ["p", schedule],
  ),
  voidDelegation(
    "deferNextSync",
    (r) => r.deferNextSync("p", "next"),
    "integrations.deferNextSync",
    ["p", "next"],
  ),
  voidDelegation(
    "markIntegrationDisconnected",
    (r) => r.markIntegrationDisconnected("p", "token"),
    "integrations.markDisconnected",
    ["p", "token"],
  ),
  voidDelegation(
    "setIntegrationSyncEnabled",
    (r) => r.setIntegrationSyncEnabled("p", true),
    "integrations.setSyncEnabled",
    ["p", true],
  ),
  voidDelegation(
    "upsertIntegration",
    (r) => r.upsertIntegration("p", integration),
    "integrations.upsert",
    ["p", integration],
  ),
  voidDelegation(
    "deleteIntegration",
    (r) => r.deleteIntegration("p"),
    "integrations.delete",
    ["p"],
  ),
  delegation(
    "findActivity",
    (r) => r.findActivity("p"),
    "activity.findByProjectId",
    ["p", undefined, undefined],
  ),
  voidDelegation(
    "insertActivity",
    (r) => r.insertActivity(activityEntry),
    "activity.insert",
    [activityEntry],
  ),
  voidDelegation(
    "saveTemplate",
    (r) => r.saveTemplate(template),
    "templates.save",
    [template],
  ),
  voidDelegation(
    "appendEvent",
    (r) => r.appendEvent(eventRecord),
    "outbox.append",
    [eventRecord],
  ),
];

function databaseOf(): {
  readonly database: ConstructorParameters<typeof ProjectRepository>[0];
  readonly transaction: DatabaseTransaction;
} {
  const transaction: DatabaseTransaction = {
    execute: vi.fn(async () => {}),
    query: vi.fn(async (): Promise<readonly DatabaseValue[][]> => []),
  };
  const run = async <Result>(
    work: (scope: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work(transaction);

  return {
    database: {
      execute: vi.fn(async () => {}),
      query: vi.fn(async () => []),
      transaction: run,
      readTransaction: run,
    },
    transaction,
  };
}

beforeEach(() => {
  fakes.methods.clear();
  fakes.constructed.length = 0;
});

it.each(DELEGATIONS)("delegates $name to the aggregate", async (entry) => {
  const target = fakes.method(entry.target);
  target.mockResolvedValue("answer");

  const result = await entry.invoke(
    new ProjectRepository(databaseOf().database),
  );

  expect(target).toHaveBeenCalledWith(...entry.args);
  expect(result).toBe(entry.passesResult ? "answer" : undefined);
});

it("adds the departments to every project listing", async () => {
  const departments = [{ id: "d", name: "D" }];
  fakes
    .method("departments.findByProjectIds")
    .mockResolvedValue(new Map([["a", departments]]));
  fakes
    .method("projects.findAll")
    .mockResolvedValue([{ id: "a" }, { id: "b" }]);
  fakes.method("projects.findArchived").mockResolvedValue([{ id: "a" }]);
  fakes.method("projects.findByMemberId").mockResolvedValue([{ id: "b" }]);
  const repository = new ProjectRepository(databaseOf().database);

  await expect(repository.findAll()).resolves.toEqual([
    { id: "a", departments },
    { id: "b", departments: [] },
  ]);
  await expect(repository.findArchived()).resolves.toEqual([
    { id: "a", departments },
  ]);
  await expect(repository.findByMemberId("m")).resolves.toEqual([
    { id: "b", departments: [] },
  ]);
});

it("adds the departments to a project and an archived project", async () => {
  fakes.method("departments.findByProjectId").mockResolvedValue(["department"]);
  fakes.method("projects.findById").mockResolvedValueOnce({ id: "a" });
  fakes.method("projects.findArchivedById").mockResolvedValueOnce({ id: "a" });
  const repository = new ProjectRepository(databaseOf().database);

  await expect(repository.findById("a")).resolves.toEqual({
    id: "a",
    departments: ["department"],
  });
  await expect(repository.findArchivedById("a")).resolves.toEqual({
    id: "a",
    departments: ["department"],
  });
});

it("returns null for a missing project", async () => {
  fakes.method("projects.findById").mockResolvedValue(null);
  fakes.method("projects.findArchivedById").mockResolvedValue(null);
  const repository = new ProjectRepository(databaseOf().database);

  await expect(repository.findById("a")).resolves.toBeNull();
  await expect(repository.findArchivedById("a")).resolves.toBeNull();
});

it("binds a transaction repository to the open transaction", async () => {
  const { database, transaction } = databaseOf();
  const repository = new ProjectRepository(database, "mcp");

  const result = await repository.transaction(async (bound) => {
    await bound.findActiveIds();

    return "done";
  });
  await repository.readTransaction(async () => "read");

  expect(result).toBe("done");
  const scopes = fakes.constructed
    .filter((entry) => entry.name === "projects")
    .map(
      (entry) =>
        entry.database as ConstructorParameters<typeof ProjectRepository>[0],
    );
  expect(scopes).toHaveLength(3);
  const scope = scopes[1];
  await scope?.execute("SELECT 1");
  await scope?.query("SELECT 2");
  await expect(scope?.transaction(async (inner) => inner)).resolves.toBe(
    transaction,
  );
  await expect(scope?.readTransaction(async (inner) => inner)).resolves.toBe(
    transaction,
  );
  expect(transaction.execute).toHaveBeenCalledWith("SELECT 1");
  expect(transaction.query).toHaveBeenCalledWith("SELECT 2");
});

it("creates the authorization repository on the same database", () => {
  const { database } = databaseOf();

  new ProjectRepository(database).authorization();

  expect(
    fakes.constructed.filter((entry) => entry.name === "authorization"),
  ).toEqual([{ name: "authorization", database }]);
});

it("inserts a project with its departments in one transaction", async () => {
  fakes.method("projects.insert").mockResolvedValue(undefined);
  fakes.method("departments.replace").mockResolvedValue(undefined);
  const repository = new ProjectRepository(databaseOf().database);

  await repository.insert(newProject);
  await repository.insert({ ...newProject, id: "q", departmentIds: undefined });

  expect(fakes.method("projects.insert")).toHaveBeenCalledTimes(2);
  expect(fakes.method("departments.replace")).toHaveBeenNthCalledWith(1, "p", [
    "d",
  ]);
  expect(fakes.method("departments.replace")).toHaveBeenNthCalledWith(
    2,
    "q",
    [],
  );
});

it("deletes a project permanently inside a transaction", async () => {
  fakes.method("lifecycle.delete").mockResolvedValue({ files: [] });

  await expect(
    new ProjectRepository(databaseOf().database).deletePermanently("p"),
  ).resolves.toEqual({ files: [] });
  expect(fakes.method("lifecycle.delete")).toHaveBeenCalledWith("p");
});

it("replaces the tags inside a transaction", async () => {
  fakes.method("tags.replace").mockResolvedValue(undefined);

  await new ProjectRepository(databaseOf().database).setTags("p", ["a"]);

  expect(fakes.method("tags.replace")).toHaveBeenCalledWith("p", ["a"]);
});

it("describes the deletion of a project", async () => {
  fakes.method("deletionScope.findRecord").mockResolvedValue({ name: "P" });
  fakes.method("deletionScope.findMemberIds").mockResolvedValue(["u"]);
  fakes.method("deletionScope.count").mockResolvedValue({ tickets: 1 });
  fakes.method("deletionScope.countDetachments").mockResolvedValue({ x: 2 });
  fakes
    .method("departments.findByProjectId")
    .mockResolvedValue([{ id: "d", name: "Department" }]);

  await expect(
    new ProjectRepository(databaseOf().database).describeDeletion("p"),
  ).resolves.toEqual({
    memberIds: ["u"],
    scope: {
      project: { id: "p", name: "P", departmentNames: ["Department"] },
      counts: { tickets: 1 },
      detached: { x: 2 },
    },
  });
});

it("describes no deletion for a missing project", async () => {
  fakes.method("deletionScope.findRecord").mockResolvedValue(null);

  await expect(
    new ProjectRepository(databaseOf().database).describeDeletion("p"),
  ).resolves.toBeNull();
});
