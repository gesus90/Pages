import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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
 * @returns The teardown that stops the instance and removes its files.
 *
 * @remarks
 * The instance has its own database and accounts. Nothing of the running
 * Pages installation is read or written. Setting `PAGES_BROWSER_KEEP=1` keeps
 * the private directory, for example to read the server log after a failure.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const instance = await startPagesInstance({
    port: INSTANCE_PORT,
    repositoryRoot: SERVER_ROOT,
  });
  const keepFiles = process.env.PAGES_BROWSER_KEEP === "1";

  try {
    const admin = await completeSetup(
      instance.origin,
      instance.setupToken,
      path.join(instance.directory, "data", "pages.duckdb"),
    );
    const { reader, seed } = await seedFixtures(admin, instance.origin);
    const stateDirectory = path.join(instance.directory, "state");

    await mkdir(stateDirectory, { recursive: true });
    await writeFile(
      path.join(stateDirectory, "seed.json"),
      JSON.stringify(seed),
    );
    await writeFile(
      path.join(stateDirectory, "admin.json"),
      createStorageState(admin),
    );
    await writeFile(
      path.join(stateDirectory, "reader.json"),
      createStorageState(reader),
    );
    process.env[STATE_DIRECTORY_VARIABLE] = stateDirectory;
  } catch (error: unknown) {
    await instance.stop({ keepFiles: true });
    throw error;
  }

  return () => instance.stop({ keepFiles });
}
