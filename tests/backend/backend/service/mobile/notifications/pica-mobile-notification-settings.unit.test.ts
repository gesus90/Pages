import { expect, it } from "vitest";

import {
  readPicaMobileNotificationSettings,
  PICA_MOBILE_FCM_FILE_VARIABLE,
  PICA_MOBILE_REPLAY_TTL_VARIABLE,
} from "@/backend/service/mobile/notifications/PicaMobileNotificationSettings";
import {
  PICA_MOBILE_DEFAULT_REPLAY_TTL_SECONDS,
  PICA_MOBILE_REPLAY_TTL_RANGE_SECONDS,
} from "@/definition/PicaMobileNotifications";

it("uses configured defaults when environment values are absent", () => {
  expect(readPicaMobileNotificationSettings({}, {})).toEqual({
    fcmServiceAccountFile: null,
    replayTtlSeconds: PICA_MOBILE_DEFAULT_REPLAY_TTL_SECONDS,
  });
});

it("accepts absolute paths and bounded integral environment values", () => {
  expect(
    readPicaMobileNotificationSettings(
      {},
      {
        [PICA_MOBILE_FCM_FILE_VARIABLE]: " /a/../key.json ",
        [PICA_MOBILE_REPLAY_TTL_VARIABLE]: String(
          PICA_MOBILE_REPLAY_TTL_RANGE_SECONDS.minimum,
        ),
      },
    ),
  ).toEqual({
    fcmServiceAccountFile: "/key.json",
    replayTtlSeconds: PICA_MOBILE_REPLAY_TTL_RANGE_SECONDS.minimum,
  });
});

it.each([
  "-1",
  "1.5",
  "invalid",
  String(PICA_MOBILE_REPLAY_TTL_RANGE_SECONDS.maximum + 1),
])("falls back for invalid TTL and relative paths", (ttl) => {
  expect(
    readPicaMobileNotificationSettings(
      {
        picaMobileFcmServiceAccountFile: "/configured.json",
        picaMobileReplayTtlSeconds: 123,
      },
      {
        [PICA_MOBILE_FCM_FILE_VARIABLE]: "relative.json",
        [PICA_MOBILE_REPLAY_TTL_VARIABLE]: ttl,
      },
    ),
  ).toEqual({
    fcmServiceAccountFile: "/configured.json",
    replayTtlSeconds: 123,
  });
});
