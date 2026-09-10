import { ArrowLeft, Check, ChevronDown, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  data,
  Link,
  useActionData,
  useLoaderData,
  useSearchParams,
  useSubmit,
} from "react-router";

import { ProjectActivityTab } from "@/app/components/projects/project-activity-tab";
import { ProjectGeneralTab } from "@/app/components/projects/project-general-tab";
import { ProjectIntegrationsTab } from "@/app/components/projects/project-integrations-tab";
import { ProjectPlanningTab } from "@/app/components/projects/project-planning-tab";
import { ProjectTeamTab } from "@/app/components/projects/project-team-tab";
import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { Input } from "@/app/components/ui/input";
import { Tabs } from "@/app/components/ui/tabs";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/service/ProjectService";
import {
  WorkItemAccessDeniedError,
  WorkItemValidationError,
} from "@/backend/service/TaskService";
import {
  isGitHubSyncInterval,
  isProjectRole,
  isProjectStatus,
  PROJECT_STATUS,
} from "@/definition/Project";

import type { ProjectMember } from "@/definition/Project";
import type { Project } from "@/definition/Project";
import type { ProjectStatus } from "@/definition/Project";
import type { ProjectActivity } from "@/definition/Project";
import type { ProjectEvent } from "@/definition/Project";
import type { ProjectGoal } from "@/definition/Project";
import type { ProjectIntegration } from "@/definition/Project";
import type {
  Milestone,
  WorkItemDetail,
  WorkItemHistory,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { ChangeEvent, KeyboardEvent } from "react";

const DETAIL_TABS = [
  "general",
  "team",
  "planning",
  "integrations",
  "activity",
] as const;

type DetailTab = (typeof DETAIL_TABS)[number];

type ProjectDetailActionResult =
  { readonly ok: true } | { readonly ok: false; readonly error: string };

interface ProjectDetailLoaderData {
  readonly project: Project;
  readonly members: readonly ProjectMember[];
  readonly eligibleUsers: readonly User[];
  readonly goals: readonly ProjectGoal[];
  readonly tags: readonly string[];
  readonly events: readonly ProjectEvent[];
  readonly milestones: readonly Milestone[];
  readonly statuses: readonly WorkflowStatus[];
  readonly workItems: readonly WorkItemDetail[];
  readonly integration: ProjectIntegration | null;
  readonly activity: readonly ProjectActivity[];
  readonly taskHistory: readonly WorkItemHistory[];
  readonly canWrite: boolean;
  readonly activeTab: DetailTab;
}

function getProjectId(params: LoaderFunctionArgs["params"]): string {
  const projectId = params.projectId;

  if (!projectId) {
    throw new Response("Not Found", { status: 404 });
  }

  return projectId;
}

function getActiveTab(request: Request): DetailTab {
  const tab = new URL(request.url).searchParams.get("tab");

  return (DETAIL_TABS as readonly string[]).includes(tab ?? "")
    ? (tab as DetailTab)
    : "general";
}

function getString(formData: FormData, key: string): string {
  const value = formData.get(key);

  return typeof value === "string" ? value : "";
}

/** Loads the full project detail aggregate for server-side rendering. */
export async function loader({
  context,
  params,
  request,
}: LoaderFunctionArgs): Promise<ProjectDetailLoaderData> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const projectId = getProjectId(params);

  try {
    const services = await getApplicationServices();
    const project = await services.projectService.getById(actor, projectId);
    const activeTab = getActiveTab(request);
    const needsGeneral = activeTab === "general";
    const needsTeam = activeTab === "team";
    const needsPlanning = activeTab === "planning";
    const needsIntegrations = activeTab === "integrations";
    const needsActivity = activeTab === "activity";

    const [
      members,
      goals,
      tags,
      events,
      integration,
      activity,
      milestones,
      workItems,
      taskHistory,
      canWrite,
    ] = await Promise.all([
      needsGeneral || needsTeam
        ? services.projectService.findMembers(actor, projectId)
        : Promise.resolve([]),
      needsGeneral
        ? services.projectService.findGoals(actor, projectId)
        : Promise.resolve([]),
      needsGeneral
        ? services.projectService.findTags(actor, projectId)
        : Promise.resolve([]),
      needsGeneral || needsPlanning
        ? services.projectService.findEvents(actor, projectId)
        : Promise.resolve([]),
      needsIntegrations
        ? services.projectService.findIntegration(actor, projectId)
        : Promise.resolve(null),
      needsActivity
        ? services.projectService.findActivity(actor, projectId)
        : Promise.resolve([]),
      needsGeneral || needsPlanning
        ? services.taskService.findMilestones(actor, [projectId])
        : Promise.resolve([]),
      needsGeneral || needsPlanning
        ? services.taskService.findAll(actor, { projectIds: [projectId] })
        : Promise.resolve([]),
      needsActivity
        ? services.taskService.findHistoryByProject(actor, projectId)
        : Promise.resolve([]),
      services.projectService.canWriteProject(actor, projectId),
    ]);

    let eligibleUsers: User[] = [];

    if (needsTeam) {
      try {
        eligibleUsers = await services.taskService.findEligibleAssignees(
          actor,
          projectId,
        );
      } catch {
        eligibleUsers = [];
      }
    }

    return {
      activity,
      activeTab,
      canWrite,
      eligibleUsers,
      events,
      goals,
      integration,
      members,
      milestones,
      project,
      statuses: [],
      tags,
      taskHistory,
      workItems,
    };
  } catch (error: unknown) {
    if (error instanceof ProjectNotFoundError) {
      throw new Response("Not Found", { status: 404 });
    }

    if (error instanceof ProjectAccessDeniedError) {
      throw new Response("Forbidden", { status: 403 });
    }

    throw error;
  }
}

