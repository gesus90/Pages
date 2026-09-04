import { hash, verify } from "@node-rs/argon2";

import type { Algorithm } from "@node-rs/argon2";

// Argon2id is exported as an ambient const enum, which cannot be referenced
// while "isolatedModules" is enabled, so its documented value is used instead.
const ARGON2ID: Algorithm = 2;

/** Hashes and verifies passwords using Argon2id. */
export class PasswordHasher {
  /**
   * Creates an Argon2id hash for a password.
   *
   * @param password - Plain-text password.
   * @returns The encoded Argon2id hash including its parameters and salt.
   */
  public async hash(password: string): Promise<string> {
    return hash(password, { algorithm: ARGON2ID });
  }

  /**
   * Verifies a password against a stored hash.
   *
   * @param passwordHash - Encoded Argon2id hash from the database.
   * @param password - Plain-text password entered during login.
   * @returns Whether the password matches the hash.
   *
   * @remarks
   * A malformed stored hash is reported as a failed verification so callers
   * cannot distinguish it from a wrong password.
   */
  public async verify(
    passwordHash: string,
    password: string,
  ): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }
}
