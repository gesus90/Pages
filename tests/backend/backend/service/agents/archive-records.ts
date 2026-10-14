import { CAPABILITY } from "@/definition/Authorization";
import { PROJECT_STATUS } from "@/definition/Project";
import { ROLE } from "@/definition/Role";

import type { AccountAccess, Capability } from "@/definition/Authorization";
import type { Project } from "@/definition/Project";
import type { Milestone, WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

/** Mutable authorization inputs of one synthetic account. */
export interface ArchivePersonOptions {
  readonly capabilities?: readonly Capability[];
  readonly isAdmin?: boolean;
  readonly mode?: "admin" | "role";
  readonly isActive?: boolean;
  readonly mustChangePassword?: boolean;
  readonly departments?: readonly string[];
  readonly managedDepartments?: readonly string[];
  readonly allProjects?: boolean;
  readonly departmentBound?: boolean;
}

/** Builds persisted facts independently of the legacy role in the user row. */
export function archiveAccount(
  userId: string,
  options: ArchivePersonOptions,
): AccountAccess {
  return {
    userId,
    role: {
      id: "synthetic-role",
      name: "Synthetic role",
      rank: 10,
      permissions: options.capabilities ?? [
        CAPABILITY.WRITE,
        CAPABILITY.MILESTONES,
      ],
      departmentBound: options.departmentBound ?? true,
    },
    isAdmin: options.isAdmin ?? false,
    mode: options.mode ?? "role",
    isActive: options.isActive ?? true,
    firstName: userId,
    lastName: "Synthetic",
    departments: options.departments ?? ["engineering"],
    managedDepartments: options.managedDepartments ?? [],
    allProjects: options.allProjects ?? false,
    allDepartments: false,
    hasHadDepartment: true,
  };
}

/** Builds the fresh user row read inside every operation transaction. */
export function archiveUser(id: string, options: ArchivePersonOptions): User {
  return {
    id,
    username: id,
    displayName: id,
    role: ROLE.MANAGER,
    isActive: options.isActive ?? true,
    mustChangePassword: options.mustChangePassword ?? false,
  };
}

/** Builds a project with explicit department assignments. */
export function archiveProject(
  id: string,
  departmentIds: readonly string[],
): Project {
  return {
    id,
    departments: departmentIds.map((departmentId) => ({
      id: departmentId,
      name: departmentId,
    })),
    parentId: null,
    name: id,
    description: "Synthetic project",
    status: PROJECT_STATUS.ACTIVE,
    progress: 0,
    placeholderColor: "#336699",
    hasIcon: false,
    managerId: null,
    managerName: null,
    startDate: null,
    targetDate: null,
    notes: "",
    createdAt: "2026-01-01 00:00:00",
    updatedAt: "2026-01-01 00:00:00",
  };
}

/** Builds an active milestone that can be replaced by an archived row. */
export function archiveMilestone(id: string, projectId: string): Milestone {
  return {
    id,
    projectId,
    name: id,
    description: "Synthetic milestone",
    status: "open",
    startAt: null,
    dueAt: null,
    completedAt: null,
    archivedAt: null,
    createdAt: "2026-01-01 00:00:00",
    updatedAt: "2026-01-01 00:00:00",
  };
}

/** Builds a ticket; tests override only the fields whose behavior they exercise. */
export function archiveTicket(
  id: string,
  overrides: Partial<WorkItemDetail> = {},
): WorkItemDetail {
  return {
    id,
    projectId: "engineering",
    projectName: "engineering",
    departmentId: "engineering",
    key: `SYNTHETIC-${id === "root" ? 1 : 2}`,
    number: 1,
    type: "task",
    parentId: null,
    parentKey: null,
    parentTitle: null,
    title: id,
    description: "Synthetic ticket",
    statusId: "todo",
    statusKey: "todo",
    statusName: "Todo",
    isDone: false,
    priority: "normal",
    assigneeId: null,
    assigneeName: null,
    assigneeGroupId: null,
    assigneeGroupName: null,
    createdBy: "seed",
    reporterName: "Seed",
    milestoneId: "milestone",
    milestoneName: "milestone",
    dueAt: null,
    startAt: null,
    sortOrder: 0,
    createdAt: "2026-01-01 00:00:00",
    updatedAt: "2026-01-01 00:00:00",
    completedAt: null,
    archivedAt: null,
    subtaskTotal: 0,
    subtaskCompleted: 0,
    progressPercentage: 0,
    githubIssueNumber: null,
    githubIssueUrl: null,
    githubIssueState: null,
    githubIssueUpdatedAt: null,
    githubContentHash: null,
    githubConflict: false,
    githubLastSyncAt: null,
    githubLastError: null,
    ...overrides,
  };
}
