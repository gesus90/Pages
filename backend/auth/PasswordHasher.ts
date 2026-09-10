import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_ALGORITHM_NAME = "scrypt";
const SCRYPT_COST_FACTOR = 32768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 3;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_KEY_LENGTH = 64;

// scrypt needs roughly 128 * N * r * p bytes of memory. This stays well
// above that for the parameters above so Node never rejects them, and also
// leaves room for parameters to grow later without another code change.
const SCRYPT_MAX_MEMORY_BYTES = 256 * 1024 * 1024;

/** The parameters and secret material encoded in a stored password hash. */
interface ParsedPasswordHash {
  readonly costFactor: number;
  readonly blockSize: number;
  readonly parallelization: number;
  readonly salt: Buffer;
  readonly derivedKey: Buffer;
}

/** Hashes and verifies passwords using scrypt from Node's built-in crypto module. */
export class PasswordHasher {
  /**
   * Creates a self-describing scrypt hash for a password.
   *
   * @param password - Plain-text password.
   * @returns An encoded hash containing the algorithm name, its cost
   * parameters, the salt, and the derived key.
   *
   * @remarks
   * Storing the cost parameters alongside the hash lets Pages keep
   * verifying passwords created under older parameters even after the
   * defaults used for new hashes change.
   */
  public async hash(password: string): Promise<string> {
    const salt = randomBytes(SCRYPT_SALT_BYTES);
    const derivedKey = await this.deriveKey(password, salt, {
      blockSize: SCRYPT_BLOCK_SIZE,
      costFactor: SCRYPT_COST_FACTOR,
      parallelization: SCRYPT_PARALLELIZATION,
    });

    return [
      SCRYPT_ALGORITHM_NAME,
      SCRYPT_COST_FACTOR,
      SCRYPT_BLOCK_SIZE,
      SCRYPT_PARALLELIZATION,
      salt.toString("base64"),
      derivedKey.toString("base64"),
    ].join("$");
  }

  /**
   * Verifies a password against a stored hash.
   *
   * @param passwordHash - Encoded scrypt hash from the database.
   * @param password - Plain-text password entered during login.
   * @returns Whether the password matches the hash.
   *
   * @remarks
   * A malformed or unsupported stored hash is reported as a failed
   * verification so callers cannot distinguish it from a wrong password,
   * and so a corrupted database value never crashes the server.
   */
  public async verify(
    passwordHash: string,
    password: string,
  ): Promise<boolean> {
    const parsed = this.parseHash(passwordHash);

    if (!parsed) {
      return false;
    }

    try {
      const candidateKey = await this.deriveKey(password, parsed.salt, {
        blockSize: parsed.blockSize,
        costFactor: parsed.costFactor,
        parallelization: parsed.parallelization,
      });

      return (
        candidateKey.length === parsed.derivedKey.length &&
        timingSafeEqual(candidateKey, parsed.derivedKey)
      );
    } catch {
      return false;
    }
  }

  /**
   * Determines whether a stored value is a hash produced by this hasher.
   *
   * @param passwordHash - Value stored in the database.
   * @returns Whether the value can be verified by {@link verify}.
   *
   * @remarks
   * Lets callers recognize hashes left over from a previously used hashing
   * library without duplicating this hasher's encoding elsewhere.
   */
  public isSupportedHash(passwordHash: string): boolean {
    return this.parseHash(passwordHash) !== null;
  }

  private async deriveKey(
    password: string,
    salt: Buffer,
    costParameters: {
      readonly costFactor: number;
      readonly blockSize: number;
      readonly parallelization: number;
    },
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(
        password,
        salt,
        SCRYPT_KEY_LENGTH,
        {
          N: costParameters.costFactor,
          maxmem: SCRYPT_MAX_MEMORY_BYTES,
          p: costParameters.parallelization,
          r: costParameters.blockSize,
        },
        (error, derivedKey) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(derivedKey);
        },
      );
    });
  }

  private parseHash(passwordHash: string): ParsedPasswordHash | null {
    const parts = passwordHash.split("$");

    if (parts.length !== 6 || parts[0] !== SCRYPT_ALGORITHM_NAME) {
      return null;
    }

    const [
      ,
      costFactorText,
      blockSizeText,
      parallelizationText,
      saltText,
      derivedKeyText,
    ] = parts;
    const costFactor = Number(costFactorText);
    const blockSize = Number(blockSizeText);
    const parallelization = Number(parallelizationText);

    if (
      !Number.isInteger(costFactor) ||
      !Number.isInteger(blockSize) ||
      !Number.isInteger(parallelization) ||
      costFactor <= 0 ||
      blockSize <= 0 ||
      parallelization <= 0
    ) {
      return null;
    }

    const salt = Buffer.from(saltText, "base64");
    const derivedKey = Buffer.from(derivedKeyText, "base64");

    if (salt.length === 0 || derivedKey.length === 0) {
      return null;
    }

    return { blockSize, costFactor, derivedKey, parallelization, salt };
  }
}
