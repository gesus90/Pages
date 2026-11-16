import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { AGENT_CHAT_TASK_LIMIT_RANGE } from "@/definition/AgentChatTask";
import { AGENT_CHAT_HOURLY_LIMIT_RANGE } from "@/definition/Conversation";

import { requireAgentAdministrator } from "../agents/AgentServiceAccess";

import type { AgentChatSettingsRepository } from "@/backend/database/repositories/conversation/AgentChatSettingsRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentChatSettings } from "@/definition/Conversation";

/** A submitted change of the hourly limit and of the limit of tasks per chat. */
export interface AgentChatSettingsInput {
  readonly hourlyMessageLimit: number;
  /** Absent keeps the stored limit of scheduled tasks per chat. */
  readonly scheduledTaskLimit?: number;
  readonly revision: number;
}

function isInRange(
  value: number,
  range: { readonly minimum: number; readonly maximum: number },
): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= range.minimum &&
    value <= range.maximum
  );
}

/**
 * The setting of the chat of agents under Settings → Agents.
 * @remarks
 * Only an administrator in the active admin mode reads the form and saves.
 * The limit is how many messages one agent may send per hour; the second
 * one how many scheduled tasks one chat may hold.
 */
export class AgentChatSettingsService {
  private readonly settings: Pick<AgentChatSettingsRepository, "read" | "save">;
  private readonly writes = new SerialQueue();

  public constructor(
    settings: Pick<AgentChatSettingsRepository, "read" | "save">,
  ) {
    this.settings = settings;
  }

  /** The settings as the scheduled tasks of chats apply them, without an administrator. */
  public async current(): Promise<AgentChatSettings> {
    return this.settings.read();
  }

  /** Supplies the settings card. */
  public async administration(
    actor: AccountAccess,
  ): Promise<AgentChatSettings> {
    requireAgentAdministrator(actor);
    return this.settings.read();
  }

  /**
   * Saves the hourly limit and the limit of scheduled tasks per chat.
   * @throws {AgentError} `profile_invalid` for a limit outside its range,
   * `profile_conflict` after a concurrent change.
   */
  public async save(
    actor: AccountAccess,
    input: AgentChatSettingsInput,
  ): Promise<void> {
    requireAgentAdministrator(actor);
    const { hourlyMessageLimit, revision } = input;
    if (!isInRange(hourlyMessageLimit, AGENT_CHAT_HOURLY_LIMIT_RANGE))
      throw new AgentError("profile_invalid");
    const scheduledTaskLimit =
      input.scheduledTaskLimit ??
      (await this.settings.read()).scheduledTaskLimit;
    if (!isInRange(scheduledTaskLimit, AGENT_CHAT_TASK_LIMIT_RANGE))
      throw new AgentError("profile_invalid");
    await this.writes.run(() =>
      this.settings.save({ hourlyMessageLimit, scheduledTaskLimit, revision }),
    );
  }
}
