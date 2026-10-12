import { createHash } from "node:crypto";

import { agentChannelPolicy } from "@/backend/auth/McpActorContext";
import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AdministrationActivityRepository } from "@/backend/database/repositories/AdministrationActivityRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AdministrationError } from "@/backend/error/AdministrationError";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import {
  EmailTakenError,
  UsernameTakenError,
} from "@/backend/error/UserErrors";
import { AdministrationService } from "@/backend/service/AdministrationService";
import { GroupAdministrationService } from "@/backend/service/GroupAdministrationService";
import {
  AGENT_ADMIN_READ_OPERATIONS,
  AGENT_ADMIN_WRITE_OPERATIONS,
  CHAT_ADMIN_WRITE_OPERATIONS,
  isChatOnlyAdminWriteOperation,
} from "@/definition/AgentAdministration";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import { activeAccount } from "../AdministrationAccess";
import {
  readAdminChanged,
  readAdminParameters,
} from "./AgentAdministrationParameters";
import { readAgentAdministration } from "./AgentAdministrationReads";
import {
  assignAdminRole,
  setAdminRolePermissions,
  setAdminScope,
} from "./AgentAdministrationRights";
import {
  renameAdminDepartment,
  setAdminDepartments,
  setAdminUserName,
  updateAdminGroup,
} from "./AgentAdministrationMemberships";
import { requireAgentConfirmation } from "./AgentConfirmation";
import { readIdentifier } from "./AgentParameterReader";
import { agentTransactionScope } from "./AgentTransactionScope";
import { translateAgentTicketError } from "./AgentTicketErrors";
import { applyChatAdministration } from "./ChatAdministrationWrites";

import type { AgentChannel } from "@/backend/auth/McpActorContext";
import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type {
  AgentAdminReadOperation,
  AgentAdminWriteOperation,
  AgentAdminWriteResponse,
} from "@/definition/AgentAdministration";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { AgentAdministrationContext } from "./AgentAdministrationContext";
import type { ChatAdminMutation } from "./ChatAdministrationWrites";

/** Runs administrator operations with fresh authorization, UI services and atomic audit/replay records. */
export class AgentAdministrationService {
  private readonly database: Database;
  private readonly cache: ServerCache;
  private readonly channel: AgentChannel;

  public constructor(
    database: Database,
    cache: ServerCache,
    channel: AgentChannel = "mcp",
  ) {
    this.database = database;
    this.cache = cache;
    this.channel = channel;
  }

  /** Handles only this channel's catalog; client parameters can neither choose the channel nor supply admin facts. */
  public async handle(
    identity: AgentIdentity,
    operation: unknown,
    input: unknown,
  ): Promise<PagesAgentReadResponse | AgentAdminWriteResponse | null> {
    const read = AGENT_ADMIN_READ_OPERATIONS.find(
      (candidate) => candidate === operation,
    );
    const write = [
      ...AGENT_ADMIN_WRITE_OPERATIONS,
      ...(this.channel === "chat" ? CHAT_ADMIN_WRITE_OPERATIONS : []),
    ].find((candidate) => candidate === operation);
    const readCommand = read && { kind: "read" as const, operation: read };
    const command =
      readCommand ?? (write && { kind: "write" as const, operation: write });
    if (!command) return null;
    try {
      const response = await this.database.transaction(async (transaction) => {
        const context = await this.context(transaction, identity.userId);
        const parameters = readAdminParameters(command.operation, input);
        if (command.kind === "read")
          return this.read(context, command.operation, parameters);
        return this.write(context, command.operation, parameters);
      });
      if (write && "changed" in response.result && response.result.changed) {
        this.cache.invalidateProjectMembership();
        this.cache.invalidateUsers();
        this.cache.invalidateWorkItems();
        this.cache.invalidateLabels();
        this.cache.invalidateGitHub();
      }
      return response;
    } catch (error: unknown) {
      throw translateAdminError(error);
    }
  }

