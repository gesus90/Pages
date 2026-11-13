import { randomUUID } from "node:crypto";

import { z } from "zod";

import { accountForChannel } from "@/backend/auth/McpActorContext";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AdministrationError } from "@/backend/error/AdministrationError";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import {
  EmailTakenError,
  UsernameTakenError,
} from "@/backend/error/UserErrors";
import {
  OperationReusedError,
  recordInterfaceOperation,
  replayInterfaceOperation,
} from "@/backend/service/InterfaceOperationJournal";
import { MANAGEMENT_READ_OPERATIONS } from "@/definition/Management";

import { ManagementAudit } from "./ManagementAudit";
import { ManagementCatalog } from "./ManagementCatalog";
import { ManagementUserRead } from "./ManagementUserRead";
import { ManagementUserWrite } from "./ManagementUserWrite";
import { managementAvatar } from "./ManagementAvatar";

import type { ActorChannel } from "@/backend/auth/McpActorContext";
import type {
  ManagementContext,
  ManagementDependencies,
} from "./ManagementContext";
import type {
  ManagementOperation,
  ManagementResult,
} from "@/definition/Management";

const receiptSchema = z.union([
  z.object({
    id: z.string(),
    revision: z.string().optional(),
    status: z.enum(["active", "deactivated"]).optional(),
    avatarUrl: z.string().optional(),
  }),
  z.object({ projectId: z.string(), revision: z.string() }),
]);

function parameters(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentOperationError("INVALID_REQUEST", { reason: "validation" });
  return Object.fromEntries(Object.entries(input));
}
function identifier(input: unknown): string {
  if (typeof input !== "string" || !input.trim() || input.length > 200)
    throw new AgentOperationError("INVALID_REQUEST", { reason: "identifier" });
  return input;
}
function administrationFailure(
  error: AdministrationError,
): AgentOperationError {
  if (error.code === "notFound") return new AgentOperationError("NOT_FOUND");
  if (error.code === "forbidden")
    return new AgentOperationError("FORBIDDEN", { reason: "role_grant" });
  return new AgentOperationError("INVALID_REQUEST", { reason: error.code });
}
function employeeFailure(error: AgentEmployeeError): AgentOperationError {
  switch (error.code) {
    case "notFound":
      return new AgentOperationError("NOT_FOUND");
    case "forbidden":
      return new AgentOperationError("FORBIDDEN", { reason: "role_grant" });
    case "accessAdminRequired":
      return new AgentOperationError("FORBIDDEN", { reason: "access_level" });
    case "conflict":
      return new AgentOperationError("CONFLICT");
    default:
      return new AgentOperationError("INVALID_REQUEST", { reason: error.code });
  }
}
function translate(error: unknown): unknown {
  if (error instanceof AdministrationError) return administrationFailure(error);
  if (error instanceof AgentEmployeeError) return employeeFailure(error);
  if (error instanceof OperationReusedError)
    return new AgentOperationError("CONFLICT");
  if (error instanceof UsernameTakenError || error instanceof EmailTakenError)
    return new AgentOperationError("INVALID_REQUEST", {
      reason: "identity_taken",
    });
  return error;
}

/** One business contract used by browser actions, HTTP routes and pages-pica tools. */
export class ManagementService {
  public readonly audit: ManagementAudit;
  private readonly dependencies: ManagementDependencies;
  /** Email, image, model and database boundaries remain replaceable in focused tests. */
  public constructor(dependencies: ManagementDependencies) {
    this.dependencies = dependencies;
    this.audit = new ManagementAudit(dependencies.database);
  }

