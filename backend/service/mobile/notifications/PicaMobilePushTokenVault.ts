import { createHmac, hkdfSync } from "node:crypto";

import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";

const FINGERPRINT_PURPOSE = "pages:pica-mobile-push-fingerprint:v1";
const BINDING_PREFIX = "pica-push:";

/**
 * Keeps the native push tokens of devices private.
 *
 * @remarks
 * A token is encrypted with the key the instance already uses for its
 * connection secrets and bound to its device, so a stored value cannot be
 * moved to another row. The fingerprint is a keyed hash that lets Pages find
 * the same token on another device without decrypting anything. Neither the
 * token nor its fingerprint is ever logged.
 */
export class PicaMobilePushTokenVault {
  private readonly cipher: InstanceSecretCipher;
  private readonly fingerprintKey: Buffer;

  /**
   * Creates the vault.
   *
   * @param instanceKey - The key of the instance for its private data.
   */
  public constructor(instanceKey: Buffer) {
    this.cipher = new InstanceSecretCipher(instanceKey);
    this.fingerprintKey = Buffer.from(
      hkdfSync("sha256", instanceKey, "", FINGERPRINT_PURPOSE, 32),
    );
  }

  /**
   * Encrypts the token of a device.
   *
   * @param deviceId - The device the token belongs to.
   * @param token - The native push token.
   * @returns The stored form, which names its version and holds a fresh nonce.
   */
  public encrypt(deviceId: string, token: string): string {
    return this.cipher.encrypt(`${BINDING_PREFIX}${deviceId}`, token);
  }

  /**
   * Decrypts the token of a device.
   *
   * @param deviceId - The device the stored form belongs to.
   * @param stored - The stored form.
   * @returns The token, or `null` when the stored form is damaged, belongs to
   * another device, or was written with another key.
   */
  public decrypt(deviceId: string, stored: string): string | null {
    try {
      return this.cipher.decrypt(`${BINDING_PREFIX}${deviceId}`, stored);
    } catch {
      // The cipher already logged the failure without any content.
      return null;
    }
  }

  /**
   * Computes the keyed fingerprint of a token.
   *
   * @param token - The native push token.
   * @returns A hexadecimal digest that is equal for equal tokens only.
   */
  public fingerprint(token: string): string {
    return createHmac("sha256", this.fingerprintKey)
      .update(token)
      .digest("hex");
  }
}
