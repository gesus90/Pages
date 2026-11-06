import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { TemporaryPostgres } from "../../../scripts/postgres-check/temporary-instance";

import { startPagesInstance } from "./pages-instance";
import { INSTANCE_PORT, SERVER_ROOT, STATE_DIRECTORY_VARIABLE } from "./paths";
import { completeSetup, seedFixtures } from "./seed";

import type { PagesClient } from "./pages-client";

/** The browser cookie of an account, in the format Playwright stores sessions. */
function createStorageState(client: PagesClient): string {
  const value = client.sessionToken;

  if (value === null) {
    throw new Error("The account has no session.");
  }

  return JSON.stringify({
    cookies: [
      {
        domain: "127.0.0.1",
        expires: -1,
        httpOnly: true,
        name: "pages_session",
        path: "/",
        sameSite: "Lax",
        secure: false,
        value,
      },
    ],
    origins: [],
  });
}

/**
 * Starts the isolated instance, seeds it and hands the sessions to the tests.
 *
 * @returns The teardown that stops the owned servers and retains their files.
 *
 * @remarks
 * The instance has its own database and accounts. Nothing of the running
 * Pages installation is read or written. Both private directories are retained.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const postgres = await TemporaryPostgres.prepare();
  await postgres.start();
  let instance: Awaited<ReturnType<typeof startPagesInstance>>;
  try {
    instance = await startPagesInstance({
      port: INSTANCE_PORT,
      repositoryRoot: SERVER_ROOT,
    });
  } catch (error: unknown) {
    await postgres.remove();
    throw error;
  }

  try {
    const admin = await completeSetup(
      instance.origin,
      instance.setupToken,
      postgres.url,
    );
    const { reader, seed } = await seedFixtures(admin, instance.origin);
    const stateDirectory = path.join(instance.directory, "state");

    await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(stateDirectory, "seed.json"),
      JSON.stringify(seed),
      { mode: 0o600 },
    );
    await writeFile(
      path.join(stateDirectory, "admin.json"),
      createStorageState(admin),
      { mode: 0o600 },
    );
    await writeFile(
      path.join(stateDirectory, "reader.json"),
      createStorageState(reader),
      { mode: 0o600 },
    );
    process.env[STATE_DIRECTORY_VARIABLE] = stateDirectory;
  } catch (error: unknown) {
    try {
      await instance.stop({ keepFiles: true });
    } finally {
      await postgres.remove();
    }
    throw error;
  }

  return async () => {
    try {
      await instance.stop({ keepFiles: true });
    } finally {
      await postgres.remove();
    }
  };
}
