import { randomUUID } from "node:crypto";

import { agentChannelPolicy } from "@/backend/auth/McpActorContext";
import { ServerCache } from "@/backend/cache/ServerCache";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { ProjectCreationService } from "@/backend/service/project/ProjectCreationService";
import { ProjectManagementService } from "@/backend/service/project/ProjectManagementService";
import { normalizeDate } from "@/backend/service/wiki/WikiValidation";
import { isProjectRole, isProjectStatus } from "@/definition/Project";

import { readAgentDirectory } from "./AgentDirectoryService";
import { readIdentifier } from "./AgentParameterReader";

import type {
  AgentExtensionChanged,
  AgentExtensionWriteOperation,
} from "@/definition/AgentExtensions";
import type { ProjectDetailsUpdate } from "@/backend/database/repositories/ProjectRepository";
import type { ProjectRole } from "@/definition/Project";
import type { AgentTaskContext } from "./AgentTaskAccess";

function text(input: unknown, maximum: number): string {
  if (typeof input !== "string" || input.length > maximum)
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}

function projectName(input: unknown): string {
  const name = text(input, 200).trim();
  if (!name) throw new AgentOperationError("INVALID_REQUEST");
  return name;
}

function identifiers(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 100)
    throw new AgentOperationError("INVALID_REQUEST");
  return input.map(readIdentifier);
}

function date(input: unknown): string | null {
  if (input === null) return null;
  return normalizeDate(text(input, 10));
}

/** Validates the target kind, and returns the role to give; a removal gives none. */
function readMemberRole(
  parameters: Readonly<Record<string, unknown>>,
  isRemoved: boolean,
): ProjectRole | null {
  if (
    parameters.targetType !== "person" &&
    parameters.targetType !== "group" &&
    parameters.targetType !== "department"
  )
    throw new AgentOperationError("INVALID_REQUEST");
  if (isRemoved) return null;
  if (!isProjectRole(parameters.role))
    throw new AgentOperationError("INVALID_REQUEST");
  return parameters.role;
}

/** Applies basic project mutations through the existing UI business services. */
export async function applyAgentProject(
  context: AgentTaskContext,
  operation: AgentExtensionWriteOperation,
  parameters: Readonly<Record<string, unknown>>,
): Promise<AgentExtensionChanged> {
  const policy = agentChannelPolicy(context.channel);
  const repository = new ProjectRepository(context.database, policy.source);
  if (operation === "projects.create") {
    if (!isProjectStatus(parameters.status))
      throw new AgentOperationError("INVALID_REQUEST");
    const id = randomUUID();
    await new ProjectCreationService(
      repository,
      ServerCache.disabled(),
      policy.actor,
    ).create(context.actor, {
      id,
      name: projectName(parameters.name),
      description: text(parameters.description, 10_000),
      status: parameters.status,
      ownerId: context.actor.id,
      placeholderColor: "#FCE3D3",
      departmentIds: identifiers(parameters.departmentIds),
    });
    await repository.insertActivity({
      id: randomUUID(),
      projectId: id,
      userId: context.actor.id,
      category: "project",
      action: "project_created",
      message: "Project created.",
    });
    return { id, projectId: id, changed: true };
  }
  const id = readIdentifier(parameters.projectId);
  const project = await context.projects.getById(context.actor, id);
  if (
    operation === "projects.member.assign" ||
    operation === "projects.member.remove"
  )
    return assignProject(context, operation, parameters);
  const update: ProjectDetailsUpdate = {
    name: project.name,
    description: project.description,
    status: project.status,
    progress: project.progress,
    managerId: project.managerId,
    startDate: project.startDate,
    targetDate: project.targetDate,
    notes: project.notes,
  };
  const next = projectChange(update, operation, parameters);
  await new ProjectManagementService(
    repository,
    ServerCache.disabled(),
    policy.actor,
  ).updateDetails(context.actor, id, next);
  return {
    id,
    projectId: id,
    changed: JSON.stringify(update) !== JSON.stringify(next),
  };
}

function projectChange(
  current: ProjectDetailsUpdate,
  operation: AgentExtensionWriteOperation,
  parameters: Readonly<Record<string, unknown>>,
): ProjectDetailsUpdate {
  if (operation === "projects.setName")
    return { ...current, name: projectName(parameters.name) };
  if (operation === "projects.setDescription")
    return { ...current, description: text(parameters.description, 10_000) };
  if (operation === "projects.setStatus") {
    if (!isProjectStatus(parameters.status))
      throw new AgentOperationError("INVALID_REQUEST");
    return { ...current, status: parameters.status };
  }
  if (operation !== "projects.setDates")
    throw new AgentOperationError("INVALID_REQUEST");
  const startDate = date(parameters.startDate);
  const targetDate = date(parameters.targetDate);
  if (startDate !== null && targetDate !== null && startDate > targetDate)
    throw new AgentOperationError("INVALID_REQUEST");
  return { ...current, startDate, targetDate };
}

async function assignProject(
  context: AgentTaskContext,
  operation: "projects.member.assign" | "projects.member.remove",
  parameters: Readonly<Record<string, unknown>>,
): Promise<AgentExtensionChanged> {
  const projectId = readIdentifier(parameters.projectId);
  const targetId = readIdentifier(parameters.targetId);
  const directory = await readAgentDirectory(context);
  const project = await context.projects.getById(context.actor, projectId);
  const isRemoved = operation === "projects.member.remove";
  const role = readMemberRole(parameters, isRemoved);
  if (parameters.targetType === "department") {
    if (!directory.departments.some(({ id }) => id === targetId))
      throw new AgentOperationError("NOT_FOUND");
    const next = new Set(project.departments.map(({ id }) => id));
    if (isRemoved) next.delete(targetId);
    else next.add(targetId);
    const policy = agentChannelPolicy(context.channel);
    const repository = new ProjectRepository(context.database, policy.source);
    await new ProjectManagementService(
      repository,
      ServerCache.disabled(),
      policy.actor,
    ).setDepartments(context.actor, projectId, [...next]);
    await repository.insertActivity({
      id: randomUUID(),
      userId: context.actor.id,
      projectId,
      category: "team",
      action: "department_assignment_changed",
      message: "Project department assignment changed.",
    });
    return { id: projectId, projectId, changed: true };
  }
  const targets =
    parameters.targetType === "person"
      ? directory.people.filter(({ id }) => id === targetId).map(({ id }) => id)
      : directory.groups.find(({ id }) => id === targetId)?.memberIds;
  if (!targets?.length) throw new AgentOperationError("NOT_FOUND");
  const eligible = new Set(
    (await context.tasks.findEligibleAssignees(context.actor, projectId)).map(
      ({ id }) => id,
    ),
  );
  if (!isRemoved && targets.some((id) => !eligible.has(id)))
    throw new AgentOperationError("FORBIDDEN");
  for (const userId of targets) {
    if (role === null)
      await context.projects.removeMember(context.actor, projectId, userId);
    else
      await context.projects.addMember(context.actor, projectId, userId, role);
  }
  return {
    id: projectId,
    projectId,
    changed: true,
    affectedCount: targets.length,
  };
}
