import { logCaughtError } from "@/backend/logging/Logger";
import { PICA_MOBILE_CAPABILITY } from "@/definition/PicaMobileProtocol";

import type { PicaMobileCapability } from "@/definition/PicaMobileProtocol";
import type { PicaMobileConnectionOptions } from "./PicaMobileConnection";
import type { PicaMobileSessionIdentity } from "./PicaMobileDashboardProvider";

// `speech.v1` is named only while a speech model is set up for the account.
async function isSpeechAvailable(
  options: Pick<PicaMobileConnectionOptions, "speech">,
  session: PicaMobileSessionIdentity,
): Promise<boolean> {
  if (options.speech === undefined) return false;
  try {
    return await options.speech.isAvailable(session);
  } catch (error: unknown) {
    logCaughtError("PicaMobileConnection", error);

    return false;
  }
}

/**
 * Reads the extensions a connection answers, for its `connected` message.
 *
 * @param options - The providers of the connection; each one that is present
 * adds its extension.
 * @param session - The account and session the connection authenticated
 * with; `speech.v1` depends on them.
 * @returns The extensions; a push or speech recognition that cannot be
 * decided is not announced.
 */
export async function readPicaMobileCapabilities(
  options: Pick<
    PicaMobileConnectionOptions,
    | "dashboard"
    | "notifications"
    | "plans"
    | "chat"
    | "conversations"
    | "speech"
    | "calendar"
  >,
  session: PicaMobileSessionIdentity,
): Promise<readonly PicaMobileCapability[]> {
  const capabilities: PicaMobileCapability[] = [];
  const { dashboard, notifications, plans, chat, conversations } = options;

  if (dashboard !== undefined) {
    capabilities.push(PICA_MOBILE_CAPABILITY.DASHBOARD_V1);
  }

  if (plans !== undefined) {
    capabilities.push(
      PICA_MOBILE_CAPABILITY.PLANS_V1,
      PICA_MOBILE_CAPABILITY.PLANS_FLOW_V1,
    );
  }

  if (chat !== undefined) {
    capabilities.push(PICA_MOBILE_CAPABILITY.CHAT_V1);
  }

  if (chat?.canDelete === true) {
    capabilities.push(PICA_MOBILE_CAPABILITY.CHAT_DELETE);
  }

  if (conversations !== undefined) {
    capabilities.push(PICA_MOBILE_CAPABILITY.CONVERSATIONS_V1);
  }

  if (options.calendar !== undefined) {
    capabilities.push(PICA_MOBILE_CAPABILITY.CALENDAR_V1);
  }

  if (await isSpeechAvailable(options, session)) {
    capabilities.push(PICA_MOBILE_CAPABILITY.SPEECH_V1);
  }

  if (notifications === undefined) {
    return capabilities;
  }

  capabilities.push(
    PICA_MOBILE_CAPABILITY.NOTIFICATIONS_V1,
    PICA_MOBILE_CAPABILITY.NOTIFICATIONS_TEAM_V1,
  );

  try {
    if (await notifications.isPushAvailable()) {
      capabilities.push(PICA_MOBILE_CAPABILITY.NOTIFICATIONS_PUSH_FCM);
    }
  } catch (error: unknown) {
    logCaughtError("PicaMobileConnection", error);
  }

  return capabilities;
}
