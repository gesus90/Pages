import { prepare, stored } from "./world";

import type { RepositoryStep } from "./world";

export const ACCOUNT = "user-mobile";
export const OTHER_ACCOUNT = "user-mobile-other";
const CREATED_AT = "2026-03-01T08:00:00.000Z";

/**
 * A row of the outbox, because the times decide what is due.
 *
 * @param key - Its run, device and sequence number.
 * @param times - When it is due and when it ends.
 * @returns The step.
 */
export function outboxRow(
  key: {
    readonly runId: string;
    readonly deviceId: string;
    readonly seq: number;
  },
  times: { readonly notBefore: string; readonly expiresAt: string },
): RepositoryStep {
  return prepare(
    `
    INSERT INTO pica_mobile_notification_deliveries (
        delivery_id,
        event_id,
        device_id,
        account_id,
        run_id,
        event_type,
        seq,
        state,
        attempts,
        not_before,
        expires_at,
        created_at
    )
    VALUES (
        $delivery_id,
        'event-outbox',
        $device_id,
        '${ACCOUNT}',
        $run_id,
        'step_started',
        $seq,
        'pending',
        0,
        $not_before,
        $expires_at,
        '${CREATED_AT}'
    );
  `,
    {
      delivery_id: `outbox-${key.runId}-${key.deviceId}-${String(key.seq)}`,
      device_id: key.deviceId,
      run_id: key.runId,
      seq: key.seq,
      not_before: times.notBefore,
      expires_at: times.expiresAt,
    },
  );
}

/** What became of the rows of {@link outboxRow}. */
export const OUTBOX_STATE = stored(`
  SELECT
      delivery_id,
      state,
      attempts,
      not_before,
      locked_until,
      outcome,
      finished_at
  FROM pica_mobile_notification_deliveries
  WHERE delivery_id LIKE 'outbox-%'
  ORDER BY delivery_id;
`);