  private async context(
    database: DatabaseTransaction,
    userId: string,
  ): Promise<AgentAdministrationContext> {
    const repository = new AuthorizationRepository(
      agentTransactionScope(database),
    );
    const actor = await repository.users().findById(userId);
    if (!actor?.isActive || actor.mustChangePassword)
      throw new McpAuthorizationError("invalid_token", 401);
    const snapshot = await repository.snapshot();
    const account = activeAccount(snapshot, userId);
    const policy = agentChannelPolicy(this.channel);
    if (!new UserPolicyService(policy.actor).isAdministrator(account))
      throw new AgentOperationError("FORBIDDEN");
    const cache = ServerCache.disabled();
    return {
      database,
      repository,
      actor,
      snapshot,
      channel: this.channel,
      administration: new AdministrationService(
        repository,
        cache,
        new PasswordHasher(),
        policy.actor,
      ),
      groups: new GroupAdministrationService(repository, cache, policy.actor),
    };
  }

  private async read(
    context: AgentAdministrationContext,
    operation: AgentAdminReadOperation,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<PagesAgentReadResponse> {
    const response: PagesAgentReadResponse = {
      apiVersion: "1",
      result: await readAgentAdministration(context, operation, parameters),
    };
    if (
      Buffer.byteLength(JSON.stringify(response)) >
      PAGES_AGENT_LIMITS.responseBytes
    )
      throw new AgentOperationError("PAYLOAD_TOO_LARGE");
    return response;
  }

  private async write(
    context: AgentAdministrationContext,
    operation: AgentAdminWriteOperation,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<AgentAdminWriteResponse> {
    const operationId = readIdentifier(parameters.operationId);
    if (parameters.confirmation !== undefined)
      await requireAgentConfirmation(
        context.database,
        context.actor.id,
        parameters.confirmation,
      );
    const keys = new AgentOperationKeyRepository(context.database);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ channel: this.channel, parameters }))
      .digest("hex");
    const previous = await keys.find(context.actor.id, operationId);
    if (previous) {
      if (
        previous.operation !== operation ||
        previous.fingerprint !== fingerprint
      )
        throw new AgentOperationError("CONFLICT");
      const stored: unknown = JSON.parse(previous.resultJson);
      return { apiVersion: "1", result: readAdminChanged(stored) };
    }
    const mutation = await this.apply(context, operation, parameters);
    if (
      Buffer.byteLength(JSON.stringify({ apiVersion: "1", ...mutation })) >
      PAGES_AGENT_LIMITS.responseBytes
    )
      throw new AgentOperationError("PAYLOAD_TOO_LARGE");
    if (mutation.result.changed)
      await new AdministrationActivityRepository(context.database).insert({
        actorId: context.actor.id,
        operation,
        source: this.channel === "chat" ? "ai" : "mcp",
        result: mutation.result,
      });
    await keys.insert(context.actor.id, operationId, {
      operation,
      fingerprint,
      resultJson: JSON.stringify(mutation.result),
    });
    return { apiVersion: "1", ...mutation };
  }

  private async apply(
    context: AgentAdministrationContext,
    operation: AgentAdminWriteOperation,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<ChatAdminMutation> {
    if (isChatOnlyAdminWriteOperation(operation))
      return applyChatAdministration(context, operation, parameters);
    switch (operation) {
      case "admin.roles.setPermissions":
        return { result: await setAdminRolePermissions(context, parameters) };
      case "admin.roles.assign":
        return { result: await assignAdminRole(context, parameters) };
      case "admin.users.setScope":
        return { result: await setAdminScope(context, parameters) };
      case "admin.users.setName":
        return { result: await setAdminUserName(context, parameters) };
      case "admin.users.setDepartments":
        return { result: await setAdminDepartments(context, parameters) };
      case "admin.groups.update":
        return { result: await updateAdminGroup(context, parameters) };
      case "admin.departments.rename":
        return { result: await renameAdminDepartment(context, parameters) };
    }
  }
}

function translateAdminError(error: unknown): unknown {
  if (error instanceof AdministrationError) {
    if (error.code === "forbidden") return new AgentOperationError("FORBIDDEN");
    if (error.code === "notFound") return new AgentOperationError("NOT_FOUND");
    return new AgentOperationError(
      error.code === "invalidInput" ? "INVALID_REQUEST" : "CONFLICT",
    );
  }
  if (error instanceof EmailTakenError || error instanceof UsernameTakenError)
    return new AgentOperationError("CONFLICT");
  return translateAgentTicketError(error);
}
