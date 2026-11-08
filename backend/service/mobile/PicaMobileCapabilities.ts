import { logCaughtError } from "@/backend/logging/Logger";
import { PICA_MOBILE_CAPABILITY } from "@/definition/PicaMobileProtocol";

import type { PicaMobileCapability } from "@/definition/PicaMobileProtocol";
import type { PicaMobileConnectionOptions } from "./PicaMobileConnection";

/**
 * Reads the extensions a connection answers, for its `connected` message.
 *
 * @param options - The providers of the connection; each one that is present
 * adds its extension.
 * @returns The extensions; a push that cannot be decided is not announced.
 */
export async function readPicaMobileCapabilities(
  options: Pick<
    PicaMobileConnectionOptions,
    "dashboard" | "notifications" | "plans" | "chat"
  >,
): Promise<readonly PicaMobileCapability[]> {
  const capabilities: PicaMobileCapability[] = [];
  const { dashboard, notifications, plans, chat } = options;

  if (dashboard !== undefined) {
    capabilities.push(PICA_MOBILE_CAPABILITY.DASHBOARD_V1);
  }

  if (plans !== undefined) {
    capabilities.push(PICA_MOBILE_CAPABILITY.PLANS_V1);
  }

  if (chat !== undefined) {
    capabilities.push(PICA_MOBILE_CAPABILITY.CHAT_V1);
  }

  if (chat?.canDelete === true) {
    capabilities.push(PICA_MOBILE_CAPABILITY.CHAT_DELETE);
  }

  if (notifications === undefined) {
    return capabilities;
  }

  capabilities.push(PICA_MOBILE_CAPABILITY.NOTIFICATIONS_V1);

  try {
    if (await notifications.isPushAvailable()) {
      capabilities.push(PICA_MOBILE_CAPABILITY.NOTIFICATIONS_PUSH_FCM);
    }
  } catch (error: unknown) {
    logCaughtError("PicaMobileConnection", error);
  }

  return capabilities;
}
