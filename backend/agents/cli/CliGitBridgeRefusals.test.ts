import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { openCliGitBridge } from "@/backend/agents/cli/CliGitBridge";
import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import type * as ChildProcessModule from "node:child_process";
import type * as FsModule from "node:fs/promises";
import type * as NetModule from "node:net";
import type { Socket } from "node:net";
import type { CliGitBridgeEndpoint } from "@/backend/agents/cli/CliGitBridge";

type ExecCallback = (
  error: Error | null,
  result?: { readonly stdout: string },
) => void;

const mocks = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
  logEvent: vi.fn(),
  execFile: vi.fn(),
  chmod: vi.fn(),
  serverSockets: [] as Socket[],
}));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
  logDiagnostic: mocks.logDiagnostic,
  logEvent: mocks.logEvent,
}));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcessModule>()),
  execFile: mocks.execFile,
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof FsModule>()),
  chmod: mocks.chmod,
}));
vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof NetModule>();
  return {
    ...actual,
    createServer: (
      options: Parameters<typeof actual.createServer>[0],
      listener: (socket: Socket) => void,
    ) =>
      actual.createServer(options, (socket) => {
        mocks.serverSockets.push(socket);
        listener(socket);
      }),
  };
});

const ECHO_PROGRAM =
  'process.stdout.write("advert\\n"); process.stdin.pipe(process.stdout);';
const CAPABILITY = "synthetic-capability";
const SOCKET_FILE = "bridge.sock";
const startDirectory = process.cwd();
let directory = "";
let endpoint: CliGitBridgeEndpoint | null = null;
let spawned = 0;

beforeEach(async () => {
  const actualFs = await vi.importActual<typeof FsModule>("node:fs/promises");
  mocks.chmod.mockImplementation(actualFs.chmod);
  mocks.execFile.mockImplementation(
    (
      file: string,
      args: readonly string[],
      options: unknown,
      done: ExecCallback,
    ) => {
      done(null, { stdout: "user git\nhostname github.com\nport 22\n" });
    },
  );
  const root = pagesTempDirectory("git-bridge-test");
  await mkdir(root, { recursive: true, mode: 0o700 });
  directory = await mkdtemp(path.join(root, "refusals-"));
  // The socket path stays relative because an absolute one can exceed the limit of the system.
  process.chdir(directory);
  mocks.serverSockets.length = 0;
  spawned = 0;
});

afterEach(async () => {
  await endpoint?.close();
  endpoint = null;
  process.chdir(startDirectory);
  await rm(directory, { recursive: true, force: true });
});

async function startBridge(
  isAuthorized: () => Promise<boolean> = async () => true,
  pushRefs: readonly string[] = [],
): Promise<void> {
  endpoint = await openCliGitBridge({
    instanceId: "session-1",
    socketPath: SOCKET_FILE,
    capability: CAPABILITY,
    grant: {
      repository: "owner/repo",
      sshAlias: "alias",
      pushRefs,
      isAuthorized,
    },
    remote: () => {
      spawned += 1;
      return spawn(process.execPath, ["-e", ECHO_PROGRAM], {
        stdio: ["pipe", "pipe", "ignore"],
      });
    },
  });
}

function requestLine(command: string): string {
  return `${JSON.stringify({
    capability: CAPABILITY,
    destination: "git@github.com",
    command,
  })}\n`;
}

