import path from "node:path";

/** Root of the checkout the browser suite runs against. */
export const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * Checkout whose production build the instance runs; `PAGES_BROWSER_SERVER_ROOT`
 * points at another one, for example to run the suite against the state before
 * a change and see the defect it fixes.
 */
export const SERVER_ROOT =
  process.env.PAGES_BROWSER_SERVER_ROOT ?? REPOSITORY_ROOT;

/** Port of the isolated instance; `PAGES_BROWSER_PORT` changes it. */
export const INSTANCE_PORT = Number(process.env.PAGES_BROWSER_PORT ?? 3100);

/** Address the tests open. */
export const INSTANCE_ORIGIN = `http://127.0.0.1:${INSTANCE_PORT}`;

/** Environment variable that names the directory with seed data and sessions. */
export const STATE_DIRECTORY_VARIABLE = "PAGES_BROWSER_STATE";