function toActionError(
  error: unknown,
): ReturnType<typeof data<ProjectDetailActionResult>> {
  if (
    error instanceof ProjectManagementDeniedError ||
    error instanceof ProjectAccessDeniedError ||
    error instanceof WorkItemAccessDeniedError
  ) {
    return data<ProjectDetailActionResult>(
      { error: "forbidden", ok: false },
      { status: 403 },
    );
  }

  if (
    error instanceof ProjectNotFoundError ||
    error instanceof WorkItemValidationError
  ) {
    const status = error instanceof ProjectNotFoundError ? 404 : 400;

    return data<ProjectDetailActionResult>(
      { error: "invalidInput", ok: false },
      { status },
    );
  }

  if (error instanceof Error) {
    return data<ProjectDetailActionResult>(
      { error: "invalidInput", ok: false },
      { status: 400 },
    );
  }

  throw error;
}

/** Applies project detail mutations through the persistent service layer. */
export async function action({
  context,
  params,
  request,
}: ActionFunctionArgs): Promise<
  ReturnType<typeof data<ProjectDetailActionResult>>
> {
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

  const projectId = getProjectId(params);
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    const services = await getApplicationServices();

    if (intent === "update-details") {
      const status = getString(formData, "status");

      if (!isProjectStatus(status)) {
        return data<ProjectDetailActionResult>(
          { error: "invalidInput", ok: false },
          { status: 400 },
        );
      }

      const managerId = getString(formData, "managerId").trim() || null;
      const startDate = getString(formData, "startDate").trim() || null;
      const targetDate = getString(formData, "targetDate").trim() || null;
      const current = await services.projectService.getById(actor, projectId);

      await services.projectService.updateDetails(actor, projectId, {
        description: getString(formData, "description"),
        managerId,
        name: getString(formData, "name"),
        notes: getString(formData, "notes"),
        progress: current.progress,
        startDate,
        status,
        targetDate,
      });

      return data<ProjectDetailActionResult>({ ok: true });
    }

    if (intent === "update-status") {
      const status = getString(formData, "status");

      if (!isProjectStatus(status)) {
        return data<ProjectDetailActionResult>(
          { error: "invalidInput", ok: false },
          { status: 400 },
        );
      }

      const current = await services.projectService.getById(actor, projectId);

      await services.projectService.updateDetails(actor, projectId, {
        description: current.description,
        managerId: current.managerId,
        name: current.name,
        notes: current.notes,
        progress: current.progress,
        startDate: current.startDate,
        status,
        targetDate: current.targetDate,
      });

      return data<ProjectDetailActionResult>({ ok: true });
    }

    if (intent === "update-description") {
      const description = getString(formData, "description");

      if (description.length > 5000) {
        return data<ProjectDetailActionResult>(
          { error: "invalidInput", ok: false },
          { status: 400 },
        );
      }

      const current = await services.projectService.getById(actor, projectId);

      await services.projectService.updateDetails(actor, projectId, {
        description,
        managerId: current.managerId,
        name: current.name,
        notes: current.notes,
        progress: current.progress,
        startDate: current.startDate,
        status: current.status,
        targetDate: current.targetDate,
      });

      return data<ProjectDetailActionResult>({ ok: true });
    }

    if (intent === "update-manager") {
      const current = await services.projectService.getById(actor, projectId);

      await services.projectService.updateDetails(actor, projectId, {
        description: current.description,
        managerId: getString(formData, "managerId").trim() || null,
        name: current.name,
        notes: current.notes,
        progress: current.progress,
        startDate: current.startDate,
        status: current.status,
        targetDate: current.targetDate,
      });

      return data<ProjectDetailActionResult>({ ok: true });
    }

    if (intent === "update-dates") {
      const current = await services.projectService.getById(actor, projectId);

      await services.projectService.updateDetails(actor, projectId, {
        description: current.description,
        managerId: current.managerId,
        name: current.name,
        notes: current.notes,
        progress: current.progress,
        startDate: getString(formData, "startDate").trim() || null,
        status: current.status,
        targetDate: getString(formData, "targetDate").trim() || null,
      });

      return data<ProjectDetailActionResult>({ ok: true });
    }

    if (intent === "update-name") {
      const current = await services.projectService.getById(actor, projectId);

      await services.projectService.updateDetails(actor, projectId, {
        description: current.description,
        managerId: current.managerId,
        name: getString(formData, "name"),
        notes: current.notes,
        progress: current.progress,
        startDate: current.startDate,
        status: current.status,
        targetDate: current.targetDate,
      });

      return data<ProjectDetailActionResult>({ ok: true });
    }

    if (intent === "create-goal") {
      await services.projectService.createGoal(
        actor,
        projectId,
        getString(formData, "title"),
      );

      return data<ProjectDetailActionResult>({ ok: true });
    }

    if (intent === "toggle-goal") {
      const goalId = getString(formData, "goalId");
      const goals = await services.projectService.findGoals(actor, projectId);
      const goal = goals.find((entry) => entry.id === goalId);

      if (!goal) {
        return data<ProjectDetailActionResult>(
          { error: "invalidInput", ok: false },
          { status: 400 },
        );
      }

      await services.projectService.updateGoal(
        actor,
        projectId,
        goalId,
        goal.title,
        !goal.isDone,
      );

      return data<ProjectDetailActionResult>({ ok: true });
    }

    if (intent === "delete-goal") {
      await services.projectService.deleteGoal(
        actor,
        projectId,
        getString(formData, "goalId"),
      );

      return data<ProjectDetailActionResult>({ ok: true });
    }

    if (intent === "set-tags") {
      await services.projectService.setTags(
        actor,
        projectId,
        getString(formData, "tags").split(","),
      );

      return data<ProjectDetailActionResult>({ ok: true });
    }

    if (intent === "add-member") {
      const role = getString(formData, "role");

      if (!isProjectRole(role)) {
        return data<ProjectDetailActionResult>(
          { error: "invalidInput", ok: false },
          { status: 400 },
        );
      }

      await services.projectService.addMember(
        actor,
        projectId,
        getString(formData, "userId"),
        role,
      );

      return data<ProjectDetailActionResult>({ ok: true });
    }

    if (intent === "update-member-role") {
      const role = getString(formData, "role");

      if (!isProjectRole(role)) {
        return data<ProjectDetailActionResult>(
          { error: "invalidInput", ok: false },
          { status: 400 },
        );
      }

      await services.projectService.updateMemberRole(
        actor,
        projectId,
        getString(formData, "userId"),
        role,
      );

      return data<ProjectDetailActionResult>({ ok: true });
    }

    if (intent === "remove-member") {
      await services.projectService.removeMember(
        actor,
        projectId,
        getString(formData, "userId"),
      );

      return data<ProjectDetailActionResult>({ ok: true });
    }

    if (intent === "create-milestone") {
      await services.taskService.createMilestone(actor, {
        description: getString(formData, "description"),
        dueAt: getString(formData, "dueAt").trim() || null,
        name: getString(formData, "name"),
        projectId,
      });

      return data<ProjectDetailActionResult>({ ok: true });
    }

    if (intent === "update-milestone-status") {
      const milestones = await services.taskService.findMilestones(actor, [
        projectId,
      ]);
      const milestone = milestones.find(
        (entry) => entry.id === getString(formData, "milestoneId"),
      );
      const status = getString(formData, "status");

      if (
        !milestone ||
        (status !== "open" && status !== "completed" && status !== "archived")
      ) {
        return data<ProjectDetailActionResult>(
          { error: "invalidInput", ok: false },
          { status: 400 },
        );
      }

      await services.taskService.updateMilestone(actor, milestone.id, {
        description: milestone.description,
        dueAt: milestone.dueAt,
        name: milestone.name,
        status,
      });

      return data<ProjectDetailActionResult>({ ok: true });
    }

    if (intent === "create-event") {
      await services.projectService.createEvent(actor, projectId, {
        description: getString(formData, "description"),
        eventDate: getString(formData, "eventDate").trim(),
        eventTime: getString(formData, "eventTime").trim() || null,
        title: getString(formData, "title"),
        type: getString(formData, "type").trim() || "general",
      });

      return data<ProjectDetailActionResult>({ ok: true });
    }

    if (intent === "archive-event") {
      await services.projectService.archiveEvent(
        actor,
        projectId,
        getString(formData, "eventId"),
      );

      return data<ProjectDetailActionResult>({ ok: true });
    }

    if (intent === "save-integration") {
      const direction = getString(formData, "syncDirection");
      const interval = Number(getString(formData, "syncIntervalMinutes"));

      if (!isGitHubSyncInterval(interval)) {
        return data<ProjectDetailActionResult>(
          { error: "invalidInput", ok: false },
          { status: 400 },
        );
      }

      await services.projectService.saveIntegration(actor, projectId, {
        repoUrl: getString(formData, "repoUrl"),
        syncComments: formData.get("syncComments") === "on",
        syncCommits: formData.get("syncCommits") === "on",
        syncDirection:
          direction === "push" || direction === "pull"
            ? direction
            : "bidirectional",
        syncIntervalMinutes: interval,
        syncIssues: formData.get("syncIssues") === "on",
        syncPullRequests: formData.get("syncPullRequests") === "on",
        syncStatus: formData.get("syncStatus") === "on",
        token: getString(formData, "token"),
      });

      return data<ProjectDetailActionResult>({ ok: true });
    }

    if (intent === "test-integration") {
      const connected = await services.gitHubSyncService.testConnection(
        actor,
        projectId,
      );

      if (!connected) {
        return data<ProjectDetailActionResult>(
          { error: "invalidInput", ok: false },
          { status: 400 },
        );
      }

      return data<ProjectDetailActionResult>({ ok: true });
    }

    if (intent === "sync-integration") {
      await services.gitHubSyncService.syncProjectNow(actor, projectId);

      return data<ProjectDetailActionResult>({ ok: true });
    }

    if (intent === "disconnect-integration") {
      await services.projectService.disconnectIntegration(actor, projectId);

      return data<ProjectDetailActionResult>({ ok: true });
    }

    return data<ProjectDetailActionResult>(
      { error: "invalidInput", ok: false },
      { status: 400 },
    );
  } catch (error: unknown) {
    return toActionError(error);
  }
}

