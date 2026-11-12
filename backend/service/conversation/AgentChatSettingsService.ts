import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { AGENT_CHAT_HOURLY_LIMIT_RANGE } from "@/definition/Conversation";

import { requireAgentAdministrator } from "../agents/AgentServiceAccess";

import type { AgentChatSettingsRepository } from "@/backend/database/repositories/conversation/AgentChatSettingsRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentChatSettings } from "@/definition/Conversation";

/** A submitted change of the hourly limit. */
export interface AgentChatSettingsInput {
  readonly hourlyMessageLimit: number;
  readonly revision: number;
}

/**
 * The setting of the chat of agents under Settings → Agents (PAGE-311).
 *
 * @remarks
 * Only an administrator in the active admin mode reads the form and saves.
 * The limit is how many messages one agent may send per hour.
 */
export class AgentChatSettingsService {
  private readonly settings: Pick<AgentChatSettingsRepository, "read" | "save">;
  private readonly writes = new SerialQueue();

  public constructor(
    settings: Pick<AgentChatSettingsRepository, "read" | "save">,
  ) {
    this.settings = settings;
  }

  /** Supplies the settings card. */
  public async administration(
    actor: AccountAccess,
  ): Promise<AgentChatSettings> {
    requireAgentAdministrator(actor);
    return this.settings.read();
  }

  /**
   * Saves the hourly limit.
   *
   * @throws {AgentError} `profile_invalid` for a limit outside the range,
   * `profile_conflict` after a concurrent change.
   */
  public async save(
    actor: AccountAccess,
    input: AgentChatSettingsInput,
  ): Promise<void> {
    requireAgentAdministrator(actor);
    const { hourlyMessageLimit, revision } = input;
    if (
      !Number.isSafeInteger(hourlyMessageLimit) ||
      hourlyMessageLimit < AGENT_CHAT_HOURLY_LIMIT_RANGE.minimum ||
      hourlyMessageLimit > AGENT_CHAT_HOURLY_LIMIT_RANGE.maximum
    )
      throw new AgentError("profile_invalid");
    await this.writes.run(() =>
      this.settings.save({ hourlyMessageLimit, revision }),
    );
  }
}
