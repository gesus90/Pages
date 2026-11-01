import { PICA_MOBILE_MAXIMUM_REGISTRATIONS_PER_ACCOUNT } from "@/definition/PicaMobileNotifications";

import type { PicaMobilePushRegistrationRepository } from "@/backend/database/repositories/mobile/PicaMobilePushRegistrationRepository";
import type {
  PicaMobileNotificationLocale,
  PicaMobileNotificationPreview,
  PicaMobileNotificationRegisteredPayload,
} from "@/definition/PicaMobileNotifications";
import type { PicaMobilePushTokenVault } from "./PicaMobilePushTokenVault";

/** What an authenticated device asks to register. */
export interface PicaMobileRegistrationRequest {
  /** The account of the authenticated connection; never taken from the message. */
  readonly accountId: string;
  /** The session the connection authenticated with. */
  readonly sessionId: string;
  readonly deviceId: string;
  /** The confidential native push token. */
  readonly token: string;
  readonly locale: PicaMobileNotificationLocale;
  readonly preview: PicaMobileNotificationPreview;
}

/** A stored registration whose answer has not reached the device yet. */
export interface PicaMobileRegistrationResult {
  readonly payload: PicaMobileNotificationRegisteredPayload;
  /**
   * Starts delivery for the registration.
   *
   * @remarks
   * Call it once the answer is handed to the connection. A registration whose
   * answer is lost stays inactive, so nothing is pushed to a device that does
   * not know it is registered; the device registers again and gets an answer.
   */
  readonly activate: () => Promise<void>;
}

/** What the registration service is created with. */
export interface PicaMobilePushRegistrationsOptions {
  readonly repository: PicaMobilePushRegistrationRepository;
  readonly vault: PicaMobilePushTokenVault;
  /** Identifies this Pages instance; stable across restarts. */
  readonly instanceId: () => Promise<string>;
  readonly replayTtlSeconds: number;
  readonly now?: () => Date;
}

/**
 * Registers and unregisters the push tokens of devices.
 *
 * @remarks
 * The recipient is always the account of the authenticated connection. A
 * repeated registration of the same binding only renews it and keeps its
 * start; a token or device that moves to another account replaces the older
 * binding at once, and an account keeps at most ten devices.
 */
export class PicaMobilePushRegistrations {
  private readonly options: PicaMobilePushRegistrationsOptions;
  private readonly now: () => Date;

  /**
   * Creates the service.
   *
   * @param options - Persistence, token protection and the replay time.
   */
  public constructor(options: PicaMobilePushRegistrationsOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Registers a device, or renews its registration.
   *
   * @param request - The device and the authenticated account and session.
   * @returns The answer for the device and the step that starts delivery.
   */
  public async register(
    request: PicaMobileRegistrationRequest,
  ): Promise<PicaMobileRegistrationResult> {
    const { repository, vault } = this.options;
    const bound = await repository.bind(
      {
        deviceId: request.deviceId,
        accountId: request.accountId,
        sessionId: request.sessionId,
        tokenFingerprint: vault.fingerprint(request.token),
        tokenEncrypted: vault.encrypt(request.deviceId, request.token),
        locale: request.locale,
        preview: request.preview,
        now: this.now().toISOString(),
      },
      PICA_MOBILE_MAXIMUM_REGISTRATIONS_PER_ACCOUNT,
    );
    const { registration } = bound;

    return {
      payload: {
        deviceId: registration.deviceId,
        instanceId: await this.options.instanceId(),
        accountId: registration.accountId,
        registeredAt: registration.registeredAt,
        replayTtlSeconds: this.options.replayTtlSeconds,
      },
      activate: () =>
        repository.activate(registration, this.now().toISOString()),
    };
  }

  /**
   * Removes the registration of a device of the account.
   *
   * @param accountId - The authenticated account.
   * @param deviceId - The device.
   *
   * @remarks
   * An unknown device and a device of another account change nothing, so the
   * caller can answer both alike. A message already handed to the push
   * service cannot be called back.
   */
  public async unregister(accountId: string, deviceId: string): Promise<void> {
    await this.options.repository.removeOwn(
      deviceId,
      accountId,
      this.now().toISOString(),
    );
  }
}
