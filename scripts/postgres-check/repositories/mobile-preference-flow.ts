import { PicaMobileNotificationPreferenceRepository } from "@/backend/database/repositories/mobile/PicaMobileNotificationPreferenceRepository";
import { PicaMobilePushRegistrationRepository } from "@/backend/database/repositories/mobile/PicaMobilePushRegistrationRepository";

import { ACCOUNT, OTHER_ACCOUNT } from "./mobile-fixtures";
import { call, MISSING_TEXT, prepare, refused, stored } from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";

const T1 = "2026-03-01T08:00:00.000Z";
const T2 = "2026-03-01T09:00:00.000Z";
const T3 = "2026-03-01T10:00:00.000Z";

function preferences({
  database,
}: RepositoryWorld): PicaMobileNotificationPreferenceRepository {
  return new PicaMobileNotificationPreferenceRepository(database);
}

/** The team choice of an account: off without a row, kept moment, off again, recipients with active devices only. */
export const MOBILE_PREFERENCE_FLOW: RepositoryFlow = {
  title: "mobile notification preferences",
  steps: [
    call("PicaMobileNotificationPreferenceRepository.find", (world) =>
      preferences(world).find(ACCOUNT),
    ),
    call(
      "PicaMobileNotificationPreferenceRepository.listTeamRecipients",
      (world) => preferences(world).listTeamRecipients(),
    ),
    call("PicaMobileNotificationPreferenceRepository.setTeamRuns", (world) =>
      preferences(world).setTeamRuns(ACCOUNT, true, T1),
    ),
    // Switching it on again keeps the first moment.
    call("PicaMobileNotificationPreferenceRepository.setTeamRuns", (world) =>
      preferences(world).setTeamRuns(ACCOUNT, true, T2),
    ),
    call("PicaMobileNotificationPreferenceRepository.setTeamRuns", (world) =>
      preferences(world).setTeamRuns(OTHER_ACCOUNT, false, T2),
    ),
    refused("PicaMobileNotificationPreferenceRepository.setTeamRuns", (world) =>
      preferences(world).setTeamRuns(MISSING_TEXT, true, T2),
    ),
    // Without an active device nobody is asked.
    call(
      "PicaMobileNotificationPreferenceRepository.listTeamRecipients",
      (world) => preferences(world).listTeamRecipients(),
    ),
    call("PicaMobilePushRegistrationRepository.bind", ({ database }) =>
      new PicaMobilePushRegistrationRepository(database).bind(
        {
          deviceId: "device-team",
          accountId: ACCOUNT,
          sessionId: "session-team",
          tokenFingerprint: "fingerprint-team",
          tokenEncrypted: "cipher-team",
          locale: "de",
          preview: "hidden",
          now: T1,
        },
        10,
      ),
    ),
    prepare(`
      UPDATE pica_mobile_push_registrations
      SET activated_at = '${T1}'
      WHERE device_id = 'device-team';
    `),
    call(
      "PicaMobileNotificationPreferenceRepository.listTeamRecipients",
      (world) => preferences(world).listTeamRecipients(),
    ),
    // Switching it off forgets the moment, so switching it on later never reaches back.
    call("PicaMobileNotificationPreferenceRepository.setTeamRuns", (world) =>
      preferences(world).setTeamRuns(ACCOUNT, false, T2),
    ),
    call("PicaMobileNotificationPreferenceRepository.setTeamRuns", (world) =>
      preferences(world).setTeamRuns(ACCOUNT, true, T3),
    ),
    stored(`
      SELECT
          account_id,
          team_runs,
          team_runs_since,
          updated_at
      FROM pica_mobile_notification_preferences
      ORDER BY account_id;
    `),
    prepare("DELETE FROM pica_mobile_push_registrations;"),
    prepare("DELETE FROM pica_mobile_notification_preferences;"),
  ],
};
