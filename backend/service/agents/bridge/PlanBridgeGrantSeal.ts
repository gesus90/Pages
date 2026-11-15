import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const CIPHER = "aes-256-gcm";
const KEY_INFO = "pages plan bridge grant v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** What a sealed credential is bound to; a row moved to another step cannot be opened. */
export interface PlanBridgeSealBinding {
  readonly runId: string;
  readonly stepId: string;
  readonly instanceId: string;
  readonly expiresAt: number;
}

function sealKey(bearer: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", bearer, Buffer.alloc(0), KEY_INFO, KEY_BYTES),
  );
}

function associatedData(binding: PlanBridgeSealBinding): Buffer {
  return Buffer.from(
    JSON.stringify([
      binding.runId,
      binding.stepId,
      binding.instanceId,
      binding.expiresAt,
    ]),
  );
}

/**
 * The lookup key of a bearer; it finds a grant but opens nothing.
 *
 * @param bearer - The bearer of a session.
 * @returns The SHA-256 of the bearer in hex.
 */
export function planBridgeBearerHash(bearer: string): string {
  return createHash("sha256").update(bearer).digest("hex");
}

/**
 * Seals the step credential of a grant with a key only its bearer yields.
 *
 * @param bearer - The bearer the session receives; it is never stored.
 * @param token - The clear step credential.
 * @param binding - The run, step, instance and expiry the grant is bound to.
 * @returns IV, authentication tag and cipher text in base64url.
 */
export function sealPlanBridgeToken(
  bearer: string,
  token: string,
  binding: PlanBridgeSealBinding,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, sealKey(bearer), iv);
  cipher.setAAD(associatedData(binding));
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}

/**
 * Opens a sealed step credential with the bearer a session presents.
 *
 * @param bearer - The presented bearer.
 * @param sealed - The stored seal.
 * @param binding - The run, step, instance and expiry of the stored grant.
 * @returns The clear credential, or `null` when the bearer, the binding or the seal does not match.
 */
export function openPlanBridgeToken(
  bearer: string,
  sealed: string,
  binding: PlanBridgeSealBinding,
): string | null {
  const bytes = Buffer.from(sealed, "base64url");
  if (bytes.length <= IV_BYTES + TAG_BYTES) return null;
  const decipher = createDecipheriv(
    CIPHER,
    sealKey(bearer),
    bytes.subarray(0, IV_BYTES),
  );
  decipher.setAAD(associatedData(binding));
  decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  try {
    return Buffer.concat([
      decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch (caughtError: unknown) {
    // A failed authentication is a refusal, not a fault: the seal opens for its own bearer only.
    if (caughtError instanceof Error) return null;
    throw caughtError;
  }
}
