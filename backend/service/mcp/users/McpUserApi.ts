import { z } from "zod";

import { AdministrationActivityRepository } from "@/backend/database/repositories/AdministrationActivityRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import {
  recordInterfaceOperation,
  replayInterfaceOperation,
} from "@/backend/service/InterfaceOperationJournal";

import { McpUserCatalogService } from "./McpUserCatalogService";
import { McpUserError } from "./McpUserError";
import { McpUserReadService } from "./McpUserReadService";
import { McpUserSession } from "./McpUserSession";
import { McpUserWriteService } from "./McpUserWriteService";

import type { PasswordHasher } from "@/backend/auth/PasswordHasher";
import type { ServerCache } from "@/backend/cache/ServerCache";
import type { Database } from "@/backend/database/Database";
import type { McpDeviceService } from "@/backend/service/mcp/McpDeviceService";
import type { User } from "@/definition/User";
import type { McpUserCommand, McpUserMutation } from "./McpUserCommand";
import type {
  McpUserChangeResponse,
  McpUserCredentialResponse,
} from "./McpUserContract";

/** What the user management API is built from. */
export interface McpUserDependencies {
  readonly database: Database;
  /** The shared cache the interface reads; invalidated after every committed change. */
  readonly cache: ServerCache;
  readonly hasher: PasswordHasher;
  readonly devices: Pick<McpDeviceService, "authenticate">;
}

/** What an operation key keeps: the public result, never a password. */
const storedSchema = z.object({
  result: z.object({
    id: z.string(),
    targetType: z.enum(["person", "group", "department", "role"]),
    changed: z.boolean(),
    affectedUserIds: z.array(z.string()).readonly(),
  }),
  user: z.object({ id: z.string(), username: z.string() }).optional(),
});

type StoredChange = z.infer<typeof storedSchema>;

/** The answer of a repetition: the stored result, and for a password only that it is gone. */
function replayAnswer(
  stored: StoredChange,
): McpUserChangeResponse | McpUserCredentialResponse {
  if (stored.user === undefined)
    return { result: stored.result, replayed: true };
  return {
    result: stored.result,
    replayed: true,
    user: stored.user,
    temporaryPasswordStatus: "not_retrievable",
  };
}

/** The first answer of a change, with the temporary password if one was issued. */
function firstAnswer(
  mutation: McpUserMutation,
): McpUserChangeResponse | McpUserCredentialResponse {
  if (mutation.credential === undefined)
    return { result: mutation.result, replayed: false };
  return {
    result: mutation.result,
    replayed: false,
    user: mutation.credential.user,
    temporaryPassword: mutation.credential.temporaryPassword,
    temporaryPasswordStatus: "issued",
  };
}

/**
 * The user management API of the stand-alone Pages MCP program (PAGE-280).
 *
 * @remarks
 * A paired machine acts with the rights of the account that confirmed the
 * pairing. Every request checks the token, the account and its forced
 * password change again, and then reads the actor's facts inside the
 * transaction of the call. The administration services of the interface
 * run on the `mcp` channel: personal administrator eligibility counts
 * without the admin mode of the interface, and the call never switches the
 * mode. Everyone else acts only with the rights of their role, rank and
 * range. A change, its history line and its operation key commit together.
 */
export class McpUserApi {
  public readonly reads = new McpUserReadService();
  public readonly users = new McpUserWriteService();
  public readonly catalog = new McpUserCatalogService();
  private readonly dependencies: McpUserDependencies;

  /**
   * Creates the API.
   *
   * @param dependencies - Database, cache, password hashing and token check.
   */
  public constructor(dependencies: McpUserDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Checks the token of a request and the account behind it.
   *
   * @param authorization - The `Authorization` header of the request.
   * @returns The account the token acts for.
   * @throws {McpDeviceError} `invalid_token` for a missing, unknown or revoked token.
   * @throws {McpUserError} `invalid_token` when the account is gone,
   * deactivated or has to change its password first.
   */
  public async authenticate(authorization: string | null): Promise<User> {
    const identity =
      await this.dependencies.devices.authenticate(authorization);
    const credentials = await new UserRepository(
      this.dependencies.database,
    ).findCredentialsByUsername(identity.account.username);
    // Only the account leaves this lookup; the password hash is not kept.
    const account = credentials?.user ?? null;
    if (account === null || !account.isActive || account.mustChangePassword)
      throw new McpUserError("invalid_token");
    return account;
  }

  /**
   * Runs reads on one consistent state of the actor's rights.
   *
   * @param actor - The authenticated account.
   * @param work - The reads.
   */
  public async read<Result>(
    actor: User,
    work: (session: McpUserSession) => Promise<Result> | Result,
  ): Promise<Result> {
    return this.dependencies.database.readTransaction(async (transaction) =>
      work(
        await McpUserSession.open(
          transaction,
          actor.id,
          this.dependencies.hasher,
        ),
      ),
    );
  }

  /**
   * Runs a change once per operation ID.
   *
   * @param actor - The authenticated account.
   * @param command - The operation with the right a repetition needs, and the change.
   * @returns The first answer, or for a repetition with the same request the
   * stored public result with `replayed: true` and nothing run again.
   * @throws {McpUserError} `conflict` when the operation ID belongs to another request.
   *
   * @remarks
   * The temporary password of a creation or reset is part of the first answer
   * only: neither the operation key nor the history keeps it.
   */
  public async change(
    actor: User,
    command: McpUserCommand,
  ): Promise<McpUserChangeResponse | McpUserCredentialResponse> {
    const { database, hasher } = this.dependencies;
    const { operation, apply } = command;
    const outcome = await database.transaction(async (transaction) => {
      const session = await McpUserSession.open(transaction, actor.id, hasher);
      operation.guard(session);
      const keys = new AgentOperationKeyRepository(transaction);
      const journal = {
        userId: actor.id,
        operation: operation.name,
        operationId: operation.operationId,
        request: operation.request,
      };
      const stored = await replayInterfaceOperation(
        keys,
        journal,
        storedSchema,
      );
      if (stored !== null)
        return { answer: replayAnswer(stored), changed: false };
      const mutation = await apply(session);
      if (mutation.result.changed)
        await new AdministrationActivityRepository(transaction).insert({
          actorId: actor.id,
          operation: operation.name,
          source: "mcp",
          result: mutation.result,
        });
      const kept: StoredChange = {
        result: mutation.result,
        user: mutation.credential?.user,
      };
      await recordInterfaceOperation(keys, journal, kept);
      return {
        answer: firstAnswer(mutation),
        changed: mutation.result.changed,
      };
    });
    if (outcome.changed) this.invalidate();
    return outcome.answer;
  }

  /** Lets the interface and other sessions read the committed state. */
  private invalidate(): void {
    const { cache } = this.dependencies;
    cache.invalidateUsers();
    cache.invalidateProjectMembership();
    cache.invalidatePrefix("project:");
    cache.invalidateProjectsList();
    cache.invalidateWorkItems();
    cache.invalidateLabels();
    cache.invalidateGitHub();
  }
}
