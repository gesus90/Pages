import { randomUUID } from "node:crypto";

import { z } from "zod";

import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { CAPABILITY } from "@/definition/Authorization";

import type { ActorChannel } from "@/backend/auth/McpActorContext";
import type { ServerCache } from "@/backend/cache/ServerCache";
import type {
  AuthorizationRepository,
  AuthorizationSnapshot,
} from "@/backend/database/repositories/AuthorizationRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type {
  AgentDeletionPreview,
  AgentDeletionResult,
  DeletedAgent,
} from "@/definition/AgentDeletion";

const PREVIEW_MILLISECONDS = 10 * 60 * 1000;
const RESTORE_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
const DELETE_RESULT_SCHEMA = z.object({
  agentId: z.string(),
  deletedAt: z.string(),
  restorableUntil: z.string(),
});
const RESTORE_RESULT_SCHEMA = z.object({
  agentId: z.string(),
  restoredAt: z.string(),
});

/** Public failure codes of the agent deletion contract. */
export type AgentDeletionErrorCode =
  "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INVALID_REQUEST";

/** A deletion failure with its stable reason. */
export class AgentDeletionError extends Error {
  public readonly code: AgentDeletionErrorCode;
  public readonly reason: string;

  public constructor(code: AgentDeletionErrorCode, reason: string) {
    super("The agent deletion request was rejected.");
    this.name = "AgentDeletionError";
    this.code = code;
    this.reason = reason;
  }
}

/** Clock, persistence and cache dependencies of the reversible lifecycle. */
export interface AgentDeletionDependencies {
  readonly authorization: AuthorizationRepository;
  readonly cache: Pick<
    ServerCache,
    "invalidateUsers" | "invalidateProjectMembership" | "invalidateWorkItems"
  >;
  readonly now?: () => Date;
  /** File operations supplied by the instance; tests can replace them. */
  readonly files?: {
    remove(
      kind: "session" | "chat" | "plan" | "voice",
      name: string,
    ): Promise<void>;
  };
}

function requireAdministrator(
  snapshot: AuthorizationSnapshot,
  actorId: string,
  policy: UserPolicyService,
): void {
  const actor = snapshot.accounts.find((account) => account.userId === actorId);
  if (!actor || !policy.isAdministrator(actor))
    throw new AgentDeletionError("FORBIDDEN", "not_authorized");
}

function requireTarget(
  snapshot: AuthorizationSnapshot,
  actorId: string,
  agentId: string,
  policy: UserPolicyService,
): AccountAccess {
  const actor = snapshot.accounts.find((account) => account.userId === actorId);
  if (!actor || !actor.isActive)
    throw new AgentDeletionError("FORBIDDEN", "not_authorized");
  const target = snapshot.accounts.find(
    (account) => account.userId === agentId,
  );
  if (!target) throw new AgentDeletionError("NOT_FOUND", "not_found");
  if (actorId === agentId) throw new AgentDeletionError("FORBIDDEN", "self");
  if (target.isAdmin) throw new AgentDeletionError("FORBIDDEN", "admin_target");
  if (target.isAgent !== true)
    throw new AgentDeletionError("FORBIDDEN", "human_target");
  if (policy.isManagement(actor) && !policy.isAdministrator(actor))
    throw new AgentDeletionError("FORBIDDEN", "core_system");
  const isManager =
    actor.role?.name === "Verwaltung" &&
    policy.has(actor, CAPABILITY.MANAGE_USERS);
  if (
    !policy.isAdministrator(actor) &&
    !(isManager && policy.canChange(actor, target, CAPABILITY.MANAGE_USERS))
  )
    throw new AgentDeletionError("FORBIDDEN", "not_authorized");
  return target;
}

/** Owns preview, soft deletion, restoration and expiry of agent employees. */
export class AgentDeletionService {
  private readonly dependencies: AgentDeletionDependencies;
  private readonly policy: UserPolicyService;

  public constructor(
    dependencies: AgentDeletionDependencies,
    channel: ActorChannel = "ui",
  ) {
    this.dependencies = dependencies;
    this.policy = new UserPolicyService(channel);
  }

  /** Gives the MCP route its own administrator reading without changing UI mode. */
  public forChannel(channel: ActorChannel): AgentDeletionService {
    return new AgentDeletionService(this.dependencies, channel);
  }

  /** Saves and returns a ten-minute inventory preview bound to actor and agent. */
  public async preview(
    actorId: string,
    agentId: string,
  ): Promise<AgentDeletionPreview> {
    const result = await this.dependencies.authorization.transaction(
      async (authorization) => {
        const snapshot = await authorization.snapshot();
        requireTarget(snapshot, actorId, agentId, this.policy);
        const user = await authorization.users().findById(agentId);
        const repository = authorization.employees().deletions();
        if (!user || (await repository.findDeletion(agentId)))
          throw new AgentDeletionError("NOT_FOUND", "not_found");
        const inventory = await repository.inventory(agentId);
        const previewId = randomUUID();
        const expiresAt = new Date(
          this.now().getTime() + PREVIEW_MILLISECONDS,
        ).toISOString();
        await repository.savePreview({
          id: previewId,
          agentId,
          actorId,
          fingerprint: inventory.fingerprint,
          expiresAt,
        });
        return {
          agentId,
          displayName: user.displayName,
          blockers: inventory.blockers,
          deletes: inventory.deletes,
          keeps: inventory.keeps,
          ownedPlans: inventory.ownedPlans,
          previewId,
          expiresAt,
        };
      },
    );
    return result;
  }

