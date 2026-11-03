import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Port the suite prefers; a busy one is replaced, a process on it stays untouched. */
const PREFERRED_PORT = 3100;

/** The port of a running Pages installation; a browser run never uses it. */
const FORBIDDEN_PORT = 3000;

const DEFAULT_TIMEOUT_MINUTES = 45;
const STOP_GRACE_MILLISECONDS = 10_000;
const VERSION_PROBE_MILLISECONDS = 15_000;
const SCREENSHOT_BROWSER = "chromium-headless-shell";

/** Exit code of a step that ran into its time limit, as in `timeout(1)`. */
export const TIMEOUT_EXIT_CODE = 124;

/** Exit code of a run whose browser or setup could not be provided. */
export const SETUP_EXIT_CODE = 3;

/** Directories that may hold the browser, the first usable one wins. */
export function browserCacheCandidates(environment, realHome) {
  const candidates = [
    environment.PLAYWRIGHT_BROWSERS_PATH,
    environment.XDG_CACHE_HOME &&
      path.join(environment.XDG_CACHE_HOME, "ms-playwright"),
    environment.HOME && path.join(environment.HOME, ".cache", "ms-playwright"),
    realHome && path.join(realHome, ".cache", "ms-playwright"),
  ].filter(Boolean);
  return [...new Set(candidates)];
}

/** The private directory a missing browser is installed into; never a shared one. */
export function privateBrowserCache(environment, realHome) {
  const base =
    environment.XDG_CACHE_HOME ||
    path.join(environment.HOME || realHome, ".cache");
  return path.join(base, "pages-browser-tests", "ms-playwright");
}

/**
 * Where the reports of this run go: outside the checkout, one directory per
 * run, also below an explicit root. Playwright empties its output directory at
 * the start, so a shared directory would destroy the evidence of the last run.
 */
export function resultsDirectory(environment, realHome, repositoryRoot, now) {
  const root =
    environment.PAGES_BROWSER_RESULTS ||
    path.join(
      environment.XDG_STATE_HOME ||
        path.join(environment.HOME || realHome, ".local", "state"),
      "pages-browser-tests",
    );
  const relative = path.relative(repositoryRoot, path.resolve(root));
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    throw new Error(
      `PAGES_BROWSER_RESULTS must lie outside the checkout: ${root}`,
    );
  }
  return path.join(
    path.resolve(root),
    now.toISOString().replaceAll(/[:.]/gu, "-"),
  );
}

/**
 * Creates the directory of this run and never reuses one: two runs in the same
 * millisecond get different directories.
 *
 * @returns The directory that was created.
 */
