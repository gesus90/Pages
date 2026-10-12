import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { ChatError } from "@/backend/error/ChatErrors";
import { InstanceSettingsDeniedError } from "@/backend/service/InstanceSettingsService";
import { redactAssistantCredentials } from "@/backend/service/assistant/TextAssistantValidation";
import {
  CHAT_ATTACHMENT_LIMITS,
  CHAT_LIMITS,
  CHAT_MEBIBYTE,
} from "@/definition/Chat";

import { DEFAULT_CHAT_INSTRUCTION } from "./ChatSystemInstruction";

import type { AdministrationService } from "@/backend/service/AdministrationService";
import type { ChatSettingsRepository } from "@/backend/database/repositories/chat/ChatSettingsRepository";
import type { ChatAdministration, ChatSettings } from "@/definition/Chat";
import type { User } from "@/definition/User";

/** What an administrator changes in the system settings. */
export interface ChatSettingsUpdate {
  readonly attachmentLimitMegabytes: number;
  /** The new instruction; `null` returns to the built-in default. */
  readonly systemInstruction: string | null;
}

function readInstruction(input: string | null): string | null {
  if (input === null) return null;
  const instruction = input.trim();
  if (!instruction || instruction.length > CHAT_LIMITS.instructionCharacters)
    throw new ChatError("invalidSetting");
  // The instruction reaches the provider with every message, so it must not carry secrets.
  if (redactAssistantCredentials(instruction) !== instruction)
    throw new ChatError("credentialsInText");
  return instruction === DEFAULT_CHAT_INSTRUCTION.trim() ? null : instruction;
}

/** Administrator settings of the chat: attachment limit and system instruction (T6.12.4, T6.12.8). */
export class ChatSettingsService {
  private readonly repository: ChatSettingsRepository;
  private readonly accounts: Pick<AdministrationService, "getContext">;

  public constructor(
    repository: ChatSettingsRepository,
    accounts: Pick<AdministrationService, "getContext">,
  ) {
    this.repository = repository;
    this.accounts = accounts;
  }

  /** Returns the stored settings that apply to every chat. */
  public async read(): Promise<ChatSettings> {
    return this.repository.read();
  }

  /** Returns the instruction a chat turn starts with. */
  public async instruction(): Promise<string> {
    return (
      (await this.repository.read()).systemInstruction ??
      DEFAULT_CHAT_INSTRUCTION
    );
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
      attachmentLimitMegabytes: Math.round(
        settings.attachmentLimitBytes / CHAT_MEBIBYTE,
      ),
      systemInstruction: settings.systemInstruction ?? DEFAULT_CHAT_INSTRUCTION,
      isDefaultInstruction: settings.systemInstruction === null,
    };
  }

  /**
   * Replaces the settings.
   *
   * @throws {InstanceSettingsDeniedError} When the actor is no administrator in the admin mode.
   * @throws {ChatError} `invalidSetting` for a limit outside 1 to 512 MB or an
   * empty or too long instruction, `credentialsInText` for an instruction with credentials.
   */
  public async update(actor: User, update: ChatSettingsUpdate): Promise<void> {
    await this.requireAdministrator(actor);
    const megabytes = update.attachmentLimitMegabytes;
    if (
      !Number.isInteger(megabytes) ||
      megabytes < CHAT_ATTACHMENT_LIMITS.minimumMegabytes ||
      megabytes > CHAT_ATTACHMENT_LIMITS.maximumMegabytes
    )
      throw new ChatError("invalidSetting");
    await this.repository.save({
      attachmentLimitBytes: megabytes * CHAT_MEBIBYTE,
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
