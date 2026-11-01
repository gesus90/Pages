import path from "node:path";

import { logEvent } from "@/backend/logging/Logger";
import {
  PICA_MOBILE_DEFAULT_REPLAY_TTL_SECONDS,
  PICA_MOBILE_REPLAY_TTL_RANGE_SECONDS,
} from "@/definition/PicaMobileNotifications";

import type { PagesConfig } from "@/backend/config/PagesConfig";

/** What an operator configures for Pica Mobile notifications. */
export interface PicaMobileNotificationSettings {
  /** Absolute path of the service-account key file; `null`: no push is offered. */
  readonly fcmServiceAccountFile: string | null;
  /** Seconds a notification stays worth delivering. */
  readonly replayTtlSeconds: number;
}

/** Environment variable that names the service-account key file; it wins over `config.toml`. */
export const PICA_MOBILE_FCM_FILE_VARIABLE = "PAGES_FCM_SERVICE_ACCOUNT_FILE";

/** Environment variable that sets the replay time; it wins over `config.toml`. */
export const PICA_MOBILE_REPLAY_TTL_VARIABLE =
  "PAGES_PICA_MOBILE_REPLAY_TTL_SECONDS";

function readKeyFile(
  config: Pick<PagesConfig, "picaMobileFcmServiceAccountFile">,
  environment: NodeJS.ProcessEnv,
): string | null {
  const fromEnvironment = environment[PICA_MOBILE_FCM_FILE_VARIABLE]?.trim();

  if (fromEnvironment === undefined || fromEnvironment === "") {
    return config.picaMobileFcmServiceAccountFile ?? null;
  }

  if (path.isAbsolute(fromEnvironment)) {
    return path.normalize(fromEnvironment);
  }

  logEvent({
    level: "warn",
    event: "pica_mobile.notifications.settings_invalid",
    component: "PicaMobileNotificationSettings",
    message: `${PICA_MOBILE_FCM_FILE_VARIABLE} must be an absolute path and is ignored.`,
    metadata: { reason: "relative_path" },
  });

  return config.picaMobileFcmServiceAccountFile ?? null;
}

function readReplayTtl(
  config: Pick<PagesConfig, "picaMobileReplayTtlSeconds">,
  environment: NodeJS.ProcessEnv,
): number {
  const text = environment[PICA_MOBILE_REPLAY_TTL_VARIABLE]?.trim();
  const fallback =
    config.picaMobileReplayTtlSeconds ?? PICA_MOBILE_DEFAULT_REPLAY_TTL_SECONDS;

  if (text === undefined || text === "") {
    return fallback;
  }

  const seconds = Number(text);
  const { minimum, maximum } = PICA_MOBILE_REPLAY_TTL_RANGE_SECONDS;

  if (Number.isInteger(seconds) && seconds >= minimum && seconds <= maximum) {
    return seconds;
  }

  logEvent({
    level: "warn",
    event: "pica_mobile.notifications.settings_invalid",
    component: "PicaMobileNotificationSettings",
    message: `${PICA_MOBILE_REPLAY_TTL_VARIABLE} must be a whole number from ${minimum} to ${maximum} and is ignored.`,
    metadata: { reason: "ttl_out_of_range" },
  });

  return fallback;
}

/**
 * Reads the notification settings of the operator.
 *
 * @param config - The Pages configuration.
 * @param environment - Environment variables; they win over the file.
 * @returns The key file and the replay time. A value that is not valid is
 * reported in the log and replaced by the next source, never silently used.
 */
export function readPicaMobileNotificationSettings(
  config: Pick<
    PagesConfig,
    "picaMobileFcmServiceAccountFile" | "picaMobileReplayTtlSeconds"
  >,
  environment: NodeJS.ProcessEnv = process.env,
): PicaMobileNotificationSettings {
  return {
    fcmServiceAccountFile: readKeyFile(config, environment),
    replayTtlSeconds: readReplayTtl(config, environment),
  };
}
