import { readPersonColor } from "@/definition/PersonColor";
import { AdministrationService } from "@/backend/service/AdministrationService";
import { GroupAdministrationService } from "@/backend/service/GroupAdministrationService";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { readAgentEmployeeInput } from "@/backend/service/employee/AgentEmployeeInput";

import {
  requireManagementRole,
  requireManagementTarget,
} from "./ManagementPolicy";
import { ManagementUserRead } from "./ManagementUserRead";
import { requireManagementRevision } from "./ManagementRevision";
import {
  managementCreateSchema,
  managementUpdateSchema,
  managementStatusSchema,
  parseManagement,
} from "./ManagementRequest";

import type { ManagementContext } from "./ManagementContext";
import type { ManagementCreate, ManagementUpdate } from "./ManagementRequest";
import type { AgentEmployeeInput } from "@/backend/service/employee/AgentEmployeeInput";
import type { ManagementUser, ManagementResult } from "@/definition/Management";

/** Shared account writes, using the same policy and agent model checks as the UI. */
export class ManagementUserWrite {
  private readonly context: ManagementContext;
  private readonly administration: AdministrationService;
  private readonly reads: ManagementUserRead;
  /** Binds every nested service to the call transaction and its server-owned channel. */
  public constructor(context: ManagementContext) {
    this.context = context;
    this.administration = new AdministrationService(
      context.authorization,
      context.cache,
      context.hasher,
      context.channel,
    );
    this.reads = new ManagementUserRead(context);
  }

  /** Creates an agent or an invited person; credentials go exclusively to the email boundary. */
  public async create(input: unknown): Promise<ManagementResult> {
    const request = parseManagement(managementCreateSchema, input);
    requireManagementRole(this.context.actor, request.role);
    let id: string;
    if (request.kind === "agent") {
      id = await this.context.agents.create(
        this.context.actor.userId,
        this.agentInput(request),
        null,
      );
      if (request.email !== undefined)
        await this.context.authorization.users().updateProfile(id, {
          username: request.username,
          displayName: request.displayName,
          email: request.email,
        });
    } else {
      await this.administration.createUser(
        this.context.actor.userId,
        {
          username: request.username,
          firstName: request.displayName,
          lastName: "",
          email: request.email ?? null,
          roleId: request.role,
          isAdmin: false,
          departments: request.departmentIds,
        },
        this.context.invitations,
      );
      const created = (await this.context.authorization.users().findAll()).find(
        (user) => user.username === request.username,
      );
      if (!created) throw new Error("Created account is missing");
      id = created.id;
    }
    await this.groups(id, request.groupIds);
    return { id, revision: (await this.reads.user(id)).revision };
  }

  /** Applies a partial patch at exactly the complete revision read last. */
  public async update(
    userId: string,
    input: unknown,
  ): Promise<ManagementResult> {
    const request = parseManagement(managementUpdateSchema, input);
    const current = await this.changeable(userId, request.role);
    requireManagementRevision(current.revision, request.expectedRevision);
    if (current.kind === "agent") await this.updateAgent(current, request);
    else await this.updateHuman(current, request);
    if (request.groupIds) await this.groups(userId, request.groupIds);
    return { id: userId, revision: (await this.reads.user(userId)).revision };
  }

  /** Activation never deletes accounts or issues authentication material. */
  public async status(
    userId: string,
    input: unknown,
  ): Promise<ManagementResult> {
    const request = parseManagement(managementStatusSchema, input);
    const current = await this.changeable(userId);
    requireManagementRevision(current.revision, request.expectedRevision);
    if (current.kind === "agent") {
      const detail = await this.context.agents.detail(
        this.context.actor.userId,
        userId,
      );
      await this.context.agents.setActive(this.context.actor.userId, userId, {
        isActive: request.status === "active",
        revision: detail.agent.revision,
      });
    } else
      await this.administration.setActive(
        this.context.actor.userId,
        userId,
        request.status === "active",
      );
    return {
      id: userId,
      revision: (await this.reads.user(userId)).revision,
      status: request.status,
    };
  }

