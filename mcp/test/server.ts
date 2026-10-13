import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import manifest from "../package.json" with { type: "json" };
import { readConfiguration } from "../src/configuration.ts";
import { CredentialStore } from "../src/credential-store.ts";
import { instanceEndpoint, readInstanceUrl } from "../src/instance-address.ts";

import type { ChildProcessWithoutNullStreams } from "node:child_process";

/** Only fixed diagnostics may reach the terminal; provider responses stay private. */
export class StdioCheckError extends Error {}

/** Exit information of the real bundled adapter, including spawn failures. */
export interface ServerExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly hasStartFailed: boolean;
}

/** The owned stdio child and its completion, without any replacement Pages service. */
export interface RunningServer {
  readonly child: ChildProcessWithoutNullStreams;
  readonly closed: Promise<ServerExit>;
}

/** Bounds protocol waits and process cleanup without leaving a pending timer. */
export async function withDeadline<T>(
  operation: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new StdioCheckError(message)),
      milliseconds,
    );
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function readTestEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<NodeJS.ProcessEnv> {
  let instance: URL;
  try {
    instance = readInstanceUrl(environment.PAGES_URL);
  } catch {
    throw new StdioCheckError(
      "Set PAGES_URL to a valid, explicitly isolated Pages instance.",
    );
  }
  try {
    const token =
      environment.PAGES_TOKEN ??
      (await new CredentialStore(environment).get(instance))?.token;
    const configuration = readConfiguration({
      ...environment,
      PAGES_TOKEN: token,
    });
    // An explicit process credential disables rotation and local-store writes during verification.
    return {
      ...environment,
      PAGES_URL: instance.href,
      PAGES_TOKEN: configuration.token,
    };
  } catch {
    throw new StdioCheckError(
      "Supply a valid PAGES_TOKEN securely or pair the isolated instance under this operating-system account first.",
    );
  }
}

async function requireAvailablePages(instance: URL): Promise<void> {
  try {
    const response = await fetch(instanceEndpoint(instance, "health"), {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
    });
    const health: unknown = await response.json();
    if (
      !response.ok ||
      typeof health !== "object" ||
      health === null ||
      !("status" in health) ||
      health.status !== "ok"
    ) {
      throw new StdioCheckError(
        "The isolated Pages instance is unavailable or its setup is incomplete.",
      );
    }
  } catch (error: unknown) {
    if (error instanceof StdioCheckError) throw error;
    throw new StdioCheckError(
      "Cannot reach a healthy isolated Pages instance. Check PAGES_URL and start no acceptance against production.",
    );
  }
}

/** Starts the versioned built bundle with stdio pipes and a read-only credential source. */
export async function startServer(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<RunningServer> {
  const bundle = fileURLToPath(
    new URL(`../dist/pages-mcp-v${manifest.version}.cjs`, import.meta.url),
  );
  try {
    await access(bundle);
  } catch {
    throw new StdioCheckError(
      "Build the MCP bundle before starting the stdio check.",
    );
  }
  const childEnvironment = await readTestEnvironment(environment);
  await requireAvailablePages(readInstanceUrl(childEnvironment.PAGES_URL));
  const child = spawn(process.execPath, [bundle], {
    env: childEnvironment,
    shell: false,
    stdio: "pipe",
  });
  const closed = new Promise<ServerExit>((resolve) => {
    let hasStartFailed = false;
    child.once("error", () => {
      hasStartFailed = true;
    });
    child.once("close", (code, signal) =>
      resolve({ code, signal, hasStartFailed }),
    );
  });
  child.stderr.pipe(process.stderr);
  return { child, closed };
}

/** Stops only this check's child, escalating when it does not exit promptly. */
export async function stopServer(server: RunningServer): Promise<void> {
  if (
    server.child.pid === undefined ||
    server.child.exitCode !== null ||
    server.child.signalCode !== null
  )
    return;
  server.child.kill("SIGTERM");
  try {
    await withDeadline(server.closed, 5000, "The stdio child did not stop.");
  } catch {
    server.child.kill("SIGKILL");
    await withDeadline(
      server.closed,
      5000,
      "Could not terminate the stdio child.",
    );
  }
}
