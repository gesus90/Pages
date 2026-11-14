import { spawn, execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  freeLoopbackPort,
  TemporaryPostgres,
} from "../../../scripts/postgres-check/temporary-instance";

import { completeSetup } from "./seed";

import type { ChildProcess } from "node:child_process";

const runFile = promisify(execFile);

interface SourceInstance {
  readonly child: ChildProcess;
  readonly output: () => string;
  readonly setupToken: () => Promise<string>;
}

async function startSource(
  directory: string,
  port: number,
): Promise<SourceInstance> {
  const home = path.join(directory, "home");
  const configuration = path.join(home, ".pages");
  await mkdir(configuration, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(configuration, "config.toml"),
    `firstRun = true\nport = ${port}\nlistenAddress = "127.0.0.1"\n`,
    { mode: 0o600 },
  );
  const child = spawn(
    process.execPath,
    [
      "node_modules/@react-router/dev/bin.cjs",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        HOME: home,
        XDG_CACHE_HOME: path.join(directory, "cache"),
        XDG_CONFIG_HOME: path.join(directory, "config"),
        XDG_DATA_HOME: path.join(directory, "data"),
        XDG_STATE_HOME: path.join(directory, "state"),
        TMPDIR: directory,
        NODE_ENV: "development",
        PAGES_ROUTES: "api",
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  const collect = (chunk: Buffer): void => {
    output += chunk.toString("utf8");
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  return {
    child,
    output: () => output,
    setupToken: async () => {
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline && child.exitCode === null) {
        const token = /\/setup\?token=([A-Za-z0-9_-]{43})/u.exec(output)?.[1];
        if (token) return token;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("source_server_not_ready");
    },
  };
}

async function stopSource(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  process.kill(-child.pid, "SIGTERM");
  const escalation = setTimeout(() => {
    if (child.pid && child.exitCode === null && child.signalCode === null)
      process.kill(-child.pid, "SIGKILL");
  }, 5000);
  await exited;
  clearTimeout(escalation);
}

async function requireNativeOwner(): Promise<void> {
  const runtime = `/run/user/${process.getuid?.() ?? 0}`;
  await runFile("/usr/bin/systemctl", ["--user", "show-environment"], {
    timeout: 2000,
    env: {
      PATH: "/usr/bin:/bin",
      XDG_RUNTIME_DIR: runtime,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtime}/bus`,
    },
  });
}

/** Checks the ticket's live prerequisites from source, without a build or access to an existing instance. */
async function probe(): Promise<void> {
  const directory = await mkdtemp("/tmp/pages-page361-");
  const postgres = await TemporaryPostgres.prepare();
  const port = await freeLoopbackPort();
  let source: SourceInstance | undefined;
  let phase = "postgres";
  let setupCompleted = false;
  try {
    await postgres.start();
    phase = "pages_source_start";
    source = await startSource(directory, port);
    const token = await source.setupToken();
    phase = "setup";
    await completeSetup(`http://127.0.0.1:${port}`, token, postgres.url);
    setupCompleted = true;
    phase = "native_owner_prerequisite";
    await requireNativeOwner();
    console.info(
      JSON.stringify({
        port,
        phase,
        setupCompleted,
        nativeOwnerAvailable: true,
        providerCalls: 0,
        runIds: [],
      }),
    );
  } catch {
    console.info(
      JSON.stringify({
        port,
        phase,
        setupCompleted,
        nativeOwnerAvailable: false,
        providerCalls: 0,
        runIds: [],
      }),
    );
    if (phase !== "native_owner_prerequisite") {
      // Only compiler diagnostics are shown; the private setup capability never leaves the probe.
      const diagnostics = (source?.output() ?? "")
        .split("\n")
        .filter(
          (line) =>
            /Error|error|failed|Failed/u.test(line) &&
            !/token|password|secret|postgresql/iu.test(line),
        )
        .slice(-8);
      console.info(JSON.stringify({ diagnostics }));
    }
  } finally {
    try {
      await stopSource(source?.child);
    } finally {
      await postgres.remove();
      await rm(postgres.directory, { recursive: true, force: true });
      await rm(directory, { recursive: true, force: true });
      console.info(JSON.stringify({ port, removed: true }));
    }
  }
}

await probe();