export async function createRunDirectory(directory) {
  await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
  for (let attempt = 0; ; attempt += 1) {
    const candidate = attempt === 0 ? directory : `${directory}-${attempt}`;
    try {
      await mkdir(candidate, { mode: 0o700 });
      return candidate;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}

/** Reads the explicit port and refuses the one of a running installation. */
export function requestedPort(environment) {
  if (environment.PAGES_BROWSER_PORT === undefined) return null;
  const port = Number(environment.PAGES_BROWSER_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PAGES_BROWSER_PORT: ${port}`);
  }
  if (port === FORBIDDEN_PORT) {
    throw new Error(`Port ${FORBIDDEN_PORT} is reserved for a running Pages.`);
  }
  return port;
}

/** Reads the time limit of one step of the run. */
export function timeoutMilliseconds(environment) {
  const raw = environment.PAGES_BROWSER_TIMEOUT_MINUTES;
  const minutes = raw === undefined ? DEFAULT_TIMEOUT_MINUTES : Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error(`Invalid PAGES_BROWSER_TIMEOUT_MINUTES: ${raw}`);
  }
  return minutes * 60_000;
}

function findExecutable(directory, revision) {
  const root = path.join(directory, `chromium_headless_shell-${revision}`);
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(root, entry.name, "chrome-headless-shell");
    if (existsSync(file)) return file;
  }
  return null;
}

/**
 * Whether this directory holds a browser of the revision that also starts.
 *
 * @remarks
 * Starting it is the only proof: a copied cache can hold the file without its
 * execute bit, and a sandbox can hide or forbid it.
 */
export function inspectBrowserCache(directory, revision, probe = probeBrowser) {
  const file = findExecutable(directory, revision);
  if (file === null) return { directory, usable: false, reason: "missing" };
  const failure = probe(file);
  return failure === null
    ? { directory, usable: true, reason: null }
    : { directory, usable: false, reason: failure };
}

function probeBrowser(file) {
  try {
    accessSync(file, constants.X_OK);
  } catch (error) {
    return error.code;
  }
  const result = spawnSync(file, ["--version"], {
    stdio: "ignore",
    timeout: VERSION_PROBE_MILLISECONDS,
  });
  if (result.error) return result.error.code;
  return result.status === 0 ? null : `exit ${result.status}`;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function choosePort(environment) {
  const requested = requestedPort(environment);
  if (requested !== null) return requested;
  return (await isPortFree(PREFERRED_PORT))
    ? PREFERRED_PORT
    : freeLoopbackPort();
}

/**
 * Runs one step to its end; a time limit or a signal is a failure, never a pass.
 *
 * @returns The exit code of the step, {@link TIMEOUT_EXIT_CODE} after its limit.
 */
export function runStep(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "inherit", "inherit"],
    });
    let hasTimedOut = false;
    let killTimer;
    const forward = (signal) => child.kill(signal);
    const limit = setTimeout(() => {
      hasTimedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(
        () => child.kill("SIGKILL"),
        STOP_GRACE_MILLISECONDS,
      );
    }, options.timeoutMilliseconds);
    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);
    const finish = (code) => {
      clearTimeout(limit);
      clearTimeout(killTimer);
      process.off("SIGINT", forward);
      process.off("SIGTERM", forward);
      resolve(code);
    };
    child.once("error", () => finish(SETUP_EXIT_CODE));
    child.once("close", (code, signal) => {
      if (hasTimedOut) finish(TIMEOUT_EXIT_CODE);
      else
        finish(
          signal === null ? (code ?? 1) : 128 + os.constants.signals[signal],
        );
    });
  });
}

async function readBrowserRevision(repositoryRoot) {
  const manifest = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "node_modules/playwright-core/browsers.json"),
      "utf8",
    ),
  );
  const browser = manifest.browsers.find(
    (entry) => entry.name === SCREENSHOT_BROWSER,
  );
  if (!browser) throw new Error(`Playwright lists no ${SCREENSHOT_BROWSER}.`);
  return browser.revision;
}

async function provideBrowser(repositoryRoot, environment, limit) {
  const realHome = os.userInfo().homedir;
  const revision = await readBrowserRevision(repositoryRoot);
  const inspected = browserCacheCandidates(environment, realHome).map(
    (directory) => inspectBrowserCache(directory, revision),
  );
  const usable = inspected.find((entry) => entry.usable);
  for (const entry of inspected) {
    console.info(
      `[browser] Cache ${entry.directory}: ${entry.usable ? "usable" : entry.reason}`,
    );
  }
  if (usable) return usable.directory;

  const directory = privateBrowserCache(environment, realHome);
  console.info(`[browser] Installing revision ${revision} into ${directory}.`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const installEnvironment = {
    ...environment,
    PLAYWRIGHT_BROWSERS_PATH: directory,
  };
  const code = await runStep(
    path.join(repositoryRoot, "node_modules/.bin/playwright"),
    ["install", "chromium"],
    {
      cwd: repositoryRoot,
      env: installEnvironment,
      timeoutMilliseconds: limit,
    },
  );
  const installed = inspectBrowserCache(directory, revision);
  if (code !== 0 || !installed.usable) {
    throw new Error(
      `No usable Chromium ${revision}: the installation into ${directory} ended with ${code}, ${installed.reason ?? "and the browser starts"}.`,
    );
  }
  return directory;
}

/** Builds the application and runs the suite with a browser that starts. */
async function main() {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const realHome = os.userInfo().homedir;
  const limit = timeoutMilliseconds(process.env);
  const results = await createRunDirectory(
    resultsDirectory(process.env, realHome, repositoryRoot, new Date()),
  );
  const browsers = await provideBrowser(repositoryRoot, process.env, limit);
  const port = await choosePort(process.env);
  const environment = {
    ...process.env,
    PAGES_BROWSER_PORT: String(port),
    PAGES_BROWSER_RESULTS: results,
    PLAYWRIGHT_BROWSERS_PATH: browsers,
  };
  console.info(
    `[browser] Port ${port}, browser ${browsers}, results ${results}`,
  );

  const bin = path.join(repositoryRoot, "node_modules/.bin");
  const options = {
    cwd: repositoryRoot,
    env: environment,
    timeoutMilliseconds: limit,
  };
  const built = await runStep(
    path.join(bin, "react-router"),
    ["build"],
    options,
  );
  if (built !== 0) {
    console.error(`[browser] FAILED: build ended with ${built}.`);
    return built;
  }
  const code = await runStep(
    path.join(bin, "playwright"),
    [
      "test",
      "--config",
      "tests/browser/playwright.config.ts",
      ...process.argv.slice(2).filter((argument) => argument !== "--"),
    ],
    options,
  );
  const verdict = code === 0 ? "PASSED" : `FAILED with ${code}`;
  console.info(`[browser] ${verdict}; results in ${results}`);
  return code;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(
      `[browser] Setup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = SETUP_EXIT_CODE;
  }
}
