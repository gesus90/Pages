import os from "node:os";
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

/** The port of a running Pages installation; a browser run never uses it. */
const FORBIDDEN_PORT = 3000;

/** Port of the isolated instance; `PAGES_BROWSER_PORT` changes it. */
export const INSTANCE_PORT = Number(process.env.PAGES_BROWSER_PORT ?? 3100);

if (INSTANCE_PORT === FORBIDDEN_PORT) {
  throw new Error(`Port ${FORBIDDEN_PORT} is reserved for a running Pages.`);
}

/**
 * Directory of reports and artifacts: outside the checkout, because generated
 * files inside it would count as source for the gates. `pnpm run browser:test`
 * sets one directory per run through `PAGES_BROWSER_RESULTS`.
 */
export const RESULTS_DIRECTORY =
  process.env.PAGES_BROWSER_RESULTS ??
  path.join(os.tmpdir(), `pages-browser-results-${os.userInfo().username}`);

/** Address the tests open. */
export const INSTANCE_ORIGIN = `http://127.0.0.1:${INSTANCE_PORT}`;

/** Environment variable that names the directory with seed data and sessions. */
export const STATE_DIRECTORY_VARIABLE = "PAGES_BROWSER_STATE";
