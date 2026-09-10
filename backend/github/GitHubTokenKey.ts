import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const TOKEN_KEY_ENVIRONMENT_VARIABLE = "PAGES_GITHUB_TOKEN_KEY";
const TOKEN_KEY_FILE_NAME = "github-token.key";
const TOKEN_KEY_BYTES = 32;

/**
 * Resolves the server-side key used to encrypt GitHub tokens at rest.
 *
 * @param databasePath - Resolved SQLite path; the key file lives next to it.
 * @returns A 32-byte encryption key.
 *
 * @remarks
 * An explicit `PAGES_GITHUB_TOKEN_KEY` (64 hexadecimal characters) always
 * wins so deployments can manage the secret externally. Otherwise a random
 * key is generated once beside the database with owner-only permissions.
 * The key never leaves the server process.
 */
export function resolveGitHubTokenKey(databasePath: string): Buffer {
  const configuredKey = process.env[TOKEN_KEY_ENVIRONMENT_VARIABLE];

  if (configuredKey) {
    if (!/^[0-9a-fA-F]{64}$/.test(configuredKey)) {
      throw new Error(
        "PAGES_GITHUB_TOKEN_KEY must hold 64 hexadecimal characters.",
      );
    }

    return Buffer.from(configuredKey, "hex");
  }

  const keyPath = path.join(path.dirname(databasePath), TOKEN_KEY_FILE_NAME);

  let storedKey: string | null = null;

  try {
    storedKey = readFileSync(keyPath, "utf8").trim();
  } catch (error: unknown) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  if (storedKey !== null) {
    if (!/^[0-9a-fA-F]{64}$/.test(storedKey)) {
      throw new Error(
        `Stored GitHub token key at "${keyPath}" is invalid, refusing to use it.`,
      );
    }

    return Buffer.from(storedKey, "hex");
  }

  const generatedKey = randomBytes(TOKEN_KEY_BYTES).toString("hex");
  mkdirSync(path.dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, `${generatedKey}\n`, { mode: 0o600 });

  return Buffer.from(generatedKey, "hex");
}
