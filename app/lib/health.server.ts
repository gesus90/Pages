import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";

import { getApplicationServices } from "./services.server";

/** What `/health` reports. */
export type HealthStatus = "ok" | "setup" | "unavailable";

/** How long the database may take to answer before Pages counts as unavailable. */
export const HEALTH_TIMEOUT_MILLISECONDS = 3000;

async function queryDatabase(): Promise<HealthStatus> {
  const services = await getApplicationServices();

  return (await services.healthService.canQueryDatabase())
    ? "ok"
    : "unavailable";
}

/**
 * Checks whether this Pages process can serve requests.
 *
 * @param timeoutMilliseconds - How long to wait for the database.
 * @returns `setup` while the setup wizard is pending, since no database
 * exists yet, `ok` when the database answers, and `unavailable` when it
 * fails or does not answer in time.
 */
export async function checkHealth(
  timeoutMilliseconds = HEALTH_TIMEOUT_MILLISECONDS,
): Promise<HealthStatus> {
  if ((await getPagesRuntime()).isSetupPending()) {
    return "setup";
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<HealthStatus>((resolve) => {
    timer = setTimeout(() => resolve("unavailable"), timeoutMilliseconds);
  });

  try {
    return await Promise.race([queryDatabase(), timeout]);
  } catch (error: unknown) {
    console.error("[pages] The health check failed.", error);

    return "unavailable";
  } finally {
    clearTimeout(timer);
  }
}
