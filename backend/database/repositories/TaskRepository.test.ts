import { describe, expect, it, vi } from "vitest";

import { TaskRepository } from "./TaskRepository";

import type { TaskDatabase } from "./task/TaskDatabase";
import type { NewWorkItem } from "./task/WorkItemWriteRepository";

type Method = ReturnType<typeof vi.fn>;

const mocks = vi.hoisted(() => {
  /** The recording methods of the latest instance, by repository class. */
  const methods = new Map<string, Map<string, Method>>();

  /** Builds a class whose instances record every method call, without persistence. */
  function mockedRepository(name: string): new () => object {
    return class {
      public constructor() {
        const recorded = new Map<string, Method>();
        methods.set(name, recorded);
        return new Proxy(
          {},
          {
            get: (target, property: string): Method => {
              const recordedMethod = recorded.get(property) ?? vi.fn();
              recorded.set(property, recordedMethod);
              return recordedMethod;
            },
          },
        );
      }
    };
  }

  /** The recording function of a method, created when first asked for. */
  function methodOf(name: string, property: string): Method {
    const recorded = methods.get(name);
    if (!recorded) throw new Error(`No instance of ${name}.`);
    const recordedMethod = recorded.get(property) ?? vi.fn();
    recorded.set(property, recordedMethod);
    return recordedMethod;
  }

  return { methodOf, mockedRepository };
});

vi.mock("./task/WorkflowStatusRepository", () => ({
  WorkflowStatusRepository: mocks.mockedRepository("WorkflowStatusRepository"),
}));
vi.mock("./task/MilestoneRepository", () => ({
  MilestoneRepository: mocks.mockedRepository("MilestoneRepository"),
}));
vi.mock("./task/MilestoneDependencyRepository", () => ({
  MilestoneDependencyRepository: mocks.mockedRepository(
    "MilestoneDependencyRepository",
  ),
}));
vi.mock("./task/MilestoneInitiativeRepository", () => ({
  MilestoneInitiativeRepository: mocks.mockedRepository(
    "MilestoneInitiativeRepository",
  ),
}));
vi.mock("./task/WorkItemHistoryRepository", () => ({
  WorkItemHistoryRepository: mocks.mockedRepository(
    "WorkItemHistoryRepository",
  ),
}));
vi.mock("./task/WorkItemKeyRepository", () => ({
  WorkItemKeyRepository: mocks.mockedRepository("WorkItemKeyRepository"),
}));
vi.mock("./task/WorkItemQueryRepository", () => ({
  WorkItemQueryRepository: mocks.mockedRepository("WorkItemQueryRepository"),
}));
vi.mock("./task/WorkItemCountRepository", () => ({
  WorkItemCountRepository: mocks.mockedRepository("WorkItemCountRepository"),
}));
vi.mock("./task/WorkItemWriteRepository", () => ({
  WorkItemWriteRepository: mocks.mockedRepository("WorkItemWriteRepository"),
}));
vi.mock("./task/WorkItemDepartmentRepository", () => ({
  WorkItemDepartmentRepository: mocks.mockedRepository(
    "WorkItemDepartmentRepository",
  ),
}));
vi.mock("./task/WorkItemProjectMoveRepository", () => ({
  WorkItemProjectMoveRepository: mocks.mockedRepository(
    "WorkItemProjectMoveRepository",
  ),
}));
vi.mock("./task/WorkItemLifecycleRepository", () => ({
  WorkItemLifecycleRepository: mocks.mockedRepository(
    "WorkItemLifecycleRepository",
  ),
}));
vi.mock("./task/TaskLabelRepository", () => ({
  TaskLabelRepository: mocks.mockedRepository("TaskLabelRepository"),
}));
vi.mock("./task/WorkItemChecklistRepository", () => ({
  WorkItemChecklistRepository: mocks.mockedRepository(
    "WorkItemChecklistRepository",
  ),
}));
vi.mock("./task/WorkItemLinkRepository", () => ({
  WorkItemLinkRepository: mocks.mockedRepository("WorkItemLinkRepository"),
}));
vi.mock("./task/EligibleAssigneeRepository", () => ({
  EligibleAssigneeRepository: mocks.mockedRepository(
    "EligibleAssigneeRepository",
  ),
}));
vi.mock("./UserGroupRepository", () => ({
  UserGroupRepository: mocks.mockedRepository("UserGroupRepository"),
}));
vi.mock("./agents/AgentOperationKeyRepository", () => ({
  AgentOperationKeyRepository: mocks.mockedRepository(
    "AgentOperationKeyRepository",
  ),
}));

