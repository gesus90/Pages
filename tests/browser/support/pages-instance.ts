import { spawn } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type { ChildProcess } from "node:child_process";

/** A running, isolated Pages server and where its private files live. */
export interface PagesInstance {
  /** Address the browser opens, for example `http://127.0.0.1:3100`. */
  readonly origin: string;
  /** Private directory with home, configuration, database and log. */
  readonly directory: string;
  /** One-time secret of the setup wizard of this instance. */
  readonly setupToken: string;
  /** Stops the server and removes the private directory unless it is kept. */
  readonly stop: (options?: { readonly keepFiles?: boolean }) => Promise<void>;
}

/** What the instance needs to start. */
export interface PagesInstanceOptions {
  /** Checkout that holds `server.mjs` and the production build. */
  readonly repositoryRoot: string;
  readonly port: number;
}

const START_TIMEOUT_MILLISECONDS = 60_000;
const STOP_TIMEOUT_MILLISECONDS = 10_000;
const SETUP_LINK = /\/setup\?token=([A-Za-z0-9_-]{43})/u;

/** Environment variables the server may see; nothing of the caller's secrets. */
function createEnvironment(home: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    NODE_ENV: "production",
    PATH: process.env.PATH,
    XDG_CACHE_HOME: path.join(home, "cache"),
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_DATA_HOME: path.join(home, "data"),
    XDG_STATE_HOME: path.join(home, "state"),
  };
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

/** Waits until the server prints its setup link and returns the token. */
function readSetupToken(child: ChildProcess, logFile: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Pages printed no setup link within ${START_TIMEOUT_MILLISECONDS} ms; see ${logFile}.`,
        ),
      );
    }, START_TIMEOUT_MILLISECONDS);

    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");

      const token = SETUP_LINK.exec(output)?.[1];

      if (token) {
        clearTimeout(timer);
        resolve(token);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Pages exited with code ${code} before it was ready; see ${logFile}.`,
        ),
      );
    });
  });
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    child.once("exit", () => resolve());
  });
}

async function stopServer(child: ChildProcess): Promise<void> {
  child.kill("SIGTERM");

  const timer = setTimeout(
    () => child.kill("SIGKILL"),
    STOP_TIMEOUT_MILLISECONDS,
  );

  await waitForExit(child);
  clearTimeout(timer);
}

/**
 * Starts an isolated Pages server from the production build.
 *
 * @param options - Checkout and port.
 * @returns The running instance.
 * @throws {Error} When the build is missing, the port is taken, or the server
 * does not come up.
 *
 * @remarks
 * The instance has its own home, configuration and database in a new
 * directory below the system temporary directory, listens on the loopback
 * address only and sees none of the caller's environment secrets. A process
 * that already listens on the port is never touched: the start is refused.
 */
export async function startPagesInstance(
  options: PagesInstanceOptions,
): Promise<PagesInstance> {
  const serverEntry = path.join(
    options.repositoryRoot,
    "build",
    "server",
    "index.js",
  );

  if (!existsSync(serverEntry)) {
    throw new Error(
      `No production build at ${serverEntry}. Run "pnpm exec react-router build" first.`,
    );
  }

  if (await isPortInUse(options.port)) {
    throw new Error(
      `Port ${options.port} is in use. Choose another one with PAGES_BROWSER_PORT.`,
    );
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), "pages-browser-"));
  const home = path.join(directory, "home");
  const configPath = path.join(directory, "config.toml");
  const logFile = path.join(directory, "server.log");

  await mkdir(home, { recursive: true });
  await writeFile(
    configPath,
    `firstRun = true\nport = ${options.port}\nlistenAddress = "127.0.0.1"\n`,
  );

  const child = spawn(
    process.execPath,
    [
      path.join(options.repositoryRoot, "server.mjs"),
      "--config",
      configPath,
      "--port",
      String(options.port),
    ],
    {
      cwd: options.repositoryRoot,
      env: createEnvironment(home),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const capture = (chunk: Buffer): void => {
    appendFileSync(logFile, chunk);
  };

  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);

  try {
    const setupToken = await readSetupToken(child, logFile);

    return {
      directory,
      origin: `http://127.0.0.1:${options.port}`,
      setupToken,
      stop: async (stopOptions) => {
        await stopServer(child);

        if (!stopOptions?.keepFiles) {
          await rm(directory, { force: true, recursive: true });
        }
      },
    };
  } catch (error: unknown) {
    await stopServer(child);
    console.error(await readFile(logFile, "utf8").catch(() => ""));
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
}
