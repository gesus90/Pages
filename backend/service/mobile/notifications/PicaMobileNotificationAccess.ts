import type { NotificationPreferenceRecord } from "@/backend/database/repositories/mobile/PicaMobileNotificationPreferenceRepository";
import type { PicaMobileNotificationPreferenceRepository } from "@/backend/database/repositories/mobile/PicaMobileNotificationPreferenceRepository";
import type {
  AgentPlanOwnerRunAccess,
  AgentPlanOwnerRunReader,
} from "@/backend/service/agents/AgentPlanOwnerRunReader";

/**
 * Whether a team choice covers an event of a given moment.
 *
 * @param preference - The current choices of the account.
 * @param occurredAt - The moment of the event as ISO-8601 text.
 * @returns `true` while team runs are switched on and were already on when the event happened.
 */
export function coversTeamEvent(
  preference: NotificationPreferenceRecord,
  occurredAt: string,
): boolean {
  return (
    preference.teamRuns &&
    preference.teamRunsSince !== null &&
    preference.teamRunsSince <= occurredAt
  );
}

/**
 * Decides whether an account may be told about an event of a run.
 *
 * @remarks
 * The starter of a run is told about its own runs. A team member is told only
 * while the account has team runs switched on, had them on when the event
 * happened, still belongs to the team of the plan and may read the plan and the
 * run itself. Every creation, delivery and read of an event asks again.
 */
export class PicaMobileNotificationAccess {
  private readonly runs: Pick<AgentPlanOwnerRunReader, "read">;
  private readonly preferences: Pick<
    PicaMobileNotificationPreferenceRepository,
    "find"
  >;

  /**
   * Creates the decision.
   *
   * @param runs - The rights check on concrete runs.
   * @param preferences - The stored choices of the accounts.
   */
  public constructor(
    runs: Pick<AgentPlanOwnerRunReader, "read">,
    preferences: Pick<PicaMobileNotificationPreferenceRepository, "find">,
  ) {
    this.runs = runs;
    this.preferences = preferences;
  }

  /**
   * Reads a run for an account that is to be told about one of its events.
   *
   * @param accountId - The recipient.
   * @param runId - The run.
   * @param occurredAt - The moment of the event as ISO-8601 text.
   * @returns The run when the account may be told; `denied` for a team member
   * whose choice is off or younger than the event.
   * @throws When Pages cannot decide right now.
   */
  public async read(
    accountId: string,
    runId: string,
    occurredAt: string,
  ): Promise<AgentPlanOwnerRunAccess> {
    const access = await this.runs.read(accountId, runId);

    if (access.status !== "granted" || access.relation === "starter") {
      return access;
    }

    return coversTeamEvent(await this.preferences.find(accountId), occurredAt)
      ? access
      : { status: "denied" };
  }
}
