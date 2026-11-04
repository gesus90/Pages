import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type {
  PicaMobileNotificationLocale,
  PicaMobileNotificationPreview,
} from "@/definition/PicaMobileNotifications";

/** One registered device as it is stored. */
export interface PushRegistrationRecord {
  readonly deviceId: string;
  readonly accountId: string;
  readonly sessionId: string;
  readonly tokenFingerprint: string;
  readonly tokenEncrypted: string;
  readonly locale: PicaMobileNotificationLocale;
  readonly preview: PicaMobileNotificationPreview;
  readonly registeredAt: string;
  readonly renewedAt: string;
  /** Set once the registration answer reached the device; delivery starts then. */
  readonly activatedAt: string | null;
}

/** What a device presents when it registers. */
export interface PushRegistrationBinding {
  readonly deviceId: string;
  readonly accountId: string;
  readonly sessionId: string;
  readonly tokenFingerprint: string;
  readonly tokenEncrypted: string;
  readonly locale: PicaMobileNotificationLocale;
  readonly preview: PicaMobileNotificationPreview;
  /** The moment of the registration as ISO-8601 text. */
  readonly now: string;
}

/** The stored registration and the devices its binding displaced. */
export interface PushRegistrationBound {
  readonly registration: PushRegistrationRecord;
  readonly displacedDeviceIds: readonly string[];
}

const REGISTRATION_COLUMNS = `
    device_id,
    account_id,
    session_id,
    token_fingerprint,
    token_encrypted,
    locale,
    preview,
    registered_at,
    renewed_at,
    activated_at`;

type Executor = Pick<DatabaseTransaction, "execute" | "query">;

function readLocale(value: string): PicaMobileNotificationLocale {
  if (value === "de" || value === "en") {
    return value;
  }

  throw new Error('Database returned an invalid value for "locale".');
}

function readPreview(value: string): PicaMobileNotificationPreview {
  if (value === "hidden" || value === "details") {
    return value;
  }

  throw new Error('Database returned an invalid value for "preview".');
}

function toRegistration(row: readonly DatabaseValue[]): PushRegistrationRecord {
  return {
    deviceId: readTextColumn(row, 0, "device_id"),
    accountId: readTextColumn(row, 1, "account_id"),
    sessionId: readTextColumn(row, 2, "session_id"),
    tokenFingerprint: readTextColumn(row, 3, "token_fingerprint"),
    tokenEncrypted: readTextColumn(row, 4, "token_encrypted"),
    locale: readLocale(readTextColumn(row, 5, "locale")),
    preview: readPreview(readTextColumn(row, 6, "preview")),
    registeredAt: readTextColumn(row, 7, "registered_at"),
    renewedAt: readTextColumn(row, 8, "renewed_at"),
    activatedAt: readNullableTextColumn(row, 9, "activated_at"),
  };
}

async function findByDevice(
  executor: Executor,
  deviceId: string,
): Promise<PushRegistrationRecord | null> {
  const [row] = await executor.query(
    `
      SELECT${REGISTRATION_COLUMNS}
      FROM pica_mobile_push_registrations
      WHERE device_id = $device_id;
    `,
    { device_id: deviceId },
  );

  return row === undefined ? null : toRegistration(row);
}

/** Ends the pending pushes of devices whose registration is gone or replaced. */
async function dropPendingDeliveries(
  executor: Executor,
  deviceIds: readonly string[],
  now: string,
): Promise<void> {
  for (const deviceId of deviceIds) {
    await executor.execute(
      `
        UPDATE pica_mobile_notification_deliveries
        SET state = 'dropped',
            outcome = 'registration_ended',
            finished_at = $now
        WHERE device_id = $device_id
            AND state IN ('pending', 'sending');
      `,
      { device_id: deviceId, now },
    );
  }
}

async function deleteDevices(
  executor: Executor,
  deviceIds: readonly string[],
): Promise<void> {
  for (const deviceId of deviceIds) {
    await executor.execute(
      "DELETE FROM pica_mobile_push_registrations WHERE device_id = $device_id;",
      { device_id: deviceId },
    );
  }
}

