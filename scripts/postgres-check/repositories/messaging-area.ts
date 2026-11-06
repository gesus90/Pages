import { ChatAcpSessionRepository } from "@/backend/database/repositories/chat/ChatAcpSessionRepository";
import { ChatAttachmentRepository } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import { ChatContextRepository } from "@/backend/database/repositories/chat/ChatContextRepository";
import { ChatJobRepository } from "@/backend/database/repositories/chat/ChatJobRepository";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { ChatSettingsRepository } from "@/backend/database/repositories/chat/ChatSettingsRepository";
import { ChatSteerRepository } from "@/backend/database/repositories/chat/ChatSteerRepository";
import { PicaSettingsRepository } from "@/backend/database/repositories/chat/PicaSettingsRepository";
import { DiscordAttemptRepository } from "@/backend/database/repositories/discord/DiscordAttemptRepository";
import { DiscordConnectionRepository } from "@/backend/database/repositories/discord/DiscordConnectionRepository";
import { DiscordDeliveryRepository } from "@/backend/database/repositories/discord/DiscordDeliveryRepository";
import { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import { PicaMobileNotificationDeliveryRepository } from "@/backend/database/repositories/mobile/PicaMobileNotificationDeliveryRepository";
import { PicaMobileNotificationEventRepository } from "@/backend/database/repositories/mobile/PicaMobileNotificationEventRepository";
import { PicaMobilePushRegistrationRepository } from "@/backend/database/repositories/mobile/PicaMobilePushRegistrationRepository";

import {
  CHAT_ATTACHMENT_FLOW,
  CHAT_CONTEXT_FLOW,
  CHAT_SESSION_FLOW,
} from "./chat-flows";
import {
  CHAT_ACP_FLOW,
  CHAT_JOB_FLOW,
  CHAT_SETTINGS_FLOW,
  CHAT_STEER_FLOW,
} from "./chat-job-flows";
import {
  DISCORD_ATTEMPT_FLOW,
  DISCORD_CONNECTION_FLOW,
  DISCORD_DELIVERY_FLOW,
} from "./discord-flows";
import { RUN_CREDENTIAL_FLOW } from "./mcp-flows";
import { MOBILE_DELIVERY_FLOW, MOBILE_EVENT_FLOW } from "./mobile-flows";
import { MESSAGING_ORDER_FLOW } from "./messaging-order-flow";
import { MOBILE_REGISTRATION_FLOW } from "./mobile-registration-flows";
import { NUL_TEXT_FLOW } from "./nul-text-flow";

import type { RepositoryFlow } from "./world";

/** The flows of Pica sessions, Discord delivery, agent credentials and Pica Mobile. */
export const MESSAGING_AREA_FLOWS: readonly RepositoryFlow[] = [
  CHAT_SESSION_FLOW,
  CHAT_ATTACHMENT_FLOW,
  CHAT_CONTEXT_FLOW,
  CHAT_JOB_FLOW,
  CHAT_STEER_FLOW,
  CHAT_ACP_FLOW,
  CHAT_SETTINGS_FLOW,
  DISCORD_ATTEMPT_FLOW,
  DISCORD_CONNECTION_FLOW,
  DISCORD_DELIVERY_FLOW,
  RUN_CREDENTIAL_FLOW,
  MOBILE_REGISTRATION_FLOW,
  MOBILE_EVENT_FLOW,
  MOBILE_DELIVERY_FLOW,
  NUL_TEXT_FLOW,
  MESSAGING_ORDER_FLOW,
];

/** The classes of these directories, whose methods are watched while the flows run. */
export const MESSAGING_AREA_CLASSES: Readonly<
  Record<string, { readonly prototype: object }>
> = {
  ChatAcpSessionRepository,
  ChatAttachmentRepository,
  ChatContextRepository,
  ChatJobRepository,
  ChatSessionRepository,
  ChatSettingsRepository,
  ChatSteerRepository,
  PicaSettingsRepository,
  DiscordAttemptRepository,
  DiscordConnectionRepository,
  DiscordDeliveryRepository,
  AgentRunCredentialRepository,
  PicaMobileNotificationDeliveryRepository,
  PicaMobileNotificationEventRepository,
  PicaMobilePushRegistrationRepository,
};
