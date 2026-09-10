import {
  CheckSquare,
  Flag,
  Kanban,
  List,
  Network,
  Plus,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  data,
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSearchParams,
  useSubmit,
} from "react-router";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { Select } from "@/app/components/ui/select";
import { TaskDetailPanel } from "@/app/components/tasks/task-detail-panel";
import { TaskFormDialog } from "@/app/components/tasks/task-form-dialog";
import {
  TasksGitHub,
  type TasksGitHubProjectState,
} from "@/app/components/tasks/tasks-github";
import { TasksHierarchy } from "@/app/components/tasks/tasks-hierarchy";
import { TasksKanban } from "@/app/components/tasks/tasks-kanban";
import { TasksList } from "@/app/components/tasks/tasks-list";
import { TasksMilestones } from "@/app/components/tasks/tasks-milestones";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { cn } from "@/app/lib/cn";
import { getApplicationServices } from "@/app/lib/services.server";
import { GitHubApiError } from "@/backend/github/GitHubApiClient";
import { ProjectAccessDeniedError } from "@/backend/service/ProjectService";
import {
  WorkItemAccessDeniedError,
  WorkItemHierarchyError,
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/service/TaskService";
import {
  isWorkItemLinkType,
  isWorkItemPriority,
  isWorkItemType,
  WORK_ITEM_PRIORITY,
  WORK_ITEM_TYPE,
} from "@/definition/Task";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { GitHubPullRequest } from "@/definition/GitHub";
import type { SegmentedControlOption } from "@/app/components/ui/segmented-control";
import type { TaskSortField } from "@/app/components/tasks/tasks-list";
import type { Project } from "@/definition/Project";
import type {
  Milestone,
  ProjectLabel,
  WorkItemChecklistItem,
  WorkItemDetail,
  WorkItemHistory,
  WorkItemLink,
  WorkItemType,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

type TasksViewMode = "kanban" | "list" | "hierarchy" | "milestones" | "github";

type TaskActionIntent =
  | "archive-task"
  | "restore-task"
  | "move-project"
  | "create-task"
  | "move-task"
  | "update-task"
  | "label-create"
  | "label-update"
  | "label-delete"
  | "label-assign"
  | "label-unassign"
  | "checklist-add"
  | "checklist-toggle"
  | "checklist-delete"
  | "link-add"
  | "link-remove"
  | "sync-github-project"
  | "sync-github-task"
  | "github-import-issue"
  | "github-link-issue"
  | "github-dismiss-issue"
  | "github-assign-pr"
  | "github-resolve-conflict";

/**
 * Reads an optional text field from submitted form data.
 *
 * @param formData - Parsed request form data.
 * @param key - Field name to read.
 * @returns The trimmed value, or `null` when missing or empty.
 */
function getOptionalString(formData: FormData, key: string): string | null {
  const value = formData.get(key);

  if (typeof value !== "string") {
    return null;
  }

  if (value === "") {
    return null;
  }

  return value;
}

/**
 * Reads a text field defaulting to an empty string.
 *
 * @param formData - Parsed request form data.
 * @param key - Field name to read.
 * @returns The value, or an empty string when missing.
 */
function getFormString(formData: FormData, key: string): string {
  const value = getOptionalString(formData, key);

  if (value === null) {
    return "";
  }

  return value;
}

type TaskActionResult =
  | {
      readonly ok: true;
      readonly intent: TaskActionIntent;
      readonly key?: string;
    }
  | {
      readonly ok: false;
      readonly intent: TaskActionIntent;
      readonly error: string;
    };

export type ArchivedFilter = "active" | "archived" | "all";

/**
 * Reads the archived filter from the request URL.
 *
 * @param value - Raw query value.
 * @returns The selected filter, defaulting to active tickets.
 */
export function parseArchivedFilter(value: string | null): ArchivedFilter {
  if (value === "archived" || value === "all") {
    return value;
  }

  return "active";
}

/**
 * Reads the initial board view from the request URL.
 *
 * @param value - Raw query value kept by the ticket detail back link.
 * @returns The selected view, defaulting to the kanban board.
 */
export function parseViewMode(value: string | null): TasksViewMode {
  switch (value) {
    case "kanban":
    case "list":
    case "hierarchy":
    case "milestones":
    case "github":
      return value;
    default:
      return "kanban";
  }
}

interface TasksLoaderData {
  readonly actor: User;
  readonly projects: readonly Project[];
  readonly statuses: readonly WorkflowStatus[];
  readonly milestones: readonly Milestone[];
  readonly assignees: readonly User[];
  readonly assigneesByProject: Readonly<Record<string, readonly User[]>>;
  readonly workItems: readonly WorkItemDetail[];
  readonly labelsByWorkItem: Readonly<Record<string, readonly ProjectLabel[]>>;
  readonly labelsByProject: Readonly<Record<string, readonly ProjectLabel[]>>;
  readonly labelUsageByProject: Readonly<
    Record<string, Readonly<Record<string, number>>>
  >;
  readonly archivedFilter: ArchivedFilter;
  readonly selectedItem: WorkItemDetail | null;
  readonly selectedSubtasks: readonly WorkItemDetail[];
  readonly selectedHistory: readonly WorkItemHistory[];
  readonly selectedPullRequests: readonly GitHubPullRequest[];
  readonly selectedChecklist: readonly WorkItemChecklistItem[];
  readonly selectedLinks: readonly WorkItemLink[];
  readonly githubStates: readonly TasksGitHubProjectState[];
}

/** Loads all accessible work items, projects, statuses, and milestones for SSR. */
export async function loader({
  context,
  request,
}: LoaderFunctionArgs): Promise<TasksLoaderData> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();
  const url = new URL(request.url);
  const archivedFilter = parseArchivedFilter(url.searchParams.get("archived"));
  const view = parseViewMode(url.searchParams.get("view"));
  const projects = await services.projectService.findAll(actor);
  const projectIds = projects.map((project) => project.id);

  const statuses = await services.taskService.findAllStatuses();
  const milestones = await services.taskService.findMilestones(
    actor,
    projectIds,
  );
  const workItems = await services.taskService.findAll(actor, {
    archived: archivedFilter,
  });

  const assigneesByProjects =
    await services.taskService.findAssigneesByProjects(projectIds);
  const assigneeMap = new Map<string, User>();
  const assigneesByProject: Record<string, readonly User[]> = {};

  for (const project of projects) {
    const projectAssignees = assigneesByProjects.get(project.id) ?? [];
    assigneesByProject[project.id] = projectAssignees;

    for (const assignee of projectAssignees) {
      assigneeMap.set(assignee.id, assignee);
    }
  }

  const assignees = Array.from(assigneeMap.values()).sort((first, second) =>
    first.displayName.localeCompare(second.displayName),
  );

  const projectLabels =
    await services.taskService.findLabelsByProjects(projectIds);
  const projectLabelUsage =
    await services.taskService.countLabelUsageByProjects(projectIds);
  const labelsByProject: Record<string, readonly ProjectLabel[]> = {};
  const labelUsageByProject: Record<
    string,
    Readonly<Record<string, number>>
  > = {};

  for (const project of projects) {
    labelsByProject[project.id] = projectLabels.get(project.id) ?? [];
    labelUsageByProject[project.id] = Object.fromEntries(
      projectLabelUsage.get(project.id) ?? [],
    );
  }

  const labelsByWorkItem: Record<string, readonly ProjectLabel[]> = {};

  if (workItems.length > 0) {
    const assigned = await services.taskService.findLabelsForWorkItems(
      workItems.map((item) => item.id),
    );

    for (const [workItemId, labels] of assigned) {
      labelsByWorkItem[workItemId] = labels;
    }
  }

  const githubStates: TasksGitHubProjectState[] =
    view === "github" ? await findGitHubStates(services, projects) : [];

  const selectedKey = url.searchParams.get("item");

  let selectedItem: WorkItemDetail | null = null;
  let selectedSubtasks: WorkItemDetail[] = [];
  let selectedHistory: WorkItemHistory[] = [];
  let selectedPullRequests: GitHubPullRequest[] = [];
  let selectedChecklist: WorkItemChecklistItem[] = [];
  let selectedLinks: WorkItemLink[] = [];

  if (selectedKey) {
    const matched =
      workItems.find(
        (item) => item.key === selectedKey || item.id === selectedKey,
      ) ?? (await findSelectedWorkItem(services, actor, selectedKey));

    if (matched) {
      selectedItem = matched;

      if (!Object.hasOwn(labelsByWorkItem, matched.id)) {
        const assigned = await services.taskService.findLabelsForWorkItems([
          matched.id,
        ]);
        labelsByWorkItem[matched.id] = assigned.get(matched.id) ?? [];
      }

      selectedSubtasks = await services.taskService.findSubtasks(
        actor,
        matched.id,
      );
      selectedHistory = await services.taskService.getHistory(
        actor,
        matched.id,
      );
      selectedPullRequests =
        await services.gitHubSyncService.findPullRequestsForTask(
          actor,
          matched.id,
        );
      selectedChecklist = await services.taskService.findChecklistItems(
        actor,
        matched.id,
      );
      selectedLinks = await services.taskService.findLinks(actor, matched.id);
    }
  }

  return {
    actor,
    archivedFilter,
    assignees,
    assigneesByProject,
    githubStates,
    labelUsageByProject,
    labelsByProject,
    labelsByWorkItem,
    milestones,
    projects,
    selectedChecklist,
    selectedHistory,
    selectedItem,
    selectedLinks,
    selectedPullRequests,
    selectedSubtasks,
    statuses,
    workItems,
  };
}

/**
 * Resolves a selected ticket outside the current board filter from SQLite.
 *
 * @param services - Initialized server-side services.
 * @param actor - Authenticated user requesting the ticket.
 * @param selectedKey - Ticket key or id from the query string.
 * @returns The ticket, or `null` when it is missing or inaccessible.
 */
async function findSelectedWorkItem(
  services: ApplicationServices,
  actor: User,
  selectedKey: string,
): Promise<WorkItemDetail | null> {
  try {
    return await services.taskService.getByKey(actor, selectedKey);
  } catch (error: unknown) {
    // Missing or inaccessible tickets simply leave the detail panel closed.
    if (
      error instanceof WorkItemNotFoundError ||
      error instanceof ProjectAccessDeniedError
    ) {
      return null;
    }

    throw error;
  }
}

/**
 * Loads GitHub states for already access-checked projects with three queries.
 *
 * @param services - Initialized server-side services.
 * @param projects - Projects the actor may access.
 */
async function findGitHubStates(
  services: ApplicationServices,
  projects: readonly Project[],
): Promise<TasksGitHubProjectState[]> {
  const projectIds = projects.map((project) => project.id);
  const [integrations, externalIssuesByProject, pullRequestsByProject] =
    await Promise.all([
      services.projectService.findIntegrationsByProjects(projectIds),
      services.gitHubSyncService.findExternalIssuesByProjects(projectIds),
      services.gitHubSyncService.findPullRequestsByProjects(projectIds),
    ]);

  return projects.map((project) => ({
    externalIssues: externalIssuesByProject.get(project.id) ?? [],
    integration: integrations.get(project.id) ?? null,
    project,
    pullRequests: pullRequestsByProject.get(project.id) ?? [],
  }));
}

/** Mutates tasks, column sort orders, and audit history. */
export async function action({
  context,
  request,
}: ActionFunctionArgs): Promise<ReturnType<typeof data<TaskActionResult>>> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as TaskActionIntent | null;
  const services = await getApplicationServices();

  if (intent === "create-task") {
    const projectId = formData.get("projectId");
    const type = formData.get("type");
    const title = formData.get("title");
    const statusId = formData.get("statusId");
    const priority = formData.get("priority");

    if (
      typeof projectId !== "string" ||
      !isWorkItemType(type) ||
      typeof title !== "string" ||
      typeof statusId !== "string"
    ) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent, ok: false },
        { status: 400 },
      );
    }

    try {
      const created = await services.taskService.create(actor, {
        assigneeId: getOptionalString(formData, "assigneeId"),
        description: getFormString(formData, "description"),
        dueAt: getOptionalString(formData, "dueAt"),
        milestoneId: getOptionalString(formData, "milestoneId"),
        parentId: getOptionalString(formData, "parentId"),
        priority: isWorkItemPriority(priority)
          ? priority
          : WORK_ITEM_PRIORITY.NORMAL,
        projectId,
        startAt: getOptionalString(formData, "startAt"),
        statusId,
        title,
        type,
      });

      return data<TaskActionResult>({ intent, key: created.key, ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, intent);

      return failure;
    }
  }

  if (intent === "update-task") {
    const id = formData.get("id");
    const title = formData.get("title");
    const statusId = formData.get("statusId");
    const priority = formData.get("priority");
    const reporterId = formData.get("reporterId");

    if (
      typeof id !== "string" ||
      typeof title !== "string" ||
      typeof statusId !== "string" ||
      !isWorkItemPriority(priority) ||
      typeof reporterId !== "string"
    ) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent, ok: false },
        { status: 400 },
      );
    }

    try {
      const updated = await services.taskService.update(actor, id, {
        assigneeId: getOptionalString(formData, "assigneeId"),
        description: getFormString(formData, "description"),
        dueAt: getOptionalString(formData, "dueAt"),
        milestoneId: getOptionalString(formData, "milestoneId"),
        parentId: getOptionalString(formData, "parentId"),
        priority,
        reporterId,
        startAt: getOptionalString(formData, "startAt"),
        statusId,
        title,
      });

      return data<TaskActionResult>({ intent, key: updated.key, ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, intent);

      return failure;
    }
  }

  if (intent === "move-task") {
    const id = formData.get("id");
    const statusId = formData.get("statusId");
    const sortOrderValue = formData.get("sortOrder");

    if (
      typeof id !== "string" ||
      typeof statusId !== "string" ||
      typeof sortOrderValue !== "string"
    ) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent: "move-task", ok: false },
        { status: 400 },
      );
    }

    const sortOrder = Number(sortOrderValue);

    try {
      const updated = await services.taskService.updateStatusAndOrder(
        actor,
        id,
        statusId,
        sortOrder,
      );

      return data<TaskActionResult>({
        intent: "move-task",
        key: updated.key,
        ok: true,
      });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, "move-task");

      return failure;
    }
  }

  if (intent === "archive-task") {
    const id = formData.get("id");

    if (typeof id !== "string" || !id) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent: "archive-task", ok: false },
        { status: 400 },
      );
    }

    try {
      await services.taskService.archive(actor, id);

      return data<TaskActionResult>({ intent: "archive-task", ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, "archive-task");

      return failure;
    }
  }

  if (intent === "sync-github-project") {
    const projectId = formData.get("projectId");

    if (typeof projectId !== "string" || !projectId) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent, ok: false },
        { status: 400 },
      );
    }

    try {
      await services.gitHubSyncService.syncProjectNow(actor, projectId);

      return data<TaskActionResult>({ intent, ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, intent);

      return failure;
    }
  }

  if (intent === "sync-github-task") {
    const id = formData.get("id");

    if (typeof id !== "string" || !id) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent, ok: false },
        { status: 400 },
      );
    }

    try {
      await services.gitHubSyncService.syncSingleTask(actor, id);

      return data<TaskActionResult>({ intent, ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, intent);

      return failure;
    }
  }

  if (intent === "github-import-issue") {
    const projectId = formData.get("projectId");
    const issueNumber = Number(formData.get("issueNumber"));

    if (
      typeof projectId !== "string" ||
      !projectId ||
      !Number.isInteger(issueNumber) ||
      issueNumber <= 0
    ) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent, ok: false },
        { status: 400 },
      );
    }

    try {
      const imported = await services.gitHubSyncService.importExternalIssue(
        actor,
        projectId,
        issueNumber,
      );

      return data<TaskActionResult>({ intent, key: imported.key, ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, intent);

      return failure;
    }
  }

  if (intent === "github-link-issue") {
    const id = formData.get("workItemId");
    const externalId = formData.get("externalId");

    if (
      typeof id !== "string" ||
      !id ||
      typeof externalId !== "string" ||
      !externalId
    ) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent, ok: false },
        { status: 400 },
      );
    }

    try {
      const linked = await services.gitHubSyncService.linkExternalIssue(
        actor,
        id,
        externalId,
      );

      return data<TaskActionResult>({ intent, key: linked.key, ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, intent);

      return failure;
    }
  }

  if (intent === "github-dismiss-issue") {
    const externalId = formData.get("externalId");

    if (typeof externalId !== "string" || !externalId) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent, ok: false },
        { status: 400 },
      );
    }

    try {
      await services.gitHubSyncService.dismissExternalIssue(actor, externalId);

      return data<TaskActionResult>({ intent, ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, intent);

      return failure;
    }
  }

  if (intent === "github-assign-pr") {
    const pullRequestId = formData.get("pullRequestId");

    if (typeof pullRequestId !== "string" || !pullRequestId) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent, ok: false },
        { status: 400 },
      );
    }

    try {
      await services.gitHubSyncService.assignPullRequest(
        actor,
        pullRequestId,
        getOptionalString(formData, "workItemId"),
      );

      return data<TaskActionResult>({ intent, ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, intent);

      return failure;
    }
  }

  if (intent === "github-resolve-conflict") {
    const id = formData.get("id");
    const resolution = formData.get("resolution");

    if (
      typeof id !== "string" ||
      !id ||
      (resolution !== "pages" && resolution !== "github")
    ) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent, ok: false },
        { status: 400 },
      );
    }

    try {
      const resolved = await services.gitHubSyncService.resolveConflict(
        actor,
        id,
        resolution,
      );

      return data<TaskActionResult>({ intent, key: resolved.key, ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, intent);

      return failure;
    }
  }

  if (intent === "restore-task") {
    const id = formData.get("id");

    if (typeof id !== "string" || !id) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent: "restore-task", ok: false },
        { status: 400 },
      );
    }

    try {
      await services.taskService.restore(actor, id);

      return data<TaskActionResult>({ intent: "restore-task", ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, "restore-task");

      return failure;
    }
  }

  if (intent === "move-project") {
    const id = formData.get("id");
    const targetProjectId = formData.get("targetProjectId");

    if (
      typeof id !== "string" ||
      !id ||
      typeof targetProjectId !== "string" ||
      !targetProjectId
    ) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent: "move-project", ok: false },
        { status: 400 },
      );
    }

    try {
      const moved = await services.taskService.moveToProject(
        actor,
        id,
        targetProjectId,
      );

      return data<TaskActionResult>({
        intent: "move-project",
        key: moved.key,
        ok: true,
      });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, "move-project");

      return failure;
    }
  }

  if (intent === "label-create") {
    const projectId = formData.get("projectId");
    const name = formData.get("name");
    const color = formData.get("color");

    if (
      typeof projectId !== "string" ||
      !projectId ||
      typeof name !== "string" ||
      typeof color !== "string"
    ) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent, ok: false },
        { status: 400 },
      );
    }

    try {
      await services.taskService.createLabel(actor, projectId, {
        color,
        name,
      });

      return data<TaskActionResult>({ intent, ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, intent);

      return failure;
    }
  }

  if (intent === "label-update") {
    const labelId = formData.get("labelId");
    const name = formData.get("name");
    const color = formData.get("color");

    if (
      typeof labelId !== "string" ||
      !labelId ||
      typeof name !== "string" ||
      typeof color !== "string"
    ) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent, ok: false },
        { status: 400 },
      );
    }

    try {
      await services.taskService.updateLabel(actor, labelId, {
        color,
        name,
      });

      return data<TaskActionResult>({ intent, ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, intent);

      return failure;
    }
  }

  if (intent === "label-delete") {
    const labelId = formData.get("labelId");

    if (typeof labelId !== "string" || !labelId) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent, ok: false },
        { status: 400 },
      );
    }

    try {
      await services.taskService.deleteLabel(actor, labelId);

      return data<TaskActionResult>({ intent, ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, intent);

      return failure;
    }
  }

  if (intent === "label-assign") {
    const id = formData.get("workItemId");
    const labelId = formData.get("labelId");

    if (
      typeof id !== "string" ||
      !id ||
      typeof labelId !== "string" ||
      !labelId
    ) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent, ok: false },
        { status: 400 },
      );
    }

    try {
      await services.taskService.assignLabel(actor, id, labelId);

      return data<TaskActionResult>({ intent, ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, intent);

      return failure;
    }
  }

  if (intent === "label-unassign") {
    const id = formData.get("workItemId");
    const labelId = formData.get("labelId");

    if (
      typeof id !== "string" ||
      !id ||
      typeof labelId !== "string" ||
      !labelId
    ) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent, ok: false },
        { status: 400 },
      );
    }

    try {
      await services.taskService.unassignLabel(actor, id, labelId);

      return data<TaskActionResult>({ intent, ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, intent);

      return failure;
    }
  }

  if (intent === "checklist-add") {
    const workItemId = formData.get("workItemId");
    const title = formData.get("title");

    if (
      typeof workItemId !== "string" ||
      !workItemId ||
      typeof title !== "string" ||
      !title.trim()
    ) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent, ok: false },
        { status: 400 },
      );
    }

    try {
      await services.taskService.addChecklistItem(actor, workItemId, title);

      return data<TaskActionResult>({ intent, ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, intent);

      return failure;
    }
  }

  if (intent === "checklist-toggle") {
    const checklistItemId = formData.get("checklistItemId");
    const isDone = formData.get("isDone");

    if (typeof checklistItemId !== "string" || !checklistItemId) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent, ok: false },
        { status: 400 },
      );
    }

    try {
      await services.taskService.setChecklistItemDone(
        actor,
        checklistItemId,
        isDone === "true",
      );

      return data<TaskActionResult>({ intent, ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, intent);

      return failure;
    }
  }

  if (intent === "checklist-delete") {
    const checklistItemId = formData.get("checklistItemId");

    if (typeof checklistItemId !== "string" || !checklistItemId) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent, ok: false },
        { status: 400 },
      );
    }

    try {
      await services.taskService.deleteChecklistItem(actor, checklistItemId);

      return data<TaskActionResult>({ intent, ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, intent);

      return failure;
    }
  }

  if (intent === "link-add") {
    const workItemId = formData.get("workItemId");
    const targetKey = formData.get("targetKey");
    const linkType = formData.get("linkType");

    if (
      typeof workItemId !== "string" ||
      !workItemId ||
      typeof targetKey !== "string" ||
      !targetKey.trim() ||
      !isWorkItemLinkType(linkType)
    ) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent, ok: false },
        { status: 400 },
      );
    }

    try {
      await services.taskService.addLink(
        actor,
        workItemId,
        targetKey,
        linkType,
      );

      return data<TaskActionResult>({ intent, ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, intent);

      return failure;
    }
  }

  if (intent === "link-remove") {
    const workItemId = formData.get("workItemId");
    const linkId = formData.get("linkId");

    if (
      typeof workItemId !== "string" ||
      !workItemId ||
      typeof linkId !== "string" ||
      !linkId
    ) {
      return data<TaskActionResult>(
        { error: "invalidInput", intent, ok: false },
        { status: 400 },
      );
    }

    try {
      await services.taskService.removeLink(actor, workItemId, linkId);

      return data<TaskActionResult>({ intent, ok: true });
    } catch (error: unknown) {
      const failure = handleTaskActionError(error, intent);

      return failure;
    }
  }

  return data<TaskActionResult>(
    { error: "invalidInput", intent: "create-task", ok: false },
    { status: 400 },
  );
}

