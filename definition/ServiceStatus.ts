import { z } from "zod";

/**
 * Version of the service status that `pages-core` serves to browsers (PAGE-238).
 *
 * @remarks
 * `core/src/status.rs` writes it. A browser that reads another version shows
 * no status instead of guessing.
 */
export const SERVICE_STATUS_VERSION = 1;

/** The public status: one light for all services of the platform target. */
export const SERVICE_STATUS_PATH = "/service-status";

/** The detailed status; only for a session in the active admin mode. */
export const SERVICE_STATUS_DETAILS_PATH = "/service-status/details";

/**
 * The light of all services together.
 *
 * @remarks
 * `green`: every service runs (a one-shot service also after a successful
 * run). `yellow`: a service is starting, stopping or restarting. `red`: a
 * service stopped, failed or is missing. `unknown`: the service manager could
 * not be read.
 */
export const serviceStatusLightSchema = z.enum([
  "green",
  "yellow",
  "red",
  "unknown",
]);

/** The light of all services together, see {@link serviceStatusLightSchema}. */
export type ServiceStatusLight = z.infer<typeof serviceStatusLightSchema>;

/** The public status and every answer without details: nothing but the light. */
export const serviceStatusSchema = z.strictObject({
  version: z.literal(SERVICE_STATUS_VERSION),
  light: serviceStatusLightSchema,
});

/** The public status, see {@link serviceStatusSchema}. */
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;

/**
 * One service of the detailed status: name, state, last start and restarts.
 *
 * @remarks
 * Nothing else leaves the core: no path, command, environment or
 * configuration of the unit.
 */
export const serviceStateSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9:_.@-]{1,128}$/u),
  state: z.enum([
    "active",
    "activating",
    "deactivating",
    "reloading",
    "refreshing",
    "inactive",
    "failed",
    "maintenance",
    "unknown",
  ]),
  /** Milliseconds since the epoch when the main process last started; `null` when never. */
  lastStart: z.number().int().nonnegative().nullable(),
  restarts: z.number().int().nonnegative(),
});

/** One service of the detailed status, see {@link serviceStateSchema}. */
export type ServiceState = z.infer<typeof serviceStateSchema>;

/** The detailed status an admin receives. */
export const serviceStatusDetailsSchema = z.strictObject({
  version: z.literal(SERVICE_STATUS_VERSION),
  light: serviceStatusLightSchema,
  services: z.array(serviceStateSchema).max(32),
});

/** The detailed status, see {@link serviceStatusDetailsSchema}. */
export type ServiceStatusDetails = z.infer<typeof serviceStatusDetailsSchema>;