  /** Deactivates an agent and revokes its credentials after a current preview. */
  public async delete(
    actorId: string,
    agentId: string,
    previewId: string,
    operationId: string,
  ): Promise<AgentDeletionResult> {
    if (!previewId)
      throw new AgentDeletionError("INVALID_REQUEST", "preview_missing");
    if (!operationId)
      throw new AgentDeletionError("INVALID_REQUEST", "operation_missing");
    const result = await this.dependencies.authorization.transaction(
      async (authorization) => {
        const repository = authorization.employees().deletions();
        const previous = await repository.findOperation(operationId);
        if (previous) {
          if (
            previous.action !== "delete" ||
            previous.actorId !== actorId ||
            previous.agentId !== agentId
          )
            throw new AgentDeletionError("CONFLICT", "preview_stale");
          return DELETE_RESULT_SCHEMA.parse(JSON.parse(previous.result));
        }
        const snapshot = await authorization.snapshot();
        requireTarget(snapshot, actorId, agentId, this.policy);
        if (await repository.findDeletion(agentId))
          throw new AgentDeletionError("NOT_FOUND", "not_found");
        const preview = await repository.findPreview(previewId);
        if (
          !preview ||
          preview.agentId !== agentId ||
          preview.actorId !== actorId
        )
          throw new AgentDeletionError("CONFLICT", "preview_stale");
        const now = this.now();
        if (preview.expiresAt <= now.toISOString())
          throw new AgentDeletionError("CONFLICT", "preview_expired");
        const inventory = await repository.inventory(agentId);
        if (inventory.blockers.length > 0)
          throw new AgentDeletionError("CONFLICT", "active_runs");
        if (inventory.fingerprint !== preview.fingerprint)
          throw new AgentDeletionError("CONFLICT", "preview_stale");
        const user = await authorization.users().findById(agentId);
        if (!user) throw new AgentDeletionError("NOT_FOUND", "not_found");
        const deletedAt = now.toISOString();
        const restorableUntil = new Date(
          now.getTime() + RESTORE_MILLISECONDS,
        ).toISOString();
        await repository.delete({
          agentId,
          actorId,
          displayName: user.displayName,
          deletedAt,
          restorableUntil,
          counts: inventory.deletes,
          eventId: operationId,
        });
        const answer = { agentId, deletedAt, restorableUntil };
        await repository.saveOperation({
          id: operationId,
          action: "delete",
          agentId,
          actorId,
          result: answer,
        });
        return answer;
      },
    );
    this.invalidate();
    return result;
  }

  /** Restores an agent and its temporarily hidden artifacts inside seven days. */
  public async restore(
    actorId: string,
    agentId: string,
    operationId: string,
  ): Promise<{ readonly agentId: string; readonly restoredAt: string }> {
    if (!operationId)
      throw new AgentDeletionError("INVALID_REQUEST", "operation_missing");
    const result = await this.dependencies.authorization.transaction(
      async (authorization) => {
        const repository = authorization.employees().deletions();
        const previous = await repository.findOperation(operationId);
        if (previous) {
          if (
            previous.action !== "restore" ||
            previous.actorId !== actorId ||
            previous.agentId !== agentId
          )
            throw new AgentDeletionError("CONFLICT", "preview_stale");
          return RESTORE_RESULT_SCHEMA.parse(JSON.parse(previous.result));
        }
        requireAdministrator(
          await authorization.snapshot(),
          actorId,
          this.policy,
        );
        const deletion = await repository.findDeletion(agentId);
        if (!deletion) throw new AgentDeletionError("NOT_FOUND", "not_found");
        const restoredAt = this.now().toISOString();
        if (deletion.restorableUntil <= restoredAt)
          throw new AgentDeletionError("NOT_FOUND", "not_found");
        await repository.restore(agentId, actorId, restoredAt, operationId);
        const answer = { agentId, restoredAt };
        await repository.saveOperation({
          id: operationId,
          action: "restore",
          agentId,
          actorId,
          result: answer,
        });
        return answer;
      },
    );
    this.invalidate();
    return result;
  }

  /** Lists agents that an administrator may still restore. */
  public async deleted(
    actorId: string,
    cursor: string | null,
    limit: number,
  ): Promise<{
    readonly agents: readonly DeletedAgent[];
    readonly nextCursor: string | null;
  }> {
    requireAdministrator(
      await this.dependencies.authorization.snapshot(),
      actorId,
      this.policy,
    );
    return this.dependencies.authorization
      .employees()
      .deletions()
      .listDeleted(cursor, limit, this.now().toISOString());
  }

  /** Permanently purges expired agents and retries any committed disk cleanup. */
  public async purgeExpired(): Promise<void> {
    const repository = this.dependencies.authorization
      .employees()
      .deletionPurges();
    for (const agentId of await repository.expired(this.now().toISOString())) {
      await this.dependencies.authorization.transaction(
        async (authorization) => {
          const deletion = await authorization
            .employees()
            .deletions()
            .findDeletion(agentId);
          if (!deletion || deletion.restorableUntil > this.now().toISOString())
            return;
          await authorization
            .employees()
            .deletionPurges()
            .purge(agentId, this.now().toISOString(), randomUUID());
        },
      );
      this.invalidate();
    }
    const files = this.dependencies.files;
    if (!files) return;
    for (const entry of (await repository.pendingFiles()).entries) {
      await files.remove(entry.kind, entry.name);
      await repository.acknowledgeFile(entry.kind, entry.name);
    }
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }

  private invalidate(): void {
    this.dependencies.cache.invalidateUsers();
    this.dependencies.cache.invalidateProjectMembership();
    this.dependencies.cache.invalidateWorkItems();
  }
}