  /** Executes a guarded call, serializing revision checks, effects and the idempotency receipt together. */
  public async call(
    actorId: string,
    operation: ManagementOperation,
    input: unknown,
    channel: ActorChannel = "mcp",
  ): Promise<ManagementResult> {
    const request = parameters(input);
    try {
      return await this.audit.run(
        actorId,
        operation,
        String(
          request.userId ?? request.groupId ?? request.projectId ?? "directory",
        ),
        () =>
          this.dependencies.database.runCall(
            async () => {
              const context = await this.context(actorId, channel);
              if (MANAGEMENT_READ_OPERATIONS.some((read) => read === operation))
                return this.dispatch(context, operation, request);
              if (typeof request.userId === "string")
                await new ManagementUserWrite(context).changeable(
                  request.userId,
                  typeof request.role === "string" ? request.role : undefined,
                );
              const operationId = request.operationId ?? randomUUID();
              if (
                typeof operationId !== "string" ||
                !z.uuid().safeParse(operationId).success
              )
                throw new AgentOperationError("INVALID_REQUEST", {
                  reason: "operationId",
                });
              const journal = {
                userId: actorId,
                operation: `management.${operation}`,
                operationId,
                request,
              };
              const keys = new AgentOperationKeyRepository(context.database);
              const stored = await replayInterfaceOperation(
                keys,
                journal,
                receiptSchema,
              );
              if (stored !== null) return stored;
              const result = await this.dispatch(context, operation, request);
              await recordInterfaceOperation(
                keys,
                journal,
                receiptSchema.parse(result),
              );
              return result;
            },
            async () => {
              this.invalidate();
            },
          ),
      );
    } catch (error: unknown) {
      throw translate(error);
    }
  }

  /** Reads the revision which project membership and department replacement require. */
  public async projectRevision(
    actorId: string,
    projectId: string,
    channel: ActorChannel = "mcp",
  ): Promise<string> {
    return new ManagementCatalog(
      await this.context(actorId, channel),
    ).projectRevision(projectId);
  }

  /** Reads the revision and prose which a group patch requires. */
  public async group(
    actorId: string,
    groupId: string,
  ): ReturnType<ManagementCatalog["group"]> {
    return new ManagementCatalog(await this.context(actorId, "mcp")).group(
      groupId,
    );
  }

  private async context(
    actorId: string,
    channel: ActorChannel,
  ): Promise<ManagementContext> {
    const authorization = new AuthorizationRepository(
      this.dependencies.database,
    );
    const account = (await authorization.snapshot()).accounts.find(
      (entry) => entry.userId === actorId,
    );
    if (!account)
      throw new AgentOperationError("FORBIDDEN", { reason: "core_system" });
    const actor = accountForChannel(account, channel);
    if (!new UserPolicyService().hasGlobalAccess(actor))
      throw new AgentOperationError("FORBIDDEN", { reason: "core_system" });
    return {
      ...this.dependencies,
      authorization,
      actor,
      channel,
      agents: this.dependencies.agents.forChannel(channel),
    };
  }

  private async dispatch(
    context: ManagementContext,
    operation: ManagementOperation,
    request: Record<string, unknown>,
  ): Promise<ManagementResult> {
    const { userId, groupId, projectId, ...body } = request;
    const users = new ManagementUserWrite(context);
    const catalog = new ManagementCatalog(context);
    switch (operation) {
      case "groups_read":
        return catalog.group(identifier(groupId));
      case "users_list":
        return new ManagementUserRead(context).list(request);
      case "users_read":
        return new ManagementUserRead(context).user(identifier(userId));
      case "users_create":
        return users.create(body);
      case "users_update":
        return users.update(identifier(userId), body);
      case "users_set_status":
        return users.status(identifier(userId), body);
      case "users_set_avatar":
        return managementAvatar(context, identifier(userId), body);
      case "groups_create":
        return catalog.createGroup(body);
      case "groups_update":
        return catalog.updateGroup(identifier(groupId), body);
      case "project_members_set":
        return catalog.members(identifier(projectId), body);
      case "projects_set_departments":
        return catalog.departments(identifier(projectId), body);
    }
  }

  private invalidate(): void {
    const { cache } = this.dependencies;
    cache.invalidateUsers();
    cache.invalidateProjectMembership();
    cache.invalidateProjectsList();
    cache.invalidatePrefix("project:");
    cache.invalidateWorkItems();
  }
}
