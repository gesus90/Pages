import { ConversationError } from "@/backend/error/ConversationError";
import { readConversationIdentifier } from "@/backend/service/conversation/ConversationReader";

import type { McpDeviceService } from "@/backend/service/mcp/McpDeviceService";
import type { ConversationReplySettingsService } from "@/backend/service/conversation/ConversationReplySettingsService";
import type { UserService } from "@/backend/service/UserService";
import type { ConversationReplySettingsView } from "@/definition/ConversationDecision";
import type { User } from "@/definition/User";

/** What the conversation API needs beyond the services: the token check and the accounts. */
export interface McpConversationAccess {
  readonly devices: Pick<McpDeviceService, "authenticate">;
  readonly accounts: Pick<UserService, "findCredentialsByUsername">;
}

/**
 * The settings "Wer antwortet?" of group chats for the stand-alone Pages MCP
 * program (PAGE-317).
 *
 * @remarks
 * A paired machine acts with the rights of the account that confirmed the
 * pairing, checked again on every request: it reads the settings of a group
 * it belongs to and changes them only where the account manages the group,
 * exactly as the chat page does, because both call the same service.
 */
export class McpConversationApi {
  private readonly settings: Pick<
    ConversationReplySettingsService,
    "read" | "save"
  >;
  private readonly access: McpConversationAccess;

  /**
   * Creates the API.
   *
   * @param settings - The service of the chat page.
   * @param access - The device token check and the account lookup.
   */
  public constructor(
    settings: Pick<ConversationReplySettingsService, "read" | "save">,
    access: McpConversationAccess,
  ) {
    this.settings = settings;
    this.access = access;
  }

  /**
   * Checks the token of a request and names the account it acts for.
   *
   * @param authorization - The `Authorization` header of the request.
   * @returns The paired account.
   * @throws {McpDeviceError} `invalid_token` for a missing, unknown or revoked token.
   * @throws {ConversationError} `forbidden` when the account is gone or deactivated.
   */
  public async authenticate(authorization: string | null): Promise<User> {
    const identity = await this.access.devices.authenticate(authorization);
    const credentials = await this.access.accounts.findCredentialsByUsername(
      identity.account.username,
    );
    const account = credentials?.user ?? null;
    if (account === null || !account.isActive)
      throw new ConversationError("forbidden");
    return account;
  }

  /**
   * Reads the settings of a group.
   *
   * @throws {ConversationError} `not_found` for a conversation the account is no member of or that is no group.
   */
  public read(
    account: User,
    conversationId: string,
  ): Promise<ConversationReplySettingsView> {
    return this.settings.read(account, conversationId);
  }

  /**
   * Changes the settings of a group; a field the body leaves out keeps its value.
   *
   * @param account - The paired account.
   * @param conversationId - The group.
   * @param body - `mode`, `defaultResponderId` (`null` for none) and `maximumResponders`.
   * @returns The stored settings.
   * @throws {ConversationError} As {@link ConversationReplySettingsService.save}.
   */
  public async set(
    account: User,
    conversationId: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<ConversationReplySettingsView> {
    const id = readConversationIdentifier(conversationId);
    const current = await this.settings.read(account, id);
    return this.settings.save(account, {
      conversationId: id,
      mode: body.mode ?? current.mode,
      defaultResponderId:
        body.defaultResponderId === undefined
          ? current.defaultResponderId
          : body.defaultResponderId,
      maximumResponders: body.maximumResponders ?? current.maximumResponders,
      automaticRepliesPerOrigin:
        body.automaticRepliesPerOrigin ?? current.automaticRepliesPerOrigin,
    });
  }
}
