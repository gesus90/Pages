import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { ChatError } from "@/backend/error/ChatErrors";
import { InstanceSettingsDeniedError } from "@/backend/service/InstanceSettingsService";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { CHAT_LIMITS } from "@/definition/Chat";

import type { AdministrationService } from "@/backend/service/AdministrationService";
import type { ChatSettingsRepository } from "@/backend/database/repositories/chat/ChatSettingsRepository";
import type { ChatAdministration } from "@/definition/Chat";
import type { User } from "@/definition/User";

/** What an administrator changes in the system settings. */
export interface ChatSettingsUpdate {
  /** The new supplement; `null` or an empty text removes it. */
  readonly systemInstruction: string | null;
}

function readInstruction(input: string | null): string | null {
  const instruction = input?.trim() ?? "";
  // Without a supplement Pica works with its protected files alone.
  if (!instruction) return null;
  if (instruction.length > CHAT_LIMITS.instructionCharacters)
    throw new ChatError("invalidSetting");
  // The supplement reaches the provider with every message, so it must not carry secrets.
  if (redactCredentials(instruction) !== instruction)
    throw new ChatError("credentialsInText");
  return instruction;
}

/**
 * Administrator settings of the chat: the supplement to Pica's instructions
 * (T6.12.8). The attachment limit is fixed (PAGE-251).
 *
 * @remarks
 * Pica's protected `SOUL.md` and `AGENTS.md` are no setting (PAGE-51): no
 * method here or anywhere else in Pages reads them for editing or writes them.
 * The supplement only adds to them.
 */
export class ChatSettingsService {
  private readonly repository: Pick<ChatSettingsRepository, "read" | "save">;
  private readonly accounts: Pick<AdministrationService, "getContext">;

  public constructor(
    repository: Pick<ChatSettingsRepository, "read" | "save">,
    accounts: Pick<AdministrationService, "getContext">,
  ) {
    this.repository = repository;
    this.accounts = accounts;
  }

  /** Returns the supplement a chat turn adds below Pica's protected files, or `null`. */
  public async instruction(): Promise<string | null> {
    return (await this.repository.read()).systemInstruction;
  }

  /**
   * Returns the settings for the system settings page.
   *
   * @throws {InstanceSettingsDeniedError} When the actor is no administrator in the admin mode.
   */
  public async administration(actor: User): Promise<ChatAdministration> {
    await this.requireAdministrator(actor);
    const settings = await this.repository.read();
    return {
      systemInstruction: settings.systemInstruction ?? "",
      isDefaultInstruction: settings.systemInstruction === null,
    };
  }

  /**
   * Replaces the settings.
   *
   * @throws {InstanceSettingsDeniedError} When the actor is no administrator in the admin mode.
   * @throws {ChatError} `invalidSetting` for a too long supplement,
   * `credentialsInText` for a supplement with credentials.
   */
  public async update(actor: User, update: ChatSettingsUpdate): Promise<void> {
    await this.requireAdministrator(actor);
    await this.repository.save({
      systemInstruction: readInstruction(update.systemInstruction),
    });
  }

  /** The same rule as every system setting: a current administrator in the admin mode. */
  private async requireAdministrator(actor: User): Promise<void> {
    const account = await this.accounts.getContext(actor.id);
    if (!new UserPolicyService().isAdministrator(account))
      throw new InstanceSettingsDeniedError();
  }
}