async function converse(chunks: readonly string[]): Promise<string> {
  const client = createConnection({ path: SOCKET_FILE, allowHalfOpen: true });
  const received: Buffer[] = [];
  client.on("data", (chunk: Buffer) => received.push(chunk));
  for (const chunk of chunks) {
    client.write(chunk);
    // A pause keeps the chunks apart, so the bridge reads each one on its own.
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  client.end();
  await once(client, "close");
  return Buffer.concat(received).toString("utf8");
}

it("refuses a request line that is no valid request", async () => {
  await startBridge();
  expect(await converse(["not json\n"])).toBe(
    "Pages Git bridge refused: invalid request\n",
  );
  expect(spawned).toBe(0);
});

it("reads on until the request line is complete and refuses one that never ends", async () => {
  await startBridge();
  const line = requestLine("git-upload-pack 'owner/repo'");
  expect(await converse([line.slice(0, 7), line.slice(7)])).toBe(
    "ok\nadvert\n",
  );
  expect(await converse(["x".repeat(5000)])).toBe(
    "Pages Git bridge refused: invalid request\n",
  );
});

it("refuses a push when the grant allows no branch", async () => {
  await startBridge();
  expect(await converse([requestLine("git-receive-pack 'owner/repo'")])).toBe(
    "Pages Git bridge refused: this session may only fetch\n",
  );
});

it("refuses when live access is gone or cannot be checked", async () => {
  await startBridge(async () => false);
  const line = requestLine("git-upload-pack 'owner/repo'");
  expect(await converse([line])).toBe(
    "Pages Git bridge refused: project access changed\n",
  );
  await endpoint?.close();
  const failure = new Error("lookup failed");
  await startBridge(async () => {
    throw failure;
  });
  expect(await converse([line])).toBe(
    "Pages Git bridge refused: project access changed\n",
  );
  expect(mocks.logCaughtError).toHaveBeenCalledWith("CliGitBridge", failure);
  expect(spawned).toBe(0);
});

it("starts nothing when the session left while access was being checked", async () => {
  let release: (value: boolean) => void = () => undefined;
  const pending = new Promise<boolean>((resolve) => {
    release = resolve;
  });
  await startBridge(() => pending);
  const client = createConnection({ path: SOCKET_FILE });
  client.write(requestLine("git-upload-pack 'owner/repo'"));
  await vi.waitFor(() => {
    expect(mocks.serverSockets).toHaveLength(1);
  });
  const connection = mocks.serverSockets[0];
  await vi.waitFor(() => {
    expect(connection.isPaused()).toBe(true);
  });
  connection.destroy();
  await once(connection, "close");
  client.destroy();
  release(true);
  await new Promise((resolve) => setImmediate(resolve));
  expect(spawned).toBe(0);
});

it("refuses a fifth simultaneous connection", async () => {
  await startBridge();
  const idle = Array.from({ length: 4 }, () =>
    createConnection({ path: SOCKET_FILE }),
  );
  await vi.waitFor(() => {
    expect(mocks.serverSockets).toHaveLength(4);
  });
  expect(await converse([])).toBe(
    "Pages Git bridge refused: too many transfers\n",
  );
  for (const client of idle) client.destroy();
});

it("logs a connection error and drops a connection that sends no request in time", async () => {
  await startBridge();
  const client = createConnection({ path: SOCKET_FILE });
  await vi.waitFor(() => {
    expect(mocks.serverSockets).toHaveLength(1);
  });
  const connection = mocks.serverSockets[0];
  const failure = new Error("reset");
  connection.emit("error", failure);
  expect(mocks.logCaughtError).toHaveBeenCalledWith("CliGitBridge", failure);
  connection.emit("timeout");
  await once(client, "close");
  expect(connection.destroyed).toBe(true);
});

it("reports a socket that cannot be opened or protected", async () => {
  endpoint = null;
  await expect(
    openCliGitBridge({
      instanceId: "session-1",
      socketPath: "missing-folder/bridge.sock",
      capability: CAPABILITY,
      grant: {
        repository: "owner/repo",
        sshAlias: "alias",
        pushRefs: [],
        isAuthorized: async () => true,
      },
      remote: () =>
        spawn(process.execPath, ["-e", ECHO_PROGRAM], {
          stdio: ["pipe", "pipe", "ignore"],
        }),
    }),
  ).rejects.toThrow(/listen/u);
  mocks.chmod.mockRejectedValueOnce(new Error("chmod failed"));
  await expect(startBridge()).rejects.toThrow("chmod failed");
});

async function openWithAlias(): Promise<CliGitBridgeEndpoint> {
  return openCliGitBridge({
    instanceId: "session-1",
    socketPath: SOCKET_FILE,
    capability: CAPABILITY,
    grant: {
      repository: "owner/repo",
      sshAlias: "alias",
      pushRefs: [],
      isAuthorized: async () => true,
    },
  });
}

function answerAlias(stdout: string): void {
  mocks.execFile.mockImplementationOnce(
    (
      file: string,
      args: readonly string[],
      options: unknown,
      done: ExecCallback,
    ) => {
      done(null, { stdout });
    },
  );
}

it("accepts an alias that resolves to a GitHub host name", async () => {
  for (const host of ["github.com", "ssh.github.com"]) {
    answerAlias(`user git\nhostname ${host}\n`);
    const opened = await openWithAlias();
    await opened.close();
  }
  expect(mocks.execFile).toHaveBeenCalledWith(
    "/usr/bin/ssh",
    ["-G", "--", "alias"],
    {
      env: { PATH: "/usr/bin:/bin", HOME: homedir(), LANG: "C.UTF-8" },
      timeout: 5000,
    },
    expect.any(Function),
  );
});

it("refuses an alias that resolves elsewhere or to nothing", async () => {
  for (const stdout of ["hostname example.com\n", "port 22\n"]) {
    answerAlias(stdout);
    await expect(openWithAlias()).rejects.toMatchObject({
      code: "secret_unavailable",
    });
  }
  expect(mocks.logDiagnostic).toHaveBeenCalledTimes(2);
});
