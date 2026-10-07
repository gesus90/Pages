import { vi } from "vitest";

import { ROLE } from "@/definition/Role";
import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";

import { recordForDialectContract } from "./dialect-contract";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

/**
 * Builds an active administrator.
 *
 * @param overrides - Values replacing the defaults.
 * @returns A user that satisfies the `User` contract.
 */
export function createUser(overrides: Partial<User> = {}): User {
  return {
    displayName: "Admin",
    id: "user-1",
    isActive: true,
    mustChangePassword: false,
    role: ROLE.ADMIN,
    username: "admin",
    ...overrides,
  };
}

/** A database double whose statements are `vi.fn()` spies. */
export type DatabaseDouble = Database & {
  execute: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
};

/**
 * Builds a database double for repository tests that assert on statements.
 *
 * @returns A database whose `execute` and `query` return `undefined` until
 * a test configures them. Every statement it receives is later checked
 * against DuckDB, see {@link recordForDialectContract}.
 */
export function createDatabase(): DatabaseDouble {
  const database = {
    close: vi.fn(),
    execute: vi.fn(),
    migrate: vi.fn(),
    query: vi.fn(),
    transaction: async <Result>(
      work: (transaction: DatabaseTransaction) => Promise<Result>,
    ): Promise<Result> => work(database),
  } as unknown as DatabaseDouble;

  recordForDialectContract(database);

  return database;
}

/**
 * Builds an unassigned-by-group task of the Pages project.
 *
 * @param overrides - Values replacing the defaults.
 * @returns A work item that satisfies the `WorkItemDetail` contract.
 */
export function createWorkItem(
  overrides: Partial<WorkItemDetail> = {},
): WorkItemDetail {
  return {
    archivedAt: null,
    assigneeGroupId: null,
    assigneeGroupName: null,
    assigneeId: "user-1",
    assigneeName: "Admin User",
    completedAt: null,
    createdAt: "2026-01-01",
    createdBy: "user-1",
    departmentId: null,
    description: "Work item description",
    dueAt: "2026-04-01",
    githubConflict: false,
    githubContentHash: null,
    githubIssueNumber: null,
    githubIssueState: null,
    githubIssueUpdatedAt: null,
    githubIssueUrl: null,
    githubLastError: null,
    githubLastSyncAt: null,
    id: "item-1",
    isDone: false,
    key: "PAGE-1",
    milestoneId: null,
    milestoneName: null,
    number: 1,
    parentId: null,
    parentKey: null,
    parentTitle: null,
    priority: WORK_ITEM_PRIORITY.NORMAL,
    progressPercentage: 0,
    projectId: "project-1",
    projectName: "Pages",
    reporterName: "Reporter User",
    sortOrder: 1,
    startAt: null,
    statusId: "status-todo",
    statusKey: "todo",
    statusName: "To Do",
    subtaskCompleted: 0,
    subtaskTotal: 0,
    title: "Setup Task",
    type: WORK_ITEM_TYPE.TASK,
    updatedAt: "2026-01-02",
    ...overrides,
  };
}
