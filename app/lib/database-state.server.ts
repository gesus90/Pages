import type { DatabaseWorkerState } from "@/backend/database/DatabaseExecutorTypes";
import type { ApplicationServices } from "./services.server";

/**
 * State of the database worker as health checks report it (PAGE-197).
 *
 * `not_started` means no database was opened in this process yet, for
 * example while the setup is pending or before the first request.
 */
export type DatabaseState = DatabaseWorkerState | "not_started";

/** Services whose opening this module saw finish, by the promise of `getApplicationServices`. */
const openedServices = new WeakMap<
  Promise<ApplicationServices>,
  ApplicationServices
>();
const watchedServices = new WeakSet<Promise<ApplicationServices>>();

/**
 * Notes when the services the process opens are ready, without opening them
 * or waiting for them.
 *
 * @remarks
 * The root middleware calls it on every request, so `/health/live` knows
 * the open database without touching `getApplicationServices`. A failed
 * opening is logged there and only leaves the state `starting` until
 * `getApplicationServices` drops the failed promise.
 */
export function watchApplicationServices(): void {
  const pending = globalThis.pagesServices;
  if (!pending || watchedServices.has(pending)) return;
  watchedServices.add(pending);
  void pending.then(
    (services) => {
      openedServices.set(pending, services);
    },
    () => undefined,
  );
}

/**
 * Reads the worker state without opening, querying or awaiting anything.
 *
 * @returns The worker state of the open database, `starting` while the
 * services open it, and `not_started` before that.
 */
export function readDatabaseState(): DatabaseState {
  watchApplicationServices();
  const pending = globalThis.pagesServices;
  if (!pending) return "not_started";
  const services = openedServices.get(pending);

  return services ? services.healthService.databaseState() : "starting";
}
