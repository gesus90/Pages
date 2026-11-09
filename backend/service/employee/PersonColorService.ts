import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { CAPABILITY } from "@/definition/Authorization";
import { isPersonColor, readPersonColor } from "@/definition/PersonColor";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { PersonColor } from "@/definition/PersonColor";

/** Reads a submitted color: one of the palette, or none. */
function readColor(input: unknown): PersonColor | null {
  if (input === null || input === undefined || input === "") return null;
  if (!isPersonColor(input)) throw new AgentEmployeeError("invalidInput");
  return readPersonColor(input);
}

/**
 * The person color of accounts (PAGE-266): the ring around the avatar and
 * the name color in the chat.
 *
 * @remarks
 * Everybody chooses their own color; who may change another person in the
 * administration may change theirs. Agents get theirs in the agent panel.
 * Only the twelve colors of the palette are stored; `null` returns to the
 * former look without a ring.
 */
export class PersonColorService {
  private readonly authorization: AuthorizationRepository;
  private readonly cache: Pick<ServerCache, "invalidateUsers">;
  private readonly policy = new UserPolicyService();

  public constructor(
    authorization: AuthorizationRepository,
    cache: Pick<ServerCache, "invalidateUsers">,
  ) {
    this.authorization = authorization;
    this.cache = cache;
  }

  /** Sets the color of the person's own account. */
  public async setOwn(userId: string, color: unknown): Promise<void> {
    await this.authorization
      .employees()
      .identities()
      .setColor(userId, readColor(color));
    this.cache.invalidateUsers();
  }

  /**
   * Sets the color of another account in the administration.
   *
   * @throws {AgentEmployeeError} `forbidden` without the right to change the account.
   */
  public async set(
    actorId: string,
    targetId: string,
    color: unknown,
  ): Promise<void> {
    const value = readColor(color);
    await this.authorization.transaction(async (repository) => {
      const snapshot = await repository.snapshot();
      const actor = snapshot.accounts.find((entry) => entry.userId === actorId);
      const target = snapshot.accounts.find(
        (entry) => entry.userId === targetId,
      );
      if (
        !actor?.isActive ||
        !target ||
        !this.policy.canChange(actor, target, CAPABILITY.MANAGE_USERS)
      )
        throw new AgentEmployeeError("forbidden");
      await repository.employees().identities().setColor(targetId, value);
    });
    this.cache.invalidateUsers();
  }
}