function handleTaskActionError(
  error: unknown,
  intent: TaskActionIntent,
): ReturnType<typeof data<TaskActionResult>> {
  if (error instanceof WorkItemAccessDeniedError) {
    return data<TaskActionResult>(
      { error: "forbidden", intent, ok: false },
      { status: 403 },
    );
  }

  if (error instanceof WorkItemNotFoundError) {
    return data<TaskActionResult>(
      { error: "notFound", intent, ok: false },
      { status: 404 },
    );
  }

  if (
    error instanceof WorkItemHierarchyError ||
    error instanceof WorkItemValidationError
  ) {
    return data<TaskActionResult>(
      { error: error.message, intent, ok: false },
      { status: 400 },
    );
  }

  if (error instanceof GitHubApiError) {
    return data<TaskActionResult>(
      { error: "githubSyncFailed", intent, ok: false },
      {
        status: error.status >= 400 && error.status <= 599 ? error.status : 502,
      },
    );
  }

  throw error;
}

/** Renders the responsive task views, filters, and floating ticket detail panel. */
export default function TasksRoute(): React.ReactElement {
  const { t } = useTranslation();
  const {
    actor,
    archivedFilter,
    assignees,
    assigneesByProject,
    githubStates,
    labelUsageByProject,
    labelsByProject,
    labelsByWorkItem,
    milestones,
    projects,
    selectedChecklist,
    selectedHistory,
    selectedItem,
    selectedLinks,
    selectedPullRequests,
    selectedSubtasks,
    statuses,
    workItems,
  } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const submit = useSubmit();
  const [searchParams] = useSearchParams();

  const [viewMode, setViewMode] = useState<TasksViewMode>(() =>
    parseViewMode(searchParams.get("view")),
  );
  const [filterScope, setFilterScope] = useState<"mine" | "all">("mine");
  const [filterProject, setFilterProject] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterMilestone, setFilterMilestone] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<TaskSortField>("updated");

  const [dialogState, setDialogState] = useState<{
    readonly isOpen: boolean;
    readonly mode: "create" | "edit";
    readonly selectedTaskId?: string | null;
    readonly task?: WorkItemDetail | null;
    readonly defaultProjectId?: string | null;
    readonly defaultParentId?: string | null;
    readonly defaultType?: WorkItemType;
    readonly defaultStatusId?: string | null;
  }>({
    isOpen: false,
    mode: "create",
    selectedTaskId: selectedItem?.key ?? null,
  });
  const selectedTaskId =
    selectedItem?.key ?? dialogState.selectedTaskId ?? null;

  const isSubmitting =
    navigation.state === "submitting" &&
    (navigation.formData?.get("intent") === "create-task" ||
      navigation.formData?.get("intent") === "update-task");
  const isArchiving =
    navigation.state === "submitting" &&
    (navigation.formData?.get("intent") === "archive-task" ||
      navigation.formData?.get("intent") === "restore-task");
  const isSyncing =
    navigation.state === "submitting" &&
    (navigation.formData?.get("intent") === "sync-github-project" ||
      navigation.formData?.get("intent") === "sync-github-task");

  useEffect(() => {
    if (actionData && actionData.ok) {
      if (
        actionData.intent === "create-task" ||
        actionData.intent === "update-task" ||
        actionData.intent === "github-import-issue" ||
        actionData.intent === "github-link-issue" ||
        actionData.intent === "github-resolve-conflict"
      ) {
        setDialogState((prev) => ({ ...prev, isOpen: false }));
        if (actionData.key) {
          const params = new URLSearchParams(searchParams);
          setDialogState((prev) => ({
            ...prev,
            selectedTaskId: actionData.key,
          }));
          params.set("item", actionData.key);
          void navigate(`?${params.toString()}`);
        }
      } else if (actionData.intent === "move-project") {
        setDialogState((prev) => ({ ...prev, isOpen: false }));
        if (actionData.key) {
          const params = new URLSearchParams(searchParams);
          setDialogState((prev) => ({
            ...prev,
            selectedTaskId: actionData.key,
          }));
          params.set("item", actionData.key);
          void navigate(`?${params.toString()}`);
        }
      } else if (actionData.intent === "archive-task") {
        const params = new URLSearchParams(searchParams);
        params.delete("item");
        void navigate(`?${params.toString()}`);
      }
    }
  }, [actionData, navigate, searchParams]);

  const visibleItems = workItems.filter((item) => {
    if (filterScope === "mine" && item.assigneeId !== actor.id) {
      return false;
    }

    if (filterProject !== "all" && item.projectId !== filterProject) {
      return false;
    }

    if (filterType !== "all" && item.type !== filterType) {
      return false;
    }

    if (filterStatus !== "all" && item.statusId !== filterStatus) {
      return false;
    }

    if (filterPriority !== "all" && item.priority !== filterPriority) {
      return false;
    }

    if (filterMilestone !== "all" && item.milestoneId !== filterMilestone) {
      return false;
    }

    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      const matchTitle = item.title.toLowerCase().includes(query);
      const matchKey = item.key.toLowerCase().includes(query);

      if (!matchTitle && !matchKey) {
        return false;
      }
    }

    return true;
  });

  function handleSelectTask(key: string): void {
    setDialogState((prev) => ({ ...prev, selectedTaskId: key }));
  }

  function handleOpenTask(key: string): void {
    const params = new URLSearchParams(searchParams);
    setDialogState((prev) => ({ ...prev, selectedTaskId: key }));
    params.set("item", key);
    void navigate(`?${params.toString()}`);
  }

  function handleArchivedChange(value: string): void {
    const params = new URLSearchParams(searchParams);
    params.set("archived", parseArchivedFilter(value));
    void navigate(`?${params.toString()}`);
  }

  function handleCloseDetail(): void {
    const params = new URLSearchParams(searchParams);
    params.delete("item");
    void navigate(`?${params.toString()}`);
  }

  function handleMoveTask(
    taskId: string,
    targetStatusId: string,
    sortOrder: number,
  ): void {
    submit(
      {
        id: taskId,
        intent: "move-task",
        sortOrder: String(sortOrder),
        statusId: targetStatusId,
      },
      { method: "post" },
    );
  }

  function handleCreateClick(): void {
    setDialogState({
      defaultProjectId: filterProject !== "all" ? filterProject : null,
      defaultType: WORK_ITEM_TYPE.TASK,
      isOpen: true,
      mode: "create",
      selectedTaskId,
    });
  }

  function handleQuickCreate(statusId: string): void {
    setDialogState({
      defaultProjectId: filterProject !== "all" ? filterProject : null,
      defaultStatusId: statusId,
      defaultType: WORK_ITEM_TYPE.TASK,
      isOpen: true,
      mode: "create",
      selectedTaskId,
    });
  }

  function handleCreateSubtask(parentTask: WorkItemDetail): void {
    setDialogState({
      defaultParentId: parentTask.id,
      defaultProjectId: parentTask.projectId,
      defaultType:
        parentTask.type === WORK_ITEM_TYPE.EPIC
          ? WORK_ITEM_TYPE.TASK
          : WORK_ITEM_TYPE.SUBTASK,
      isOpen: true,
      mode: "create",
      selectedTaskId,
    });
  }

  function handleEditTask(task: WorkItemDetail): void {
    setDialogState({
      isOpen: true,
      mode: "edit",
      selectedTaskId,
      task,
    });
  }

  function handleScopeChange(value: string): void {
    setFilterScope(value === "all" ? "all" : "mine");
  }

  function handleViewModeChange(value: string): void {
    const nextView = parseViewMode(value);
    setViewMode(nextView);

    const params = new URLSearchParams(searchParams);

    if (nextView === "kanban") {
      params.delete("view");
    } else {
      params.set("view", nextView);
    }

    void navigate(`?${params.toString()}`, { preventScrollReset: true });
  }

  const viewOptions: SegmentedControlOption[] = [
    {
      icon: <Kanban className="size-3.5" aria-hidden="true" />,
      label: t("tasks.view.kanban"),
      value: "kanban",
    },
    {
      icon: <List className="size-3.5" aria-hidden="true" />,
      label: t("tasks.view.list"),
      value: "list",
    },
    {
      icon: <Network className="size-3.5" aria-hidden="true" />,
      label: t("tasks.view.hierarchy"),
      value: "hierarchy",
    },
    {
      icon: <Flag className="size-3.5" aria-hidden="true" />,
      label: t("tasks.view.milestones"),
      value: "milestones",
    },
    {
      label: t("tasks.view.github"),
      value: "github",
    },
  ];

  const detailPanel = selectedItem ? (
    <TaskDetailPanel
      key={selectedItem.id}
      assignees={assignees}
      assigneesByProject={assigneesByProject}
      checklist={selectedChecklist}
      history={selectedHistory}
      isArchiving={isArchiving}
      isSyncing={isSyncing}
      labelUsage={labelUsageByProject[selectedItem.projectId] ?? {}}
      links={selectedLinks}
      milestones={milestones}
      onClose={handleCloseDetail}
      onCreateSubtask={handleCreateSubtask}
      onEdit={handleEditTask}
      onOpenTask={handleOpenTask}
      onSelectTask={handleOpenTask}
      projectLabels={labelsByProject[selectedItem.projectId] ?? []}
      projects={projects}
      pullRequests={selectedPullRequests}
      statuses={statuses}
      subtasks={selectedSubtasks}
      task={selectedItem}
      taskLabels={labelsByWorkItem[selectedItem.id] ?? []}
      workItems={workItems}
    />
  ) : null;

  return (
    <section
      className={cn(
        "flex flex-col",
        viewMode === "kanban"
          ? "h-[calc(100dvh-8.5rem)] min-h-0 overflow-hidden"
          : "min-h-[calc(100vh-theme(spacing.20))]",
      )}
    >
      <div
        className={cn(
          "flex flex-1 gap-6",
          viewMode === "kanban"
            ? "min-h-0 flex-col"
            : "flex-col xl:flex-row xl:items-start",
        )}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="select-none text-3xl font-semibold tracking-tight text-foreground xl:text-2xl">
                {t("tasks.title")}
              </h1>
              <p className="mt-1.5 select-none text-sm text-muted-foreground">
                {t("tasks.subtitle")}
              </p>
            </div>

            <Button className="gap-2" onClick={handleCreateClick} type="button">
              <Plus className="size-4" aria-hidden="true" />
              {t("tasks.create.trigger")}
            </Button>
          </div>

          <div className="mt-7 flex shrink-0 flex-wrap items-center gap-2.5">
            <SegmentedControl
              ariaLabel={t("tasks.filter.scope")}
              onValueChange={handleScopeChange}
              options={[
                { label: t("tasks.filter.myTasks"), value: "mine" },
                { label: t("tasks.filter.allTasks"), value: "all" },
              ]}
              value={filterScope}
            />

            <div className="relative h-9 min-w-52 flex-1 sm:max-w-80">
              <Search
                className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                className="h-9 rounded-lg bg-card pl-10 text-xs xl:h-9 xl:pl-10 xl:text-xs"
                placeholder={t("tasks.search")}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <Select
                ariaLabel={t("tasks.filter.allProjects")}
                value={filterProject}
                onValueChange={setFilterProject}
                options={[
                  { value: "all", label: t("tasks.filter.allProjects") },
                  ...projects.map((project) => ({
                    value: project.id,
                    label: project.name,
                  })),
                ]}
              />

              <Select
                ariaLabel={t("tasks.filter.allTypes")}
                value={filterType}
                onValueChange={setFilterType}
                options={[
                  { value: "all", label: t("tasks.filter.allTypes") },
                  {
                    value: WORK_ITEM_TYPE.INITIATIVE,
                    label: t("tasks.type.initiative"),
                  },
                  { value: WORK_ITEM_TYPE.EPIC, label: t("tasks.type.epic") },
                  { value: WORK_ITEM_TYPE.TASK, label: t("tasks.type.task") },
                  {
                    value: WORK_ITEM_TYPE.SUBTASK,
                    label: t("tasks.type.subtask"),
                  },
                ]}
              />

              <Select
                ariaLabel={t("tasks.filter.allStatuses")}
                value={filterStatus}
                onValueChange={setFilterStatus}
                options={[
                  { value: "all", label: t("tasks.filter.allStatuses") },
                  ...statuses.map((status) => ({
                    value: status.id,
                    label: status.name,
                  })),
                ]}
              />

              <Select
                ariaLabel={t("tasks.filter.allPriorities")}
                value={filterPriority}
                onValueChange={setFilterPriority}
                options={[
                  { value: "all", label: t("tasks.filter.allPriorities") },
                  {
                    value: WORK_ITEM_PRIORITY.URGENT,
                    label: t("tasks.priority.urgent"),
                  },
                  {
                    value: WORK_ITEM_PRIORITY.HIGH,
                    label: t("tasks.priority.high"),
                  },
                  {
                    value: WORK_ITEM_PRIORITY.NORMAL,
                    label: t("tasks.priority.normal"),
                  },
                  {
                    value: WORK_ITEM_PRIORITY.LOW,
                    label: t("tasks.priority.low"),
                  },
                ]}
              />

              {milestones.length > 0 ? (
                <Select
                  ariaLabel={t("tasks.filter.allMilestones")}
                  value={filterMilestone}
                  onValueChange={setFilterMilestone}
                  options={[
                    { value: "all", label: t("tasks.filter.allMilestones") },
                    ...milestones.map((milestone) => ({
                      value: milestone.id,
                      label: milestone.name,
                    })),
                  ]}
                />
              ) : null}

              <Select
                ariaLabel={t("tasks.filter.archived")}
                value={archivedFilter}
                onValueChange={handleArchivedChange}
                options={[
                  { value: "active", label: t("tasks.filter.active") },
                  {
                    value: "archived",
                    label: t("tasks.filter.archivedTickets"),
                  },
                  { value: "all", label: t("tasks.filter.all") },
                ]}
              />
            </div>
          </div>

          <div className="mt-3 flex shrink-0 justify-start">
            <SegmentedControl
              ariaLabel={t("tasks.view.label")}
              onValueChange={handleViewModeChange}
              options={viewOptions}
              value={viewMode}
            />
          </div>

          <div
            className={cn(
              "relative mt-5 flex min-h-0 flex-1 flex-col",
              viewMode === "kanban" && "overflow-hidden",
            )}
          >
            {visibleItems.length > 0 ? (
              viewMode === "kanban" ? (
                <TasksKanban
                  labelsByWorkItem={labelsByWorkItem}
                  onMoveTask={handleMoveTask}
                  onOpenTask={handleOpenTask}
                  onQuickCreate={handleQuickCreate}
                  onSelectTask={handleSelectTask}
                  selectedTaskId={selectedTaskId}
                  statuses={statuses}
                  workItems={visibleItems}
                />
              ) : viewMode === "list" ? (
                <TasksList
                  labelsByWorkItem={labelsByWorkItem}
                  onOpenTask={handleOpenTask}
                  onSelectTask={handleSelectTask}
                  onSortChange={setSortField}
                  selectedTaskId={selectedTaskId}
                  sortField={sortField}
                  workItems={visibleItems}
                />
              ) : viewMode === "hierarchy" ? (
                <TasksHierarchy
                  onOpenTask={handleOpenTask}
                  onSelectTask={handleSelectTask}
                  selectedTaskId={selectedTaskId}
                  workItems={visibleItems}
                />
              ) : viewMode === "milestones" ? (
                <TasksMilestones
                  milestones={
                    filterProject === "all"
                      ? milestones
                      : milestones.filter(
                          (milestone) => milestone.projectId === filterProject,
                        )
                  }
                  onOpenTask={handleOpenTask}
                  onSelectTask={handleSelectTask}
                  workItems={visibleItems}
                />
              ) : (
                <TasksGitHub
                  isSyncing={isSyncing}
                  onOpenTask={handleOpenTask}
                  onSelectTask={handleSelectTask}
                  states={
                    filterProject === "all"
                      ? githubStates
                      : githubStates.filter(
                          (state) => state.project.id === filterProject,
                        )
                  }
                  workItems={visibleItems}
                />
              )
            ) : workItems.length > 0 ? (
              <div className="flex flex-1 items-center justify-center rounded-3xl bg-surface/70 p-12 text-center text-sm text-muted-foreground shadow-column">
                {t("tasks.noMatches")}
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center rounded-3xl bg-surface/70 px-6 py-16 text-center shadow-column">
                <CheckSquare
                  className="size-12 text-primary"
                  aria-hidden="true"
                />
                <h2 className="mt-4 select-none text-lg font-semibold text-foreground">
                  {t("tasks.empty.title")}
                </h2>
                <p className="mt-2 max-w-sm select-none text-sm leading-relaxed text-muted-foreground">
                  {t("tasks.empty.description")}
                </p>
                <div className="mt-6">
                  <Button
                    className="gap-2"
                    onClick={handleCreateClick}
                    type="button"
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    {t("tasks.create.trigger")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {detailPanel}

      <TaskFormDialog
        assignees={assignees}
        defaultParentId={dialogState.defaultParentId}
        defaultProjectId={dialogState.defaultProjectId}
        defaultStatusId={dialogState.defaultStatusId}
        defaultType={dialogState.defaultType}
        error={actionData && !actionData.ok ? actionData.error : null}
        existingWorkItems={workItems}
        initialTask={dialogState.task}
        isOpen={dialogState.isOpen}
        isSubmitting={isSubmitting}
        milestones={milestones}
        mode={dialogState.mode}
        onOpenChange={(open) =>
          setDialogState((prev) => ({ ...prev, isOpen: open }))
        }
        projects={projects}
        statuses={statuses}
      />
    </section>
  );
}
