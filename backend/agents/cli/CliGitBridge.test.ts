import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { openCliGitBridge } from "@/backend/agents/cli/CliGitBridge";
import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type {
  CliGitBridgeEndpoint,
  GitBridgeRemote,
} from "@/backend/agents/cli/CliGitBridge";

const logging = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => logging);

type Remote = ChildProcessByStdio<Writable, Readable, null>;

/** A local program that answers like GitHub and then repeats what it receives. */
const ECHO_PROGRAM =
  'process.stdout.write("advert\\n"); process.stdin.pipe(process.stdout);';
const CAPABILITY = "synthetic-capability";
const OLD_HASH = "a".repeat(40);
const NEW_HASH = "b".repeat(40);

const SOCKET_FILE = "bridge.sock";
const startDirectory = process.cwd();
let directory = "";
let endpoint: CliGitBridgeEndpoint | null = null;
let services: string[] = [];
let children: Remote[] = [];

beforeEach(async () => {
  const root = pagesTempDirectory("git-bridge-test");
  await mkdir(root, { recursive: true, mode: 0o700 });
  directory = await mkdtemp(path.join(root, "bridge-"));
  // The socket path stays relative because an absolute one can exceed the limit of the system.
  process.chdir(directory);
  services = [];
  children = [];
});

afterEach(async () => {
  await endpoint?.close();
  endpoint = null;
  process.chdir(startDirectory);
  await rm(directory, { recursive: true, force: true });
  logging.logCaughtError.mockReset();
  logging.logEvent.mockReset();
});

async function startBridge(pushRefs: readonly string[]): Promise<string> {
  const socketPath = SOCKET_FILE;
  const remote: GitBridgeRemote = (service) => {
    services.push(service);
    const child = spawn(process.execPath, ["-e", ECHO_PROGRAM], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    children.push(child);
    return child;
  };
  endpoint = await openCliGitBridge({
    instanceId: "session-1",
    socketPath,
    capability: CAPABILITY,
    grant: {
      repository: "owner/repo",
      sshAlias: "alias",
      pushRefs,
      isAuthorized: async () => true,
    },
    remote,
  });
  return socketPath;
}

function requestLine(command: string): string {
  return `${JSON.stringify({
    capability: CAPABILITY,
    destination: "git@github.com",
    command,
  })}\n`;
}

function packet(payload: string): Buffer {
  const body = Buffer.from(payload);
  return Buffer.concat([
    Buffer.from((body.length + 4).toString(16).padStart(4, "0")),
    body,
  ]);
}

/** Sends `chunks`, then `followUps` once the program has answered, as Git does after reading the advertisement. */
async function converse(
  socketPath: string,
  chunks: readonly (string | Buffer)[],
  followUps: readonly (string | Buffer)[] = [],
): Promise<string> {
  const client = createConnection({ path: socketPath, allowHalfOpen: true });
  const received: Buffer[] = [];
  client.on("data", (chunk: Buffer) => received.push(chunk));
  const send = async (parts: readonly (string | Buffer)[]): Promise<void> => {
    for (const chunk of parts) {
      client.write(chunk);
      // A pause keeps the chunks apart, so the bridge reads each one on its own.
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  await send(chunks);
  await vi.waitFor(() => {
    expect(Buffer.concat(received).toString("utf8")).toContain("advert\n");
  });
  await send(followUps);
  client.end();
  await once(client, "close");
  return Buffer.concat(received).toString("utf8");
}

function closedAudit(): unknown {
  return logging.logEvent.mock.calls
    .map(([event]) => event)
    .find((event) => event.event === "agent.git_bridge.closed");
}

it("relays a fetch, including bytes that arrive with the request line", async () => {
  const socketPath = await startBridge([]);
  const answer = await converse(socketPath, [
    `${requestLine("git-upload-pack 'owner/repo.git'")}first`,
    "second",
  ]);
  expect(answer).toBe("ok\nadvert\nfirstsecond");
  expect(services).toEqual(["git-upload-pack"]);
  await vi.waitFor(() => {
    expect(closedAudit()).toMatchObject({
      level: "info",
      component: "CliGitBridge",
      metadata: {
        sessionId: "session-1",
        repository: "owner/repo",
        operation: "git-upload-pack",
        exitCode: 0,
        refUpdates: 0,
        updatedRefs: "",
      },
    });
  });
});

it("forwards a push only once its update commands are complete and allowed", async () => {
  const socketPath = await startBridge(["refs/heads/work"]);
  const command = packet(
    `${OLD_HASH} ${NEW_HASH} refs/heads/work\0report-status\n`,
  );
  const pack = Buffer.from("PACKDATA");
  const answer = await converse(
    socketPath,
    [requestLine("git-receive-pack 'owner/repo'")],
    [
      command.subarray(0, 10),
      Buffer.concat([command.subarray(10), Buffer.from("0000")]),
      pack,
    ],
  );
  expect(answer).toBe(
    `ok\nadvert\n${command.toString()}0000${pack.toString()}`,
  );
  await vi.waitFor(() => {
    expect(closedAudit()).toMatchObject({
      metadata: {
        operation: "git-receive-pack",
        refUpdates: 1,
        updatedRefs: "refs/heads/work",
      },
    });
  });
});

it("refuses a push to another branch with a packet the client can read", async () => {
  const socketPath = await startBridge(["refs/heads/work"]);
  const command = packet(`${OLD_HASH} ${NEW_HASH} refs/heads/main\n`);
  const answer = await converse(
    socketPath,
    [requestLine("git-receive-pack 'owner/repo'")],
    [command, "later bytes are dropped"],
  );
  const message =
    "Pages Git bridge refused: updating refs/heads/main is not allowed";
  expect(answer).toContain(`ERR ${message}\n`);
  expect(answer).not.toContain("later bytes");
  expect(logging.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "agent.git_bridge.refused",
      metadata: {
        sessionId: "session-1",
        repository: "owner/repo",
        operation: "git-receive-pack",
        reason: "updating refs/heads/main is not allowed",
      },
    }),
  );
});

it("uses the error band of the side band when the client asked for one", async () => {
  const socketPath = await startBridge(["refs/heads/work"]);
  const command = packet(
    `${OLD_HASH} ${"0".repeat(40)} refs/heads/work\0side-band-64k\n`,
  );
  const answer = await converse(
    socketPath,
    [requestLine("git-receive-pack 'owner/repo'")],
    [command],
  );
  const message =
    "Pages Git bridge refused: deleting refs/heads/work is not allowed\n";
  const payload = `\u0003${message}`;
  expect(answer).toContain(
    `${(payload.length + 4).toString(16).padStart(4, "0")}${payload}`,
  );
});
