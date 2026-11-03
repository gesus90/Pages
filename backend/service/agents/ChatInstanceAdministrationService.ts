import { createHash } from "node:crypto";

import { AdministrationActivityRepository } from "@/backend/database/repositories/AdministrationActivityRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import {
  AgentAccessDeniedError,
  AgentError,
} from "@/backend/error/AgentErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { logCaughtError } from "@/backend/logging/Logger";
import { findAccount } from "@/backend/service/AdministrationAccess";
import { InstanceSettingsDeniedError } from "@/backend/service/InstanceSettingsService";
import {
  isChatInstanceReadOperation,
  isChatInstanceWriteOperation,
} from "@/definition/ChatInstanceAdministration";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import { pageAgentEntries } from "./AgentCursor";
import { requireAgentConfirmation } from "./AgentConfirmation";
import { requireAgentAdministratorActor } from "./AgentAdministratorAccess";
import { readIdentifier, readParameterRecord } from "./AgentParameterReader";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type {
  AgentAdminChanged,
  AgentAdminWriteResponse,
} from "@/definition/AgentAdministration";
import type {
  AgentAdminConnection,
  ChatInstanceWriteOperation,
} from "@/definition/ChatInstanceAdministration";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { User } from "@/definition/User";
import type { AgentConnectionService } from "./AgentConnectionService";
import type { InstanceSettingsService } from "../InstanceSettingsService";

/** The persisted services the instance administration of the chat runs on. */
export interface ChatInstanceAdministrationDependencies {
  readonly database: Pick<Database, "transaction">;
  readonly connections: Pick<AgentConnectionService, "list" | "setActive">;
  readonly settings: Pick<
    InstanceSettingsService,
    "getBranding" | "updateCompanyName"
  >;
}

/** The administrator the call runs for, read from persisted facts in one transaction. */
interface InstanceAdministrator {
  readonly actor: User;
  readonly account: AccountAccess;
}

const WRITE_KEYS: Readonly<
  Record<ChatInstanceWriteOperation, readonly string[]>
> = {
  "admin.connections.setActive": [
    "operationId",
    "connectionId",
    "isActive",
    "expectedIsActive",
  ],
  "admin.settings.setCompanyName": [
    "operationId",
    "companyName",
    "expectedCompanyName",
  ],
};

function requireKeys(
  parameters: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  if (
    required.some((key) => !(key in parameters)) ||
    Object.keys(parameters).some(
      (key) => !required.includes(key) && !optional.includes(key),
    )
  )
    throw new AgentOperationError("INVALID_REQUEST");
}

function readBoolean(input: unknown): boolean {
  if (typeof input !== "boolean")
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}

function readNullableText(input: unknown): string | null {
  if (input === null) return null;
  if (typeof input !== "string" || input.length > 200)
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}

function toConnection(summary: {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly accessKind: string;
  readonly isActive: boolean;
  readonly hasApiKey: boolean;
  readonly testModel: string | null;
  readonly updatedAt: string;
}): AgentAdminConnection {
  return {
    id: summary.id,
    name: summary.name,
    provider: summary.provider,
    accessKind: summary.accessKind,
    isActive: summary.isActive,
    hasApiKey: summary.hasApiKey,
    testModel: summary.testModel,
    updatedAt: summary.updatedAt,
  };
}

function translateInstanceError(error: unknown): unknown {
  if (
    error instanceof AgentAccessDeniedError ||
    error instanceof InstanceSettingsDeniedError
  )
    return new AgentOperationError("FORBIDDEN");
  if (error instanceof AgentError)
    return new AgentOperationError(
      error.code === "connection_not_found" ? "NOT_FOUND" : "CONFLICT",
    );
  return error;
}

/**
 * Connection and instance settings administration for the signed-in chat.
 *
 * @remarks
 * Every call resolves the persisted administrator afresh and then uses the
 * regular connection and instance settings services, which check the rights
 * again. A write carries the last read state, a replayable operation ID and,
 * for disabling a connection, the typed confirmation; its public result is
 * recorded in the administration audit trail as an AI action. Credentials
 * never leave the connection service.
 */
export class ChatInstanceAdministrationService {
  private readonly dependencies: ChatInstanceAdministrationDependencies;

  public constructor(dependencies: ChatInstanceAdministrationDependencies) {
    this.dependencies = dependencies;
  }

  /** Handles only the chat-only instance operations and returns `null` for any other name. */
  public async handle(
    identity: AgentIdentity,
    operation: unknown,
    input: unknown,
  ): Promise<PagesAgentReadResponse | AgentAdminWriteResponse | null> {
    const isRead = isChatInstanceReadOperation(operation);
    const isWrite = isChatInstanceWriteOperation(operation);
    if (!isRead && !isWrite) return null;
    try {
      const administrator = await this.requireAdministrator(identity.userId);
      const parameters = readParameterRecord(input ?? {});
      if (isWrite)
        return await this.write(administrator, operation, parameters);
      return await this.read(administrator, operation, parameters);
    } catch (error: unknown) {
      logCaughtError("ChatInstanceAdministrationService", error);

      throw translateInstanceError(error);
    }
  }

  private async requireAdministrator(
    userId: string,
  ): Promise<InstanceAdministrator> {
    return this.dependencies.database.transaction(async (transaction) => {
      const { actor, snapshot } = await requireAgentAdministratorActor(
        transaction,
        userId,
        "chat",
      );
      return { actor, account: findAccount(snapshot, userId) };
    });
  }