/** A token belongs to one device: a row with the same token elsewhere is displaced. */
async function displaceMovedToken(
  executor: Executor,
  binding: PushRegistrationBinding,
): Promise<readonly string[]> {
  const rows = await executor.query(
    `
      SELECT device_id
      FROM pica_mobile_push_registrations
      WHERE token_fingerprint = $token_fingerprint
          AND device_id <> $device_id
      ORDER BY device_id;
    `,
    {
      token_fingerprint: binding.tokenFingerprint,
      device_id: binding.deviceId,
    },
  );

  return rows.map((row) => readTextColumn(row, 0, "device_id"));
}

async function writeBinding(
  executor: Executor,
  binding: PushRegistrationBinding,
  existing: PushRegistrationRecord | null,
): Promise<void> {
  if (existing === null) {
    await executor.execute(
      `
        INSERT INTO pica_mobile_push_registrations (
            device_id,
            account_id,
            session_id,
            token_fingerprint,
            token_encrypted,
            locale,
            preview,
            registered_at,
            renewed_at,
            activated_at
        ) VALUES (
            $device_id,
            $account_id,
            $session_id,
            $token_fingerprint,
            $token_encrypted,
            $locale,
            $preview,
            $now,
            $now,
            NULL
        );
      `,
      toParameters(binding),
    );

    return;
  }

  // Another account takes the device over: the binding starts again and waits for its answer.
  const isRenewal = existing.accountId === binding.accountId;

  await executor.execute(
    `
      UPDATE pica_mobile_push_registrations
      SET account_id = $account_id,
          session_id = $session_id,
          token_fingerprint = $token_fingerprint,
          token_encrypted = $token_encrypted,
          locale = $locale,
          preview = $preview,
          registered_at = CASE WHEN $is_renewal THEN registered_at ELSE $now END,
          renewed_at = $now,
          activated_at = CASE WHEN $is_renewal THEN activated_at ELSE NULL END
      WHERE device_id = $device_id;
    `,
    { ...toParameters(binding), is_renewal: isRenewal },
  );
}

function toParameters(
  binding: PushRegistrationBinding,
): Record<string, string> {
  return {
    device_id: binding.deviceId,
    account_id: binding.accountId,
    session_id: binding.sessionId,
    token_fingerprint: binding.tokenFingerprint,
    token_encrypted: binding.tokenEncrypted,
    locale: binding.locale,
    preview: binding.preview,
    now: binding.now,
  };
}

/** The oldest registrations beyond the limit; the one that was just written stays. */
async function selectOverLimit(
  executor: Executor,
  binding: PushRegistrationBinding,
  maximum: number,
): Promise<readonly string[]> {
  const rows = await executor.query(
    `
      SELECT device_id
      FROM pica_mobile_push_registrations
      WHERE account_id = $account_id
      ORDER BY renewed_at ASC, registered_at ASC, device_id ASC;
    `,
    { account_id: binding.accountId },
  );
  const deviceIds = rows.map((row) => readTextColumn(row, 0, "device_id"));
  const excess = Math.max(0, deviceIds.length - maximum);

  return deviceIds
    .filter((deviceId) => deviceId !== binding.deviceId)
    .slice(0, excess);
}

/**
 * Persistence of the push registrations of Pica Mobile devices.
 *
 * @remarks
 * A device identifier and a token each belong to one registration. Every
 * change that ends a registration also ends its pending pushes in the same
 * transaction, so nothing is dispatched for a binding that no longer holds.
 */
export class PicaMobilePushRegistrationRepository {
  private readonly database: Pick<
    Database,
    "execute" | "query" | "transaction"
  >;

  /**
   * Creates the repository.
   *
   * @param database - Central database access.
   */
  public constructor(
    database: Pick<Database, "execute" | "query" | "transaction">,
  ) {
    this.database = database;
  }

