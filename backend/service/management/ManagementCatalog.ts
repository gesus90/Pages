import { randomUUID } from "node:crypto";

import { ProjectPolicyService } from "@/backend/auth/ProjectPolicyService";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { ManagementRepository } from "@/backend/database/repositories/ManagementRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { GroupAdministrationService } from "@/backend/service/GroupAdministrationService";

import { requireManagementMembershipChange } from "./ManagementMembershipPolicy";
import {
  managementRevision,
  requireManagementRevision,
} from "./ManagementRevision";
import {
  managementGroupCreateSchema,
  managementGroupUpdateSchema,
  managementMembersSchema,
  managementDepartmentsSchema,
  parseManagement,
} from "./ManagementRequest";

import type { ManagementContext } from "./ManagementContext";
import type { ManagementResult } from "@/definition/Management";
import type { UserGroup } from "@/definition/UserGroup";

/** Group and project assignments share the same current authorization and transaction as users. */
export class ManagementCatalog {
  private readonly context: ManagementContext;
  /** Binds catalog changes to the aggregate of the caller. */
  public constructor(context: ManagementContext) {
    this.context = context;
  }

  /** Returns a group's complete editable state and revision. */
  public async group(
    groupId: string,
  ): Promise<
    UserGroup & { readonly description: string; readonly revision: string }
  > {
    const group = (await this.context.authorization.groups().findAll()).find(
      (entry) => entry.id === groupId,
    );
    if (!group) throw new AgentOperationError("NOT_FOUND");
    const state = {
      ...group,
      description: await new ManagementRepository(
        this.context.database,
      ).description(groupId),
    };
    return { ...state, revision: managementRevision(state) };
  }

  /** Creates a named group with its members, leaders and descriptive text. */
  public async createGroup(input: unknown): Promise<ManagementResult> {
    const request = parseManagement(managementGroupCreateSchema, input);
    const id = randomUUID();
    await this.saveGroup(
      {
        id,
        name: request.name,
        memberIds: request.memberIds,
        leaderIds: request.leaderIds,
      },
      request.description,
    );
    return { id, revision: (await this.group(id)).revision };
  }

  /** Patches only the supplied group fields at the revision read last. */
  public async updateGroup(
    groupId: string,
    input: unknown,
  ): Promise<ManagementResult> {
    const request = parseManagement(managementGroupUpdateSchema, input);
    const current = await this.group(groupId);
    requireManagementRevision(current.revision, request.expectedRevision);
    await this.saveGroup(
      {
        id: groupId,
        name: request.name ?? current.name,
        memberIds: request.memberIds ?? current.memberIds,
        leaderIds: request.leaderIds ?? current.leaderIds,
      },
      request.description ?? current.description,
    );
    return { id: groupId, revision: (await this.group(groupId)).revision };
  }

  /** Complete project revision covers project fields, memberships and departments. */
  public async projectRevision(projectId: string): Promise<string> {
    const repository = new ProjectRepository(this.context.database);
    const project = await repository.findById(projectId);
    if (!project) throw new AgentOperationError("NOT_FOUND");
    return managementRevision({
      project,
      members: await repository.findMembers(projectId),
    });
  }

  /** Replaces project members using the contract's public role names. */
  public async members(
    projectId: string,
    input: unknown,
  ): Promise<ManagementResult> {
    const request = parseManagement(managementMembersSchema, input);
    const repository = await this.project(projectId);
    requireManagementRevision(
      await this.projectRevision(projectId),
      request.expectedRevision,
    );
    const snapshot = await this.context.authorization.snapshot();
    for (const member of request.members) {
      const target = snapshot.accounts.find(
        (account) => account.userId === member.userId,
      );
      if (!target?.isActive) throw new AgentOperationError("NOT_FOUND");
    }
    const current = await repository.findMembers(projectId);
    for (const account of snapshot.accounts) {
      const before = current.find(
        (member) => member.userId === account.userId,
      )?.projectRole;
      const desired = request.members.find(
        (member) => member.userId === account.userId,
      )?.role;
      const after = desired === "projectmanager" ? "manager" : desired;
      if (before !== after)
        requireManagementMembershipChange(this.context.actor, account);
    }
    for (const member of current)
      if (!request.members.some((entry) => entry.userId === member.userId))
        await repository.removeMember(projectId, member.userId);
    for (const member of request.members) {
      const role = member.role === "projectmanager" ? "manager" : member.role;
      if (current.some((entry) => entry.userId === member.userId))
        await repository.updateMemberRole(projectId, member.userId, role);
      else
        await repository.addMember(
          projectId,
          member.userId,
          role,
          new Date().toISOString(),
        );
    }
    return { projectId, revision: await this.projectRevision(projectId) };
  }

  /** Replaces project departments, enforcing the minimum selection of the live catalog. */
  public async departments(
    projectId: string,
    input: unknown,
  ): Promise<ManagementResult> {
    const request = parseManagement(managementDepartmentsSchema, input);
    const repository = await this.project(projectId);
    requireManagementRevision(
      await this.projectRevision(projectId),
      request.expectedRevision,
    );
    const snapshot = await this.context.authorization.snapshot();
    if (snapshot.departments.length > 0 && request.departmentIds.length === 0)
      throw new AgentOperationError("INVALID_REQUEST", {
        reason: "department_required",
      });
    if (
      request.departmentIds.some(
        (id) =>
          !snapshot.departments.some((department) => department.id === id),
      )
    )
      throw new AgentOperationError("NOT_FOUND");
    await repository.setDepartments(projectId, request.departmentIds);
    return { projectId, revision: await this.projectRevision(projectId) };
  }

  private async saveGroup(
    group: UserGroup,
    description: string,
  ): Promise<void> {
    const { authorization, cache, channel, actor, database } = this.context;
    await new GroupAdministrationService(
      authorization,
      cache,
      channel,
    ).saveGroup(actor.userId, group, { allowEmpty: true });
    await new ManagementRepository(database).setDescription(
      group.id,
      description,
    );
  }

  private async project(projectId: string): Promise<ProjectRepository> {
    const repository = new ProjectRepository(this.context.database);
    const project = await repository.findById(projectId);
    if (!project) throw new AgentOperationError("NOT_FOUND");
    if (
      !new ProjectPolicyService().canEditGeneral(this.context.actor, {
        departmentIds: project.departments.map((department) => department.id),
        isProjectManager: await repository.isProjectManager(
          projectId,
          this.context.actor.userId,
        ),
      })
    )
      throw new AgentOperationError("FORBIDDEN", { reason: "core_system" });
    return repository;
  }
}
