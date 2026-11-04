import { PicaMobilePushRegistrationRepository } from "@/backend/database/repositories/mobile/PicaMobilePushRegistrationRepository";

import {
  ACCOUNT,
  OTHER_ACCOUNT,
  OUTBOX_STATE,
  outboxRow,
} from "./mobile-fixtures";
import {
  call,
  MISSING_TEXT,
  prepare,
  refused,
  refusedWithoutTable,
  reversedInPostgres,
} from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";
import type { PushRegistrationBinding } from "@/backend/database/repositories/mobile/PicaMobilePushRegistrationRepository";

const T1 = "2026-03-01T08:00:00.000Z";
const T2 = "2026-03-01T09:00:00.000Z";
const T3 = "2026-03-01T10:00:00.000Z";
const T4 = "2026-03-01T11:00:00.000Z";
const T5 = "2026-03-01T12:00:00.000Z";
const LIMIT = 3;

const BINDING: PushRegistrationBinding = {
  deviceId: "device-b",
  accountId: ACCOUNT,
  sessionId: "session-1",
  tokenFingerprint: "fingerprint-b",
  tokenEncrypted: "cipher-b",
  locale: "de",
  preview: "hidden",
  now: T1,
};

function registrations({
  database,
}: RepositoryWorld): PicaMobilePushRegistrationRepository {
  return new PicaMobilePushRegistrationRepository(database);
}

