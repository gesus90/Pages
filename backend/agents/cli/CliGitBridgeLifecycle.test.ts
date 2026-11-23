import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import path from "node:path";
import { homedir } from "node:os";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  openCliGitBridge,
  writeGitBridgeClient,
} from "@/backend/agents/cli/CliGitBridge";
import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import type * as ChildProcessModule from "node:child_process";
import type * as NetModule from "node:net";
import type { ChildProcess, ChildProcessByStdio } from "node:child_process";
import type { Socket } from "node:net";
import type { Readable, Writable } from "node:stream";
import type { CliGitBridgeEndpoint } from "@/backend/agents/cli/CliGitBridge";

type Remote = ChildProcessByStdio<Writable, Readable, null>;
type ExecCallback = (
  error: Error | null,
  result?: { readonly stdout: string },
) => void;

const mocks = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
  logEvent: vi.fn(),
  execFile: vi.fn(),
  spawn:
    vi.fn<
      (file: string, args: readonly string[], options: unknown) => Remote
    >(),
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
  spawn: mocks.spawn,
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

const { spawn: startProgram } =
  await vi.importActual<typeof ChildProcessModule>("node:child_process");

const ECHO_PROGRAM =
  'process.stdout.write("advert\\n"); process.stdin.pipe(process.stdout);';
const SILENT_PROGRAM = "setInterval(() => undefined, 1000);";
const EXIT_PROGRAM = "process.exit(3);";
const CAPABILITY = "synthetic-capability";
const SOCKET_FILE = "bridge.sock";
const CLIENT_FILE = "client.cjs";
const startDirectory = process.cwd();
let directory = "";
let endpoint: CliGitBridgeEndpoint | null = null;
let children: Remote[] = [];

beforeEach(async () => {
  mocks.spawn.mockImplementation(() =>
    startProgram(process.execPath, ["-e", ECHO_PROGRAM], {
      stdio: ["pipe", "pipe", "ignore"],
    }),
  );
  mocks.execFile.mockImplementation(
    (
      file: string,
      args: readonly string[],
      options: unknown,
      done: ExecCallback,
    ) => {
      done(null, { stdout: "hostname github.com\n" });
    },
  );
  const root = pagesTempDirectory("git-bridge-test");
  await mkdir(root, { recursive: true, mode: 0o700 });
  directory = await mkdtemp(path.join(root, "lifecycle-"));
  // The socket path stays relative because an absolute one can exceed the limit of the system.
  process.chdir(directory);
  children = [];
  mocks.serverSockets.length = 0;
});

afterEach(async () => {
  vi.useRealTimers();
  await endpoint?.close();
  endpoint = null;
  await Promise.all(
    children.map((child) =>
      child.exitCode === null && child.signalCode === null
        ? once(child, "close")
        : undefined,
    ),
  );
  process.chdir(startDirectory);
  await rm(directory, { recursive: true, force: true });
});

function program(source: string): () => Remote {
  return () => {
    const child = startProgram(process.execPath, ["-e", source], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    children.push(child);
    return child;
  };
}

async function startBridge(remote?: () => Remote): Promise<void> {
  endpoint = await openCliGitBridge({
    instanceId: "session-1",
    socketPath: SOCKET_FILE,
    capability: CAPABILITY,
    grant: {
      repository: "owner/repo",
      sshAlias: "alias",
      pushRefs: [],
      isAuthorized: async () => true,
    },
    remote,
  });
}

function requestLine(command: string): string {
  return `${JSON.stringify({
    capability: CAPABILITY,
    destination: "git@github.com",
    command,
  })}\n`;
}

const FETCH_REQUEST = requestLine("git-upload-pack 'owner/repo'");

/** Connects, sends the fetch request and collects what the bridge answers. */
function connect(): { client: Socket; received: () => string } {
  const client = createConnection({ path: SOCKET_FILE, allowHalfOpen: true });
  const parts: Buffer[] = [];
  client.on("data", (chunk: Buffer) => parts.push(chunk));
  client.on("error", () => undefined);
  client.on("end", () => client.end());
  client.write(FETCH_REQUEST);
  return { client, received: () => Buffer.concat(parts).toString("utf8") };
}

/** Runs a written client program the way Git does: with the destination and the service command. */
function runClient(
  file: string,
): ChildProcessByStdio<Writable, Readable, Readable> {
  return startProgram(
    process.execPath,
    [file, "git@github.com", "git-upload-pack 'owner/repo'"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
}

function exitCode(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    child.once("close", (code: number | null) => {
      resolve(code);
    });
  });
}

function closedAudits(): unknown[] {
  return mocks.logEvent.mock.calls
    .map(([event]) => event)
    .filter((event) => event.event === "agent.git_bridge.closed");
}

it("starts the SSH client of the alias with a fixed argument list and environment", async () => {
  await startBridge();
  const { client, received } = connect();
  await vi.waitFor(() => {
    expect(received()).toBe("ok\nadvert\n");
  });
  client.end();
  await once(client, "close");
  const sshOptions = [
    "BatchMode=yes",
    "StrictHostKeyChecking=yes",
    "UpdateHostKeys=no",
    "ClearAllForwardings=yes",
    "ForwardAgent=no",
    "PermitLocalCommand=no",
    "RequestTTY=no",
    "ControlMaster=no",
    "ControlPath=none",
    "ConnectTimeout=20",
    "ServerAliveInterval=15",
    "ServerAliveCountMax=4",
  ].flatMap((option) => ["-o", option]);
  expect(mocks.spawn).toHaveBeenCalledWith(
    "/usr/bin/ssh",
    [
      "-T",
      "-x",
      "-a",
      "-l",
      "git",
      ...sshOptions,
      "--",
      "alias",
      "git-upload-pack 'owner/repo.git'",
    ],
    {
      stdio: ["pipe", "pipe", "ignore"],
      env: { PATH: "/usr/bin:/bin", HOME: homedir(), LANG: "C.UTF-8" },
    },
  );
});

it("tells the client when the program ends before GitHub answered", async () => {
  await startBridge(program(EXIT_PROGRAM));
  const { client, received } = connect();
  await once(client, "close");
  expect(received()).toBe(
    "Pages Git bridge could not reach owner/repo with the host identity.\n",
  );
  await vi.waitFor(() => {
    expect(closedAudits()).toHaveLength(1);
  });
});

it("stops a program that gives no first answer within thirty seconds", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await startBridge(program(SILENT_PROGRAM));
  const { client, received } = connect();
  await vi.waitFor(() => {
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    expect(children).toHaveLength(1);
  });
  vi.advanceTimersByTime(30_000);
  await once(client, "close");
  expect(received()).toContain("could not reach owner/repo");
  expect(children[0]?.signalCode).toBe("SIGTERM");
});

