import { lstat, readFile } from "node:fs/promises";

import { z } from "zod";

import { registerLogSecret } from "@/backend/logging/LogRedaction";

import { digest, matches } from "./RunnerServiceSupport";

import type { RunnerRecord } from "@/backend/database/repositories/runner/RunnerRepository";
import type { RunnerStore } from "./RunnerServiceSupport";

/** Reserved machine identity, independent of SSH registrations and user-selected names. */
export const LOCAL_RUNNER_CONNECTION_ID =
  "00000000-0000-4000-8000-000000000001";

const configurationSchema = z.object({
  endpoint: z.string().url(),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  runnerId: z.string().uuid(),
  sessionId: z.string().uuid(),
});

/** Registers the installer-created machine token without replacing any journal on reconnect. */
export async function provisionLocalRunner(
  repository: RunnerStore,
): Promise<RunnerRecord | null> {
  const configuration = await readLocalConfiguration();
  if (!configuration) return null;
  registerLogSecret(configuration.token);
  requireLocalEndpoint(configuration.endpoint);
  const existing = await repository.find(LOCAL_RUNNER_CONNECTION_ID);
  if (existing) {
    if (
      existing.runnerId !== configuration.runnerId ||
      !matches(configuration.token, existing.tokenHash)
    )
      throw new Error(
        "Local runner identity changed; restore the original configuration",
      );
    return existing;
  }
  const record: RunnerRecord = {
    connectionId: LOCAL_RUNNER_CONNECTION_ID,
    runnerId: configuration.runnerId,
    tokenHash: digest(configuration.token),
    connectionRevision: 1,
    state: {
      version: 1,
      sessionId: configuration.sessionId,
      sequence: 0,
      lastEventId: null,
      jobs: [],
    },
  };
  await repository.create(record);
  return record;
}

/** Proxy headers cannot turn an external request into a local machine connection. */
export function isDirectLocalRunnerPeer(
  address: string | undefined,
  headers: Readonly<Record<string, unknown>>,
): boolean {
  return (
    (address === "127.0.0.1" || address === "::ffff:127.0.0.1") &&
    !Object.keys(headers).some(
      (name) => name === "forwarded" || name.startsWith("x-forwarded-"),
    )
  );
}

async function readLocalConfiguration(): Promise<z.infer<
  typeof configurationSchema
> | null> {
  const file = process.env.PAGES_LOCAL_RUNNER_CONFIG;
  if (!file) return null;
  const metadata = await lstat(file).catch((error: unknown) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw error;
  });
  if (!metadata) return null;
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o777) !== 0o600
  )
    throw new Error("Local runner configuration must be owned and private");
  return configurationSchema.parse(JSON.parse(await readFile(file, "utf8")));
}

function requireLocalEndpoint(address: string): void {
  const endpoint = new URL(address);
  if (
    endpoint.protocol !== "ws:" ||
    endpoint.hostname !== "127.0.0.1" ||
    endpoint.pathname !== `/runner/v1/channel/${LOCAL_RUNNER_CONNECTION_ID}` ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error("Local runner requires a direct IPv4 loopback endpoint");
}