const REPOSITORIES = {
  statuses: "WorkflowStatusRepository",
  milestones: "MilestoneRepository",
  dependencies: "MilestoneDependencyRepository",
  initiatives: "MilestoneInitiativeRepository",
  history: "WorkItemHistoryRepository",
  keys: "WorkItemKeyRepository",
  queries: "WorkItemQueryRepository",
  counts: "WorkItemCountRepository",
  writes: "WorkItemWriteRepository",
  departments: "WorkItemDepartmentRepository",
  moves: "WorkItemProjectMoveRepository",
  lifecycle: "WorkItemLifecycleRepository",
  labels: "TaskLabelRepository",
  checklist: "WorkItemChecklistRepository",
  links: "WorkItemLinkRepository",
  assignees: "EligibleAssigneeRepository",
  groups: "UserGroupRepository",
} as const;

type Group = keyof typeof REPOSITORIES;

const FORWARDS: readonly (readonly [
  string,
  Group,
  string,
  readonly string[],
])[] = [
  ["findAllStatuses", "statuses", "findAll", []],
  ["findStatusById", "statuses", "findById", ["a"]],
  ["findMilestonesByProjectIds", "milestones", "findByProjectIds", ["a"]],
  ["insertMilestone", "milestones", "insert", ["a"]],
  ["updateMilestone", "milestones", "update", ["a", "b"]],
  ["updateMilestoneField", "milestones", "updateField", ["a", "b"]],
  ["archiveMilestone", "milestones", "archive", ["a"]],
  ["findDependenciesByProjectIds", "dependencies", "findByProjectIds", ["a"]],
  ["insertDependency", "dependencies", "insert", ["a"]],
  ["deleteDependency", "dependencies", "delete", ["a"]],
  ["deleteDependenciesByMilestone", "dependencies", "deleteByMilestone", ["a"]],
  ["findMilestoneInitiativeLinks", "initiatives", "findByProjectIds", ["a"]],
  ["linkInitiativeToMilestone", "initiatives", "insert", ["a", "b"]],
  ["unlinkInitiativeFromMilestone", "initiatives", "delete", ["a", "b"]],
  ["setMilestoneIfEmpty", "initiatives", "setMilestoneIfEmpty", ["a", "b"]],
  ["clearMilestone", "initiatives", "clearMilestone", ["a", "b"]],
  ["countMilestoneDependents", "initiatives", "countDependents", ["a", "b"]],
  ["findHistoryByProjectId", "history", "findByProjectId", ["a", "b"]],
  ["findOrCreateProjectKey", "keys", "findOrCreateProjectKey", ["a", "b"]],
  ["reserveNumbers", "keys", "reserveNumbers", ["a", "b"]],
  ["findAll", "queries", "findAll", ["a"]],
  ["countWorkItemsOverview", "counts", "countOverview", ["a", "b", "c"]],
  ["countWorkItemsByProject", "counts", "countByProject", ["a", "b"]],
  ["findById", "queries", "findById", ["a", "b"]],
  ["findByKey", "queries", "findByKey", ["a", "b"]],
  ["findParentReference", "queries", "findParentReference", ["a"]],
  ["findVisibleKeys", "queries", "findVisibleKeys", ["a", "b"]],
  ["findSubtasks", "queries", "findSubtasks", ["a", "b"]],
  ["findLinkedWorkItems", "queries", "findLinkedWorkItems", ["a", "b"]],
  [
    "findArchivedLinkedWorkItems",
    "queries",
    "findArchivedLinkedWorkItems",
    ["a", "b"],
  ],
  ["updateGitHubLink", "writes", "updateGitHubLink", ["a", "b"]],
  ["setGitHubConflict", "writes", "setGitHubConflict", ["a", "b"]],
  [
    "findKnownGitHubIssueNumbers",
    "queries",
    "findKnownGitHubIssueNumbers",
    ["a"],
  ],
  ["update", "writes", "update", ["a", "b"]],
  ["updateFromGitHub", "writes", "updateFromGitHub", ["a", "b"]],
  [
    "updateStatusAndOrder",
    "writes",
    "updateStatusAndOrder",
    ["a", "b", "c", "d"],
  ],
  ["storedTextForm", "writes", "storedTextForm", ["a"]],
  ["updateDescription", "writes", "updateDescription", ["a", "b", "c"]],
  ["updateTitle", "writes", "updateTitle", ["a", "b", "c"]],
  ["updateStatus", "writes", "updateStatus", ["a", "b", "c"]],
  ["replaceParent", "writes", "replaceParent", ["a", "b", "c"]],
  ["updateParent", "writes", "updateParent", ["a", "b"]],
  ["findDepartmentIds", "departments", "find", ["a"]],
  ["setDepartments", "departments", "replace", ["a", "b", "c"]],
  ["findSubtreeIds", "lifecycle", "findSubtreeIds", ["a", "b"]],
  ["countDescendants", "lifecycle", "countDescendants", ["a", "b"]],
  ["detachChildren", "lifecycle", "detachChildren", ["a", "b"]],
  ["archiveMany", "lifecycle", "archiveMany", ["a"]],
  ["restoreMany", "lifecycle", "restoreMany", ["a"]],
  ["findSubtreeStorageNames", "lifecycle", "findSubtreeStorageNames", ["a"]],
  ["deleteSubtree", "lifecycle", "deleteSubtree", ["a"]],
  ["setGitHubError", "writes", "setGitHubError", ["a", "b"]],
  ["moveToProject", "moves", "moveToProject", ["a", "b"]],
  ["moveSubtreeIfCurrent", "moves", "moveSubtreeIfCurrent", ["a", "b"]],
  ["findLabels", "labels", "findAll", []],
  ["findLabelByName", "labels", "findByName", ["a"]],
  ["findLabelById", "labels", "findById", ["a"]],
  ["countLabelUsage", "labels", "countUsage", ["a", "b"]],
  ["countLabelUsageByLabel", "labels", "countUsageByLabel", ["a"]],
  ["insertLabel", "labels", "insert", ["a"]],
  ["updateLabel", "labels", "update", ["a", "b"]],
  ["deleteLabel", "labels", "delete", ["a"]],
  ["findLabelsForWorkItemIds", "labels", "findByWorkItemIds", ["a"]],
  ["assignLabel", "labels", "assign", ["a", "b"]],
  ["unassignLabel", "labels", "unassign", ["a", "b"]],
  ["findChecklistItemsByWorkItemId", "checklist", "findByWorkItemId", ["a"]],
  ["findChecklistItemById", "checklist", "findById", ["a"]],
  ["insertChecklistItem", "checklist", "insert", ["a"]],
  ["updateChecklistItem", "checklist", "update", ["a", "b"]],
  [
    "setChecklistItemDoneIfCurrent",
    "checklist",
    "setDoneIfCurrent",
    ["a", "b", "c"],
  ],
  ["deleteChecklistItemIfCurrent", "checklist", "deleteIfCurrent", ["a", "b"]],
  ["deleteChecklistItem", "checklist", "delete", ["a"]],
  ["findLinksByWorkItemId", "links", "findByWorkItemId", ["a", "b"]],
  ["findLinkById", "links", "findById", ["a"]],
  ["insertLink", "links", "insert", ["a"]],
  ["deleteLink", "links", "delete", ["a"]],
  ["insertHistory", "history", "insert", ["a"]],
  ["findHistoryByWorkItemId", "history", "findByWorkItemId", ["a"]],
  ["findEligibleAssignees", "assignees", "findCandidates", []],
  ["findEligibleAssigneesByProjectIds", "assignees", "findByProjectIds", ["a"]],
  ["findAssigneeGroups", "groups", "findSummaries", []],
  ["findAssigneeGroupsWithMembers", "groups", "findAll", []],
  ["findAssigneeGroupById", "groups", "findSummaryById", ["a"]],
  ["findGroupIdsByMember", "groups", "findIdsByMember", ["a"]],
];