it("logs and drops the connection when the program cannot start", async () => {
  await startBridge(() => {
    const child = startProgram("/nonexistent/program", [], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    children.push(child);
    return child;
  });
  const { client } = connect();
  await once(client, "close");
  expect(mocks.logCaughtError).toHaveBeenCalledWith(
    "CliGitBridge",
    expect.objectContaining({ code: "ENOENT" }),
  );
});

it("logs an error on the input of the program", async () => {
  await startBridge(program(ECHO_PROGRAM));
  const { client, received } = connect();
  await vi.waitFor(() => {
    expect(received()).toBe("ok\nadvert\n");
  });
  const failure = new Error("broken pipe");
  children[0]?.stdin.emit("error", failure);
  expect(mocks.logCaughtError).toHaveBeenCalledWith("CliGitBridge", failure);
  client.destroy();
});

it("ends the program with a signal when the client drops the connection", async () => {
  await startBridge(program(ECHO_PROGRAM));
  const { received } = connect();
  await vi.waitFor(() => {
    expect(received()).toBe("ok\nadvert\n");
  });
  mocks.serverSockets[0]?.destroy();
  await vi.waitFor(() => {
    expect(closedAudits()).toMatchObject([
      { metadata: { exitCode: null, operation: "git-upload-pack" } },
    ]);
  });
  expect(children[0]?.signalCode).toBe("SIGTERM");
});

it("ends every transfer and the socket when the bridge closes", async () => {
  await startBridge(program(ECHO_PROGRAM));
  const { client, received } = connect();
  await vi.waitFor(() => {
    expect(received()).toBe("ok\nadvert\n");
  });
  await endpoint?.close();
  endpoint = null;
  await once(client, "close");
  await vi.waitFor(() => {
    expect(children[0]?.signalCode).toBe("SIGTERM");
  });
  await expect(access(SOCKET_FILE)).rejects.toThrow();
});

it("writes a private client program once and relays through the bridge", async () => {
  await startBridge(program(ECHO_PROGRAM));
  await writeGitBridgeClient(CLIENT_FILE, SOCKET_FILE, CAPABILITY);
  expect((await stat(CLIENT_FILE)).mode & 0o777).toBe(0o600);
  expect(await readFile(CLIENT_FILE, "utf8")).toContain(
    JSON.stringify(CAPABILITY),
  );
  await expect(
    writeGitBridgeClient(CLIENT_FILE, SOCKET_FILE, CAPABILITY),
  ).rejects.toMatchObject({ code: "EEXIST" });
  const child = runClient(CLIENT_FILE);
  const output: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
  child.stdin.end("ping");
  expect(await exitCode(child)).toBe(0);
  expect(Buffer.concat(output).toString("utf8")).toBe("advert\nping");
});

it("stops the client program with a clear message when the bridge refuses or is missing", async () => {
  await startBridge(program(ECHO_PROGRAM));
  await writeGitBridgeClient("other.cjs", SOCKET_FILE, "other-capability");
  await writeGitBridgeClient("lost.cjs", "missing.sock", CAPABILITY);
  for (const [file, message] of [
    ["other.cjs", "Pages Git bridge refused: not this session"],
    ["lost.cjs", "this session has no running bridge"],
  ] as const) {
    const child = runClient(file);
    const errors: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.stdin.end();
    expect(await exitCode(child)).toBe(128);
    expect(Buffer.concat(errors).toString("utf8")).toContain(message);
  }
});