interface ProjectNameHeadingProps {
  readonly name: string;
  readonly canWrite: boolean;
}

/**
 * Renders the project title with hover and double-click inline editing.
 *
 * @remarks
 * Editing is only offered to writers (administrators, managers, and project
 * managers); everyone else sees plain text. Saving reuses the existing
 * `update-name` action, so the server-side permission check still applies.
 */
function ProjectNameHeading({
  name,
  canWrite,
}: ProjectNameHeadingProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  function handleStartEdit(): void {
    setDraft(name);
    setIsEditing(true);
  }

  function handleCancel(): void {
    setIsEditing(false);
  }

  function handleSave(): void {
    if (draft === name || draft.trim() === "") {
      return;
    }

    const formData = new FormData();
    formData.set("intent", "update-name");
    formData.set("name", draft);
    void submit(formData, { method: "post" });
    setIsEditing(false);
  }

  function handleDraftChange(event: ChangeEvent<HTMLInputElement>): void {
    setDraft(event.currentTarget.value);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      handleSave();
    } else if (event.key === "Escape") {
      handleCancel();
    }
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLSpanElement>): void {
    if (event.key === "Enter") {
      handleStartEdit();
    }
  }

  if (!canWrite) {
    return <span className="select-none">Projekt: {name}</span>;
  }

  if (isEditing) {
    return (
      <span className="inline-flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className="select-none">Projekt:</span>
        <Input
          className="h-10 min-w-36 max-w-sm flex-1 text-xl font-semibold"
          name="name"
          value={draft}
          maxLength={200}
          autoFocus
          onChange={handleDraftChange}
          onKeyDown={handleInputKeyDown}
          aria-label={t("projectDetail.editName")}
        />
        {draft !== name && draft.trim() !== "" ? (
          <Button
            className="h-8 shrink-0 px-3 text-xs"
            type="button"
            onClick={handleSave}
          >
            {t("projects.edit.submit")}
          </Button>
        ) : null}
        <Button
          className="h-8 shrink-0 px-3 text-xs"
          variant="ghost"
          type="button"
          onClick={handleCancel}
        >
          {t("projects.actions.cancel")}
        </Button>
      </span>
    );
  }

  return (
    <span className="group inline-flex select-none items-center gap-2">
      <span
        className="cursor-text outline-none"
        onDoubleClick={handleStartEdit}
        onKeyDown={handleTitleKeyDown}
        tabIndex={0}
      >
        Projekt: {name}
      </span>
      <button
        className="inline-flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground opacity-0 transition-opacity outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100"
        type="button"
        aria-label={t("projectDetail.editName")}
        onClick={handleStartEdit}
      >
        <Pencil className="size-4" aria-hidden="true" />
      </button>
    </span>
  );
}