/** The push registrations of devices: renewal, takeover, limits and removal. */
export const MOBILE_REGISTRATION_FLOW: RepositoryFlow = {
  title: "mobile registrations",
  steps: [
    call("PicaMobilePushRegistrationRepository.find", (world) =>
      registrations(world).find("device-b"),
    ),
    call("PicaMobilePushRegistrationRepository.listAll", (world) =>
      registrations(world).listAll(),
    ),
    call("PicaMobilePushRegistrationRepository.bind", (world) =>
      registrations(world).bind(BINDING, LIMIT),
    ),
    call("PicaMobilePushRegistrationRepository.bind", (world) =>
      registrations(world).bind(
        {
          ...BINDING,
          deviceId: "device-a",
          tokenFingerprint: "fingerprint-a",
          locale: "en",
          preview: "details",
        },
        LIMIT,
      ),
    ),
    refused("PicaMobilePushRegistrationRepository.bind", (world) =>
      registrations(world).bind(
        { ...BINDING, deviceId: "device-none", sessionId: MISSING_TEXT },
        LIMIT,
      ),
    ),
    call("PicaMobilePushRegistrationRepository.listActivated", (world) =>
      registrations(world).listActivated(ACCOUNT),
    ),
    call("PicaMobilePushRegistrationRepository.activate", (world) =>
      registrations(world).activate(
        {
          deviceId: "device-b",
          accountId: OTHER_ACCOUNT,
          sessionId: "session-1",
        },
        T2,
      ),
    ),
    call("PicaMobilePushRegistrationRepository.activate", (world) =>
      registrations(world).activate(BINDING, T2),
    ),
    call("PicaMobilePushRegistrationRepository.activate", (world) =>
      registrations(world).activate(BINDING, T3),
    ),
    call("PicaMobilePushRegistrationRepository.activate", (world) =>
      registrations(world).activate({ ...BINDING, deviceId: "device-a" }, T2),
    ),
    call("PicaMobilePushRegistrationRepository.listActivated", (world) =>
      registrations(world).listActivated(ACCOUNT),
    ),
    reversedInPostgres("pica_mobile_push_registrations"),
    call("PicaMobilePushRegistrationRepository.listActivated", (world) =>
      registrations(world).listActivated(ACCOUNT),
    ),
    call("PicaMobilePushRegistrationRepository.listAll", (world) =>
      registrations(world).listAll(),
    ),
    // A renewal keeps the registration time and the activation.
    call("PicaMobilePushRegistrationRepository.bind", (world) =>
      registrations(world).bind(
        { ...BINDING, sessionId: "session-2", now: T2 },
        LIMIT,
      ),
    ),
    // Two devices hold one token, which only a direct write can leave behind.
    prepare(`
      INSERT INTO pica_mobile_push_registrations (
          device_id, account_id, session_id, token_fingerprint, token_encrypted,
          locale, preview, registered_at, renewed_at
      )
      VALUES
          ('device-moved-b', '${ACCOUNT}', 'session-1', 'fingerprint-moved', 'c', 'de', 'hidden', '${T1}', '${T1}'),
          ('device-moved-a', '${ACCOUNT}', 'session-1', 'fingerprint-moved', 'c', 'de', 'hidden', '${T1}', '${T1}');
    `),
    reversedInPostgres("pica_mobile_push_registrations"),
    call("PicaMobilePushRegistrationRepository.bind", (world) =>
      registrations(world).bind(
        {
          ...BINDING,
          deviceId: "device-c",
          tokenFingerprint: "fingerprint-moved",
          now: T2,
        },
        LIMIT,
      ),
    ),
    // The fourth device of the account displaces the one that was renewed longest ago.
    call("PicaMobilePushRegistrationRepository.bind", (world) =>
      registrations(world).bind(
        {
          ...BINDING,
          deviceId: "device-d",
          tokenFingerprint: "fingerprint-d",
          now: T3,
        },
        LIMIT,
      ),
    ),
    call("PicaMobilePushRegistrationRepository.listAll", (world) =>
      registrations(world).listAll(),
    ),
    outboxRow(
      { runId: "run-takeover", deviceId: "device-d", seq: 1 },
      { notBefore: T1, expiresAt: T5 },
    ),
    outboxRow(
      { runId: "run-takeover", deviceId: "device-c", seq: 1 },
      { notBefore: T1, expiresAt: T5 },
    ),
    outboxRow(
      { runId: "run-takeover", deviceId: "device-b", seq: 1 },
      { notBefore: T1, expiresAt: T5 },
    ),
    // Another account takes the device over: the binding starts again.
    call("PicaMobilePushRegistrationRepository.bind", (world) =>
      registrations(world).bind(
        {
          ...BINDING,
          deviceId: "device-b",
          accountId: OTHER_ACCOUNT,
          tokenFingerprint: "fingerprint-b2",
          now: T4,
        },
        LIMIT,
      ),
    ),
    call("PicaMobilePushRegistrationRepository.find", (world) =>
      registrations(world).find("device-b"),
    ),
    OUTBOX_STATE,
    call("PicaMobilePushRegistrationRepository.removeOwn", (world) =>
      registrations(world).removeOwn("device-d", OTHER_ACCOUNT, T4),
    ),
    OUTBOX_STATE,
    call("PicaMobilePushRegistrationRepository.removeOwn", (world) =>
      registrations(world).removeOwn("device-d", ACCOUNT, T4),
    ),
    OUTBOX_STATE,
    call("PicaMobilePushRegistrationRepository.removeOwn", (world) =>
      registrations(world).removeOwn("device-d", ACCOUNT, T4),
    ),
    call("PicaMobilePushRegistrationRepository.removeBinding", (world) =>
      registrations(world).removeBinding(
        {
          deviceId: "device-c",
          tokenFingerprint: "fingerprint-other",
          sessionId: "session-1",
        },
        T5,
      ),
    ),
    call("PicaMobilePushRegistrationRepository.removeBinding", (world) =>
      registrations(world).removeBinding(
        {
          deviceId: "device-c",
          tokenFingerprint: "fingerprint-moved",
          sessionId: "session-other",
        },
        T5,
      ),
    ),
    OUTBOX_STATE,
    call("PicaMobilePushRegistrationRepository.removeBinding", (world) =>
      registrations(world).removeBinding(
        {
          deviceId: "device-c",
          tokenFingerprint: "fingerprint-moved",
          sessionId: "session-1",
        },
        T5,
      ),
    ),
    OUTBOX_STATE,
    call("PicaMobilePushRegistrationRepository.removeBinding", (world) =>
      registrations(world).removeBinding(
        {
          deviceId: "device-unknown",
          tokenFingerprint: "x",
          sessionId: "x",
        },
        T5,
      ),
    ),
    call("PicaMobilePushRegistrationRepository.listAll", (world) =>
      registrations(world).listAll(),
    ),
    call("PicaMobilePushRegistrationRepository.bind", (world) =>
      registrations(world).bind(
        {
          ...BINDING,
          deviceId: "device-e",
          tokenFingerprint: "fingerprint-e",
          now: T5,
        },
        LIMIT,
      ),
    ),
    refusedWithoutTable(
      "PicaMobilePushRegistrationRepository.removeOwn",
      "pica_mobile_notification_deliveries",
      (transaction) =>
        new PicaMobilePushRegistrationRepository({
          ...transaction,
          transaction: (work) => work(transaction),
        }).removeOwn("device-e", ACCOUNT, T5),
    ),
    call("PicaMobilePushRegistrationRepository.find", (world) =>
      registrations(world).find("device-e"),
    ),
    prepare("DELETE FROM pica_mobile_notification_deliveries;"),
    prepare("DELETE FROM pica_mobile_push_registrations;"),
  ],
};
