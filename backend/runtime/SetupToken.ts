import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SETUP_TOKEN_BYTES = 32;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * The one-time secret that unlocks the setup wizard.
 *
 * @remarks
 * The token only lives in the memory of the server process. The operator
 * receives it through the setup link printed to the console; a restart
 * issues a new one.
 */
export class SetupToken {
  private readonly secret: string;
  private readonly secretDigest: Buffer;

  private constructor(secret: string) {
    this.secret = secret;
    this.secretDigest = digest(secret);
  }

  /** Creates a new random token. */
  public static create(): SetupToken {
    return new SetupToken(randomBytes(SETUP_TOKEN_BYTES).toString("base64url"));
  }

  /** The secret, only for the setup link printed to the operator console. */
  public get value(): string {
    return this.secret;
  }

  /**
   * Compares a submitted value with the token.
   *
   * @param candidate - Untrusted value from a request.
   * @returns Whether it is the token.
   *
   * @remarks
   * Both sides are hashed to the same length first, so the comparison takes
   * the same time whatever was submitted.
   */
  public matches(candidate: unknown): boolean {
    if (typeof candidate !== "string" || candidate === "") {
      return false;
    }

    return timingSafeEqual(digest(candidate), this.secretDigest);
  }
}