  /**
   * Stores a registration, replacing what it displaces.
   *
   * @param binding - Device, account, session and token to bind.
   * @param maximumPerAccount - Registrations one account keeps.
   * @returns The stored registration and the other devices that lost theirs.
   *
   * @remarks
   * A renewal of the same account on the same device keeps `registeredAt` and
   * an existing activation. A device that another account takes over, or a
   * token that moves to another device, replaces the older binding at once.
   */
  public async bind(
    binding: PushRegistrationBinding,
    maximumPerAccount: number,
  ): Promise<PushRegistrationBound> {
    return this.database.transaction(async (transaction) => {
      const existing = await findByDevice(transaction, binding.deviceId);
      const moved = await displaceMovedToken(transaction, binding);

      await writeBinding(transaction, binding, existing);
      await deleteDevices(transaction, moved);

      const overLimit = await selectOverLimit(
        transaction,
        binding,
        maximumPerAccount,
      );
      const displaced = [...moved, ...overLimit];

      await deleteDevices(transaction, overLimit);

      const isTakenOver =
        existing !== null && existing.accountId !== binding.accountId;

      await dropPendingDeliveries(
        transaction,
        isTakenOver ? [...displaced, binding.deviceId] : displaced,
        binding.now,
      );

      const registration = await findByDevice(transaction, binding.deviceId);

      if (registration === null) {
        throw new Error("The push registration was not stored.");
      }

      return { registration, displacedDeviceIds: displaced };
    });
  }

  /**
   * Starts delivery for a registration once its answer reached the device.
   *
   * @param registration - The registration the answer belongs to.
   * @param now - The moment of the activation as ISO-8601 text.
   *
   * @remarks
   * Nothing changes when the registration was removed or replaced meanwhile.
   */
  public async activate(
    registration: Pick<
      PushRegistrationRecord,
      "deviceId" | "accountId" | "sessionId"
    >,
    now: string,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE pica_mobile_push_registrations
        SET activated_at = $now
        WHERE device_id = $device_id
            AND account_id = $account_id
            AND session_id = $session_id
            AND activated_at IS NULL;
      `,
      {
        device_id: registration.deviceId,
        account_id: registration.accountId,
        session_id: registration.sessionId,
        now,
      },
    );
  }

  /**
   * Removes the registration of an account's own device.
   *
   * @param deviceId - Device to remove.
   * @param accountId - Account that asks; a device of another account stays.
   * @param now - The moment of the removal as ISO-8601 text.
   */
  public async removeOwn(
    deviceId: string,
    accountId: string,
    now: string,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const existing = await findByDevice(transaction, deviceId);

      if (existing === null || existing.accountId !== accountId) {
        return;
      }

      await deleteDevices(transaction, [deviceId]);
      await dropPendingDeliveries(transaction, [deviceId], now);
    });
  }

  /**
   * Removes a registration whose token the push service refused or whose
   * session ended.
   *
   * @param registration - The binding observed when the problem arose.
   * @param now - The moment of the removal as ISO-8601 text.
   *
   * @remarks
   * Only exactly that binding goes: a device that registered a new token or
   * session meanwhile keeps its registration.
   */
  public async removeBinding(
    registration: Pick<
      PushRegistrationRecord,
      "deviceId" | "tokenFingerprint" | "sessionId"
    >,
    now: string,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const existing = await findByDevice(transaction, registration.deviceId);

      if (
        existing === null ||
        existing.tokenFingerprint !== registration.tokenFingerprint ||
        existing.sessionId !== registration.sessionId
      ) {
        return;
      }

      await deleteDevices(transaction, [registration.deviceId]);
      await dropPendingDeliveries(transaction, [registration.deviceId], now);
    });
  }

  /** Reads one registration. */
  public async find(deviceId: string): Promise<PushRegistrationRecord | null> {
    return findByDevice(this.database, deviceId);
  }

  /** Lists the activated registrations of an account. */
  public async listActivated(
    accountId: string,
  ): Promise<readonly PushRegistrationRecord[]> {
    const rows = await this.database.query(
      `
        SELECT${REGISTRATION_COLUMNS}
        FROM pica_mobile_push_registrations
        WHERE account_id = $account_id
            AND activated_at IS NOT NULL
        ORDER BY registered_at ASC, device_id ASC;
      `,
      { account_id: accountId },
    );

    return rows.map((row) => toRegistration(row));
  }

  /** Lists every registration, for the periodic check of their sessions. */
  public async listAll(): Promise<readonly PushRegistrationRecord[]> {
    const rows = await this.database.query(
      `
        SELECT${REGISTRATION_COLUMNS}
        FROM pica_mobile_push_registrations
        ORDER BY registered_at ASC, device_id ASC;
      `,
    );

    return rows.map((row) => toRegistration(row));
  }
}
