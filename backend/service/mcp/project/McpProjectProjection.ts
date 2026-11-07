import type {
  ProjectEvent,
  ProjectGoal,
  ProjectIntegration,
  ProjectMember,
} from "@/definition/Project";
import type {
  McpProject,
  McpProjectEvent,
  McpProjectGitHub,
  McpProjectGoal,
  McpProjectMember,
} from "./McpProjectContract";
import type { McpProjectContext, McpProjectState } from "./McpProjectContext";

function memberOf(member: ProjectMember): McpProjectMember {
  return {
    username: member.username,
    displayName: member.displayName,
    role: member.projectRole,
  };
}

function goalOf(goal: ProjectGoal): McpProjectGoal {
  return { id: goal.id, title: goal.title, isDone: goal.isDone };
}

function eventOf(event: ProjectEvent): McpProjectEvent {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    date: event.eventDate,
    time: event.eventTime,
    type: event.type,
  };
}

/** Names only the settings; the stored token stays behind `hasToken`. */
function gitHubOf(
  integration: ProjectIntegration | null,
): McpProjectGitHub | null {
  if (integration === null) return null;
  return {
    repoUrl: integration.repoUrl,
    hasToken: integration.hasToken,
    syncIssues: integration.syncIssues,
    syncStatus: integration.syncStatus,
    syncComments: integration.syncComments,
    syncPullRequests: integration.syncPullRequests,
    syncCommits: integration.syncCommits,
    syncDirection: integration.syncDirection,
    syncIntervalMinutes: integration.syncIntervalMinutes,
    syncEnabled: integration.syncEnabled,
    isConnected: integration.isConnected,
    lastSyncAt: integration.lastSyncAt,
  };
}

/**
 * Builds the answer object "Projekt" from a project and its contents.
 *
 * @param context - The request, for the name of the project manager.
 * @param state - The project as the project services returned it.
 */
export async function projectOf(
  context: McpProjectContext,
  state: McpProjectState,
): Promise<McpProject> {
  const { project } = state;
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    archived: state.isArchived,
    startDate: project.startDate,
    targetDate: project.targetDate,
    notes: project.notes,
    manager: await context.person(project.managerId),
    departments: project.departments.map((department) => ({
      id: department.id,
      name: department.name,
    })),
    tags: [...state.tags],
    members: state.members.map(memberOf),
    goals: state.goals.map(goalOf),
    events: state.events.map(eventOf),
    hasIcon: project.hasIcon,
    github: gitHubOf(state.integration),
  };
}

/**
 * Reads a project again and builds its answer object, as every change answers.
 *
 * @param context - The request.
 * @param projectId - The project.
 */
export async function currentProject(
  context: McpProjectContext,
  projectId: string,
): Promise<McpProject> {
  return projectOf(context, await context.state(projectId));
}
