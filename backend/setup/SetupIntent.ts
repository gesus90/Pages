import { createHmac, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { open, unlink } from "node:fs/promises";
import path from "node:path";

import { logCaughtError } from "@/backend/logging/Logger";

/** Private durable proof binding a setup attempt to its database and session. */
export interface SetupIntent {
  readonly databaseUrl: string;
  readonly sessionToken: string;
  readonly fingerprint: string;
}

function intentPath(configPath: string): string {
  return path.join(path.dirname(configPath), ".setup-postgres-intent.json");
}

/** Reads an existing intent only if it is a private regular file of this user. */
export async function readSetupIntent(
  configPath: string,
): Promise<SetupIntent | null> {
  const filePath = intentPath(configPath);
  try {
    const file = await open(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let content: unknown;
    try {
      const info = await file.stat();
      if (
        !info.isFile() ||
        info.uid !== process.getuid?.() ||
        (info.mode & 0o077) !== 0 ||
        info.size > 16384
      )
        throw new Error("Setup intent is not private.");
      content = JSON.parse(await file.readFile("utf8"));
    } finally {
      await file.close();
    }
    return parseIntent(content);
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw error;
  }
}

function parseIntent(content: unknown): SetupIntent {
  if (
    typeof content !== "object" ||
    content === null ||
    !("databaseUrl" in content) ||
    typeof content.databaseUrl !== "string" ||
    !("sessionToken" in content) ||
    typeof content.sessionToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(content.sessionToken) ||
    !("fingerprint" in content) ||
    typeof content.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/u.test(content.fingerprint)
  )
    throw new Error("Setup intent is invalid.");
  return {
    databaseUrl: content.databaseUrl,
    sessionToken: content.sessionToken,
    fingerprint: content.fingerprint,
  };
}

/** Retires the recovery intent only when it belongs to the configured database. */
export async function retireMatchingSetupIntent(
  configPath: string,
  databaseUrl: string,
): Promise<void> {
  try {
    const intent = await readSetupIntent(configPath);
    if (intent?.databaseUrl === databaseUrl)
      await retireSetupIntent(configPath);
  } catch (error: unknown) {
    logCaughtError("ApplicationServices", error);
  }
}

/** Creates and synchronizes the intent without replacing an existing attempt. */
export async function createSetupIntent(
  configPath: string,
  databaseUrl: string,
  setupValues: string,
): Promise<SetupIntent> {
  const sessionToken = randomBytes(32).toString("base64url");
  const intent = {
    databaseUrl,
    sessionToken,
    fingerprint: setupFingerprint(sessionToken, setupValues),
  };
  const file = await open(intentPath(configPath), "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(intent));
    await file.sync();
  } finally {
    await file.close();
  }
  const directory = await open(path.dirname(configPath), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
  return intent;
}

/** Binds the intended identity to the private setup attempt. */
export function setupFingerprint(
  sessionToken: string,
  setupValues: string,
): string {
  return createHmac("sha256", sessionToken).update(setupValues).digest("hex");
}

/** Removes the no-longer-needed private recovery credential after success. */
export async function retireSetupIntent(configPath: string): Promise<void> {
  await unlink(intentPath(configPath));
  const directory = await open(path.dirname(configPath), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