  private async read(
    administrator: InstanceAdministrator,
    operation: "admin.connections.list" | "admin.settings.read",
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<PagesAgentReadResponse> {
    if (operation === "admin.settings.read") {
      requireKeys(parameters, []);
      const branding = await this.dependencies.settings.getBranding();
      return {
        apiVersion: "1",
        result: {
          companyName: branding.companyName,
          hasLogo: branding.logoUrl !== null,
        },
      };
    }
    requireKeys(parameters, [], ["cursor", "limit"]);
    const connections = await this.dependencies.connections.list(
      administrator.account,
    );
    return {
      apiVersion: "1",
      result: pageAgentEntries(connections.map(toConnection), {
        cursor: parameters.cursor,
        limit: parameters.limit,
        context: JSON.stringify([administrator.actor.id, operation]),
      }),
    };
  }

  private async write(
    administrator: InstanceAdministrator,
    operation: ChatInstanceWriteOperation,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<AgentAdminWriteResponse> {
    requireKeys(parameters, WRITE_KEYS[operation], ["confirmation"]);
    const operationId = readIdentifier(parameters.operationId);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ channel: "chat", operation, parameters }))
      .digest("hex");
    const stored = await this.replay(administrator, operationId, {
      operation,
      fingerprint,
    });
    if (stored) return { apiVersion: "1", result: stored };
    const result =
      operation === "admin.connections.setActive"
        ? await this.setConnectionActive(administrator, parameters)
        : await this.setCompanyName(administrator, parameters);
    const response = { apiVersion: "1" as const, result };
    if (
      Buffer.byteLength(JSON.stringify(response)) >
      PAGES_AGENT_LIMITS.responseBytes
    )
      throw new AgentOperationError("PAYLOAD_TOO_LARGE");
    await this.record(
      administrator,
      { operation, operationId, fingerprint },
      result,
    );
    return response;
  }

  /** The stored result of an earlier call with this operation ID, or `null` for a new one. */
  private async replay(
    administrator: InstanceAdministrator,
    operationId: string,
    request: { readonly operation: string; readonly fingerprint: string },
  ): Promise<AgentAdminChanged | null> {
    const previous = await this.dependencies.database.transaction(
      (transaction) =>
        new AgentOperationKeyRepository(transaction).find(
          administrator.actor.id,
          operationId,
        ),
    );
    if (!previous) return null;
    if (
      previous.operation !== request.operation ||
      previous.fingerprint !== request.fingerprint
    )
      throw new AgentOperationError("CONFLICT");
    return readStoredChange(previous.resultJson);
  }

  private async setConnectionActive(
    administrator: InstanceAdministrator,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<AgentAdminChanged> {
    const id = readIdentifier(parameters.connectionId);
    const isActive = readBoolean(parameters.isActive);
    const expected = readBoolean(parameters.expectedIsActive);
    await this.requireConfirmation(administrator, parameters.confirmation);
    const { connections } = this.dependencies;
    const current = (await connections.list(administrator.account)).find(
      (connection) => connection.id === id,
    );
    if (!current) throw new AgentOperationError("NOT_FOUND");
    if (current.isActive !== expected)
      throw new AgentOperationError("CONFLICT");
    const changed = current.isActive !== isActive;
    if (changed)
      await connections.setActive(administrator.account, id, isActive);
    return { id, targetType: "connection", changed, affectedUserIds: [] };
  }

  private async setCompanyName(
    administrator: InstanceAdministrator,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<AgentAdminChanged> {
    const companyName = readNullableText(parameters.companyName)?.trim();
    const expected = readNullableText(parameters.expectedCompanyName);
    if (!companyName) throw new AgentOperationError("INVALID_REQUEST");
    const { settings } = this.dependencies;
    const current = (await settings.getBranding()).companyName;
    if (current !== expected) throw new AgentOperationError("CONFLICT");
    const changed = current !== companyName;
    if (
      changed &&
      !(await settings.updateCompanyName(administrator.actor, companyName))
    )
      throw new AgentOperationError("INVALID_REQUEST");
    return {
      id: "company-name",
      targetType: "instance",
      changed,
      affectedUserIds: [],
    };
  }

  private async requireConfirmation(
    administrator: InstanceAdministrator,
    confirmation: unknown,
  ): Promise<void> {
    await this.dependencies.database.transaction((transaction) =>
      requireAgentConfirmation(
        transaction,
        administrator.actor.id,
        confirmation,
      ),
    );
  }

  /** Stores the audit entry and the replay result together, after the change committed. */
  private async record(
    administrator: InstanceAdministrator,
    request: {
      readonly operation: ChatInstanceWriteOperation;
      readonly operationId: string;
      readonly fingerprint: string;
    },
    result: AgentAdminChanged,
  ): Promise<void> {
    await this.dependencies.database.transaction(
      async (transaction: DatabaseTransaction) => {
        if (result.changed)
          await new AdministrationActivityRepository(transaction).insert({
            actorId: administrator.actor.id,
            operation: request.operation,
            source: "ai",
            result,
          });
        await new AgentOperationKeyRepository(transaction).insert(
          administrator.actor.id,
          request.operationId,
          {
            operation: request.operation,
            fingerprint: request.fingerprint,
            resultJson: JSON.stringify(result),
          },
        );
      },
    );
  }
}

/** Narrows a stored result instead of trusting replay JSON as a type. */
function readStoredChange(json: string): AgentAdminChanged {
  const stored: unknown = JSON.parse(json);
  const result = readParameterRecord(stored);
  if (result.targetType !== "connection" && result.targetType !== "instance")
    throw new AgentOperationError("CONFLICT");
  return {
    id: readIdentifier(result.id),
    targetType: result.targetType,
    changed: readBoolean(result.changed),
    affectedUserIds: [],
  };
}