function method(group: Group, name: string): Method {
  return mocks.methodOf(REPOSITORIES[group], name);
}

function repositoryOf(): TaskRepository {
  return new TaskRepository({} as unknown as TaskDatabase);
}

describe("TaskRepository", () => {
  it.each(FORWARDS)(
    "forwards %s to %s.%s",
    async (facade, group, name, args) => {
      const repository = repositoryOf();
      const result = Symbol(facade);
      method(group, name).mockResolvedValue(result);
      const call = (
        repository as unknown as Record<
          string,
          (...input: unknown[]) => Promise<unknown>
        >
      )[facade];

      await expect(call?.call(repository, ...args)).resolves.toBe(result);
      expect(method(group, name)).toHaveBeenCalledWith(...args);
    },
  );

  it("passes empty options when listing without a filter", async () => {
    const repository = repositoryOf();
    method("queries", "findAll").mockResolvedValue([]);

    await repository.findAll();

    expect(method("queries", "findAll")).toHaveBeenCalledWith({});
  });

  it("passes empty read options when finding a milestone", async () => {
    const repository = repositoryOf();
    method("milestones", "findById").mockResolvedValue(null);

    await repository.findMilestoneById("m");

    expect(method("milestones", "findById")).toHaveBeenCalledWith("m", {});
  });

  it("inserts a work item together with its departments", async () => {
    const repository = repositoryOf();
    const item = { id: "w", departmentIds: ["d"] } as unknown as NewWorkItem;
    method("writes", "insert").mockResolvedValue(undefined);
    method("departments", "insert").mockResolvedValue(undefined);

    await repository.insert(item);

    expect(method("writes", "insert")).toHaveBeenCalledWith(item);
    expect(method("departments", "insert")).toHaveBeenCalledWith("w", ["d"]);
  });

  it("exposes the operation keys", () => {
    expect(repositoryOf().operations).toBeDefined();
  });
});
