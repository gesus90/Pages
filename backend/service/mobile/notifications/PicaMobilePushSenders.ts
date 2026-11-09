import { logEvent } from "@/backend/logging/Logger";

import { createFcmPicaMobilePushSender } from "./FcmPicaMobilePushSender";

import type {
  PicaMobilePushMessage,
  PicaMobilePushOutcome,
  PicaMobilePushSender,
} from "./PicaMobilePushSender";

const COMPONENT = "PicaMobilePushSenders";

/**
 * The push service of a development instance without FCM: it prints what it
 * would hand over, without the token, and reports it as sent.
 *
 * @remarks
 * The structured log keeps no texts, so title, body and data go to the
 * console of the development process, where the simulation is checked.
 */
class SimulatedPicaMobilePushSender implements PicaMobilePushSender {
  /** Is always ready; nothing leaves Pages. */
  public ready(): Promise<boolean> {
    return Promise.resolve(true);
  }

  /** Prints title, body, channel, tag and data of the push. */
  public send(message: PicaMobilePushMessage): Promise<PicaMobilePushOutcome> {
    logEvent({
      level: "info",
      event: "pica_mobile.push.simulated",
      component: COMPONENT,
      message: "Simulated push handed over instead of FCM",
      metadata: { kind: message.channelId },
    });
    console.info(
      `[pages] Simulated push: ${JSON.stringify({
        title: message.title,
        body: message.body,
        channelId: message.channelId,
        tag: message.tag,
        ttlSeconds: message.ttlSeconds,
        data: message.data,
      })}`,
    );
    return Promise.resolve({ kind: "sent" });
  }
}

/**
 * Chooses the push service of the process.
 *
 * @param fcmServiceAccountFile - The key file of FCM the operator named, or `null`.
 * @param environment - The environment, the process's own by default.
 * @returns With `PAGES_PUSH_SIMULATION=1` outside production a simulation that
 * only logs what it would hand over; otherwise FCM when its key file is
 * usable, else `null`.
 *
 * @remarks
 * With `NODE_ENV=production` the simulation switch is ignored and the
 * ignoring is logged.
 */
export function createPicaMobilePushSender(
  fcmServiceAccountFile: string | null,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PicaMobilePushSender | null {
  if (environment.PAGES_PUSH_SIMULATION === "1") {
    if (environment.NODE_ENV !== "production") {
      logEvent({
        level: "info",
        event: "pica_mobile.push.simulation_active",
        component: COMPONENT,
        message: "The push simulation is active; no push goes to FCM.",
      });
      return new SimulatedPicaMobilePushSender();
    }
    logEvent({
      level: "warn",
      event: "pica_mobile.push.simulation_ignored",
      component: COMPONENT,
      message:
        "PAGES_PUSH_SIMULATION is ignored because NODE_ENV is production.",
    });
  }
  return fcmServiceAccountFile === null
    ? null
    : createFcmPicaMobilePushSender(fcmServiceAccountFile);
}