  /** Resolves protected account checks before a change or an avatar upload. */
  public async changeable(
    userId: string,
    role?: string,
  ): Promise<ManagementUser> {
    const snapshot = await this.context.authorization.snapshot();
    const target = snapshot.accounts.find(
      (account) => account.userId === userId,
    );
    if (!target) throw new AgentOperationError("NOT_FOUND");
    requireManagementTarget(this.context.actor, target, role);
    if (role) requireManagementRole(this.context.actor, role);
    return this.reads.user(userId);
  }

  private async updateHuman(
    current: ManagementUser,
    request: ManagementUpdate,
  ): Promise<void> {
    if (request.agent)
      throw new AgentOperationError("INVALID_REQUEST", { reason: "kind" });
    await this.administration.updateProfile(
      this.context.actor.userId,
      current.id,
      {
        username: current.username,
        firstName: request.displayName ?? current.displayName,
        lastName: "",
        email: request.email === undefined ? current.email : request.email,
      },
    );
    if (request.role && request.role !== current.role)
      await this.administration.assignRole(
        this.context.actor.userId,
        current.id,
        request.role,
      );
    if (request.departmentIds)
      await this.administration.setMemberships(
        this.context.actor.userId,
        current.id,
        request.departmentIds,
      );
  }

  private async updateAgent(
    current: ManagementUser,
    request: ManagementUpdate,
  ): Promise<void> {
    const detail = (
      await this.context.agents.detail(this.context.actor.userId, current.id)
    ).agent;
    const agent = request.agent ?? current.agent;
    if (!agent)
      throw new AgentOperationError("INVALID_REQUEST", { reason: "agent" });
    const changed = readAgentEmployeeInput({
      displayName: request.displayName ?? current.displayName,
      username: current.username,
      roleId: request.role ?? current.role ?? "",
      departments:
        request.departmentIds ??
        current.departments.map((department) => department.id),
      position: detail.position,
      avatarColor: readPersonColor(detail.avatarColor),
      connectionId: agent.connectionId,
      model: agent.model,
      reasoningEffort: agent.reasoningEffort,
      access: detail.settings.access,
      instructions: agent.agentMd,
      soul: agent.soulMd,
      memory: null,
      dream: null,
      memoryCharacters: detail.memoryLimits.memoryCharacters,
      dreamCharacters: detail.memoryLimits.dreamCharacters,
      isLearningEnabled: detail.learning.isEnabled,
      voiceId: detail.voice.voiceId,
      voiceSpeedTenths: detail.voice.speedTenths,
    });
    await this.context.agents.update(
      this.context.actor.userId,
      current.id,
      { input: changed, revision: detail.revision },
      null,
    );
    if (request.email !== undefined)
      await this.context.authorization.users().updateProfile(current.id, {
        username: current.username,
        displayName: changed.displayName,
        email: request.email,
      });
  }

  private agentInput(request: ManagementCreate): AgentEmployeeInput {
    const agent = request.agent;
    if (!agent)
      throw new AgentOperationError("INVALID_REQUEST", { reason: "agent" });
    return readAgentEmployeeInput({
      displayName: request.displayName,
      username: request.username,
      roleId: request.role,
      departments: request.departmentIds,
      connectionId: agent.connectionId,
      model: agent.model,
      reasoningEffort: agent.reasoningEffort,
      instructions: agent.agentMd,
      soul: agent.soulMd,
      access: "read_only",
      isLearningEnabled: false,
    });
  }

  private async groups(
    userId: string,
    groupIds: readonly string[],
  ): Promise<void> {
    const { authorization, actor, cache, channel } = this.context;
    const groups = await authorization.groups().findAll();
    if (groupIds.some((id) => !groups.some((group) => group.id === id)))
      throw new AgentOperationError("NOT_FOUND");
    const service = new GroupAdministrationService(
      authorization,
      cache,
      channel,
    );
    for (const group of groups) {
      const included = group.memberIds.includes(userId);
      if (included === groupIds.includes(group.id)) continue;
      await service.saveGroup(actor.userId, {
        ...group,
        memberIds: included
          ? group.memberIds.filter((id) => id !== userId)
          : [...group.memberIds, userId],
        leaderIds: included
          ? group.leaderIds?.filter((id) => id !== userId)
          : group.leaderIds,
      });
    }
  }
}