/** Dot colors for the project statuses selectable in the header. */
const PROJECT_STATUS_DOT: Record<ProjectStatus, string> = {
  planned: "bg-emerald-500",
  active: "bg-blue-500",
  paused: "bg-amber-500",
  completed: "bg-emerald-700",
};

interface ProjectStatusPillProps {
  readonly status: ProjectStatus;
  readonly canWrite: boolean;
}

/** Renders the project status as a pill that writers can change inline. */
function ProjectStatusPill({
  status,
  canWrite,
}: ProjectStatusPillProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const actionData = useActionData<typeof action>();
  const [lastSubmittedStatus, setLastSubmittedStatus] =
    useState<ProjectStatus | null>(null);

  useEffect(() => {
    if (actionData?.ok) {
      setLastSubmittedStatus(null);
    }
  }, [actionData]);

  function handleSelect(nextStatus: ProjectStatus): void {
    setLastSubmittedStatus(nextStatus);

    const formData = new FormData();
    formData.set("intent", "update-status");
    formData.set("status", nextStatus);
    void submit(formData, { method: "post" });
  }

  const showError =
    lastSubmittedStatus !== null && actionData !== undefined && !actionData.ok;

  if (!canWrite) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-muted/60 px-3 py-1 text-xs font-medium text-foreground">
        <span
          className={`size-2 shrink-0 rounded-full ${PROJECT_STATUS_DOT[status]}`}
          aria-hidden="true"
        />
        {t(`projects.status.${status}`)}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-muted/60 px-3 py-1 text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
            type="button"
            aria-label={t("projectDetail.changeStatus")}
          >
            <span
              className={`size-2 shrink-0 rounded-full ${PROJECT_STATUS_DOT[status]}`}
              aria-hidden="true"
            />
            {t(`projects.status.${status}`)}
            <ChevronDown
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {Object.values(PROJECT_STATUS).map((option) => (
            <DropdownMenuItem
              key={option}
              onSelect={() => handleSelect(option)}
            >
              <span
                className={`mr-2 size-2 shrink-0 rounded-full ${PROJECT_STATUS_DOT[option]}`}
                aria-hidden="true"
              />
              {t(`projects.status.${option}`)}
              {option === status ? (
                <Check
                  className="ml-auto size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {showError ? (
        <span className="text-xs text-destructive" role="alert">
          {t("projectDetail.statusError")}
        </span>
      ) : null}
    </span>
  );
}

/** Renders the project detail page with its five configuration tabs. */
export default function ProjectDetailRoute(): React.ReactElement {
  const { t } = useTranslation();
  const loaderData = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab: DetailTab = (DETAIL_TABS as readonly string[]).includes(
    requestedTab ?? "",
  )
    ? (requestedTab as DetailTab)
    : loaderData.activeTab;

  function handleSelectTab(tab: DetailTab): void {
    setSearchParams(tab === "general" ? {} : { tab }, {
      preventScrollReset: true,
    });
  }

  function handleTabValueChange(nextTab: string): void {
    handleSelectTab(nextTab as DetailTab);
  }

  return (
    <section className="mx-auto flex h-[calc(100dvh-8.5rem)] min-h-0 max-w-[92rem] flex-col">
      <div className="shrink-0">
        <Link
          to="/projekte"
          prefetch="intent"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("projectDetail.breadcrumb")} › {loaderData.project.name}
        </Link>

        <div className="mt-4 flex items-start gap-4">
          {loaderData.project.hasIcon ? (
            <img
              className="size-16 shrink-0 rounded-2xl object-cover"
              src={`/projekte/${loaderData.project.id}/icon`}
              alt=""
            />
          ) : (
            <span
              className="inline-flex size-16 shrink-0 select-none items-center justify-center rounded-2xl text-3xl font-semibold text-foreground"
              style={{ backgroundColor: loaderData.project.placeholderColor }}
              aria-hidden="true"
            >
              {loaderData.project.name.trim().charAt(0).toLocaleUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight text-foreground">
              <ProjectNameHeading
                name={loaderData.project.name}
                canWrite={loaderData.canWrite}
              />
              <ProjectStatusPill
                status={loaderData.project.status}
                canWrite={loaderData.canWrite}
              />
            </h1>
            <p className="mt-1 line-clamp-2 max-w-3xl text-sm text-muted-foreground">
              {loaderData.project.description || t("projects.noDescription")}
            </p>
          </div>
        </div>

        <div className="mt-6">
          <Tabs
            value={activeTab}
            onValueChange={handleTabValueChange}
            ariaLabel={loaderData.project.name}
            tabs={DETAIL_TABS.map((tab) => ({
              value: tab,
              label: t(`projectDetail.tabs.${tab}`),
            }))}
          />
        </div>
      </div>

      <VerticalScrollArea
        className="mt-6 min-h-0 flex-1"
        contentClassName="min-w-0 pr-4 pb-2"
      >
        <div role="tabpanel">
          {activeTab === "general" ? (
            <ProjectGeneralTab
              project={loaderData.project}
              members={loaderData.members}
              goals={loaderData.goals}
              tags={loaderData.tags}
              events={loaderData.events}
              milestones={loaderData.milestones}
              workItems={loaderData.workItems}
              canWrite={loaderData.canWrite}
            />
          ) : null}
          {activeTab === "team" ? (
            <ProjectTeamTab
              members={loaderData.members}
              eligibleUsers={loaderData.eligibleUsers}
              canWrite={loaderData.canWrite}
            />
          ) : null}
          {activeTab === "planning" ? (
            <ProjectPlanningTab
              milestones={loaderData.milestones}
              events={loaderData.events}
              workItems={loaderData.workItems}
              canWrite={loaderData.canWrite}
            />
          ) : null}
          {activeTab === "integrations" ? (
            <ProjectIntegrationsTab
              integration={loaderData.integration}
              canWrite={loaderData.canWrite}
            />
          ) : null}
          {activeTab === "activity" ? (
            <ProjectActivityTab
              activity={loaderData.activity}
              taskHistory={loaderData.taskHistory}
            />
          ) : null}
        </div>
      </VerticalScrollArea>
    </section>
  );
}
