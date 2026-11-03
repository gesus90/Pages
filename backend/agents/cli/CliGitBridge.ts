import { execFile, spawn } from "node:child_process";
import { chmod, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { Transform } from "node:stream";
import { promisify } from "node:util";

import { AgentError } from "@/backend/error/AgentErrors";
import {
  logCaughtError,
  logDiagnostic,
  logEvent,
} from "@/backend/logging/Logger";

import { decideBridgeRequest, readReceiveCommands } from "./CliGitBridgePolicy";

import type { ChildProcessByStdio } from "node:child_process";
import type { Server, Socket } from "node:net";
import type { Readable, Writable } from "node:stream";
import type { AgentPlanGitBridgeGrant } from "@/backend/service/agents/AgentPlanGitHubCredentials";
import type { GitBridgeService } from "./CliGitBridgePolicy";

type RemoteProcess = ChildProcessByStdio<Writable, Readable, null>;

/** Runs a Git service of the policy's repository on the host side. */
export type GitBridgeRemote = (service: GitBridgeService) => RemoteProcess;

/** What a session needs to start its bridge. */
export interface CliGitBridgeOptions {
  readonly instanceId: string;
  readonly socketPath: string;
  readonly capability: string;
  readonly grant: AgentPlanGitBridgeGrant;
  /** Replaces the SSH client; defaults to the fixed call of the alias. */
  readonly remote?: GitBridgeRemote;
}

/** A running bridge; closing it ends every transfer and revokes the socket. */
export interface CliGitBridgeEndpoint {
  readonly close: () => Promise<void>;
}

const SSH_BINARY = "/usr/bin/ssh";
const GITHUB_SSH_HOSTS: ReadonlySet<string> = new Set([
  "github.com",
  "ssh.github.com",
]);
const MAXIMUM_REQUEST_BYTES = 4096;
const MAXIMUM_TRANSFERS = 4;
const REQUEST_TIMEOUT_MS = 10_000;
const FIRST_ANSWER_TIMEOUT_MS = 30_000;
const TRANSFER_IDLE_TIMEOUT_MS = 10 * 60_000;
const execFileAsync = promisify(execFile);

/** The SSH client sees the account's home for its configuration and known hosts, and no other variable. */
function sshEnvironment(): Record<string, string> {
  return { PATH: "/usr/bin:/bin", HOME: homedir(), LANG: "C.UTF-8" };
}

function sshArguments(
  alias: string,
  service: GitBridgeService,
  repository: string,
): readonly string[] {
  return [
    "-T",
    "-x",
    "-a",
    "-l",
    "git",
    ...[
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
    ].flatMap((option) => ["-o", option]),
    "--",
    alias,
    `${service} '${repository}.git'`,
  ];
}

async function requireGitHubAlias(alias: string): Promise<void> {
  const { stdout } = await execFileAsync(SSH_BINARY, ["-G", "--", alias], {
    env: sshEnvironment(),
    timeout: 5000,
  });
  const hostname = /^hostname (\S+)$/mu.exec(stdout)?.[1];
  if (hostname === undefined || !GITHUB_SSH_HOSTS.has(hostname)) {
    logDiagnostic(
      "CliGitBridge",
      "error",
      `[pages] The SSH alias of a Git bridge does not resolve to GitHub: ${alias}.`,
    );
    throw new AgentError("secret_unavailable");
  }
}

/**
 * One Git protocol packet that tells the client why a push ended.
 *
 * @remarks
 * After a client asked for a side band, every packet needs its band: band 3
 * carries a fatal error, and Git would not read a plain error packet.
 */
function refusalPacket(message: string, hasSideBand: boolean): Buffer {
  const payload = hasSideBand
    ? Buffer.concat([Buffer.from([3]), Buffer.from(`${message}\n`)])
    : Buffer.from(`ERR ${message}\n`);
  return Buffer.concat([
    Buffer.from((payload.length + 4).toString(16).padStart(4, "0")),
    payload,
  ]);
}

/**
 * Starts the host side of one session's Git bridge.
 *
 * @param options - Session identity, private socket, capability and grant.
 * @returns The running endpoint.
 * @throws {AgentError} `secret_unavailable` when the alias does not resolve to GitHub.
 *
 * @remarks
 * The socket lies in the private folder of the session, which only that
 * namespace mounts. Each connection must name the session's capability and the
 * granted repository before an SSH client starts, and the grant is checked
 * again against live access. No key, configuration, home or agent socket enters
 * the namespace: the session only exchanges Git protocol bytes with this process.
 */
export async function openCliGitBridge(
  options: CliGitBridgeOptions,
): Promise<CliGitBridgeEndpoint> {
  const { grant, socketPath } = options;
  if (options.remote === undefined) await requireGitHubAlias(grant.sshAlias);
  const remote: GitBridgeRemote =
    options.remote ??
    ((service) =>
      spawn(
        SSH_BINARY,
        sshArguments(grant.sshAlias, service, grant.repository),
        { stdio: ["pipe", "pipe", "ignore"], env: sshEnvironment() },
      ));
  const bridge = new GitBridgeServer(options, remote);
  const server = createServer({ allowHalfOpen: true }, (connection) => {
    bridge.accept(connection);
  });
  await listen(server, socketPath);
  try {
    await chmod(socketPath, 0o600);
  } catch (caughtError: unknown) {
    server.close();
    throw caughtError;
  }
  return {
    close: async () => {
      bridge.endAll();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

/** The live connections of one bridge. */
class GitBridgeServer {
  private readonly options: CliGitBridgeOptions;
  private readonly remote: GitBridgeRemote;
  private readonly connections = new Set<Socket>();
  private readonly children = new Set<RemoteProcess>();

  public constructor(options: CliGitBridgeOptions, remote: GitBridgeRemote) {
    this.options = options;
    this.remote = remote;
  }

  /** Reads the request line of a new connection, within a size and time limit. */
  public accept(connection: Socket): void {
    this.connections.add(connection);
    connection.on("error", (error: unknown) => {
      logCaughtError("CliGitBridge", error);
    });
    connection.on("close", () => this.connections.delete(connection));
    if (this.connections.size > MAXIMUM_TRANSFERS) {
      this.refuse(connection, "too many transfers");
      return;
    }
    connection.setTimeout(REQUEST_TIMEOUT_MS, () => connection.destroy());
    let received = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      received = Buffer.concat([received, chunk]);
      const end = received.indexOf(10);
      if (end < 0 && received.length <= MAXIMUM_REQUEST_BYTES) return;
      connection.off("data", onData);
      connection.pause();
      if (end >= 0) connection.unshift(received.subarray(end + 1));
      void this.handle(
        connection,
        received.toString("utf8", 0, Math.max(end, 0)),
      );
    };
    connection.on("data", onData);
  }

  /** Ends every transfer of this bridge. */
  public endAll(): void {
    for (const child of this.children) child.kill("SIGTERM");
    for (const connection of this.connections) connection.destroy();
  }

  private async handle(connection: Socket, line: string): Promise<void> {
    const { capability, grant } = this.options;
    const decision = decideBridgeRequest(line, {
      capability,
      repository: grant.repository,
      pushRefs: grant.pushRefs,
    });
    if (!decision.isAllowed) {
      this.refuse(connection, decision.reason);
      return;
    }
    if (!(await this.isStillAuthorized())) {
      this.refuse(connection, "project access changed");
      return;
    }
    if (connection.destroyed) return;
    this.transfer(connection, decision.service);
  }

  private async isStillAuthorized(): Promise<boolean> {
    try {
      return await this.options.grant.isAuthorized();
    } catch (caughtError: unknown) {
      logCaughtError("CliGitBridge", caughtError);
      return false;
    }
  }

  private refuse(connection: Socket, reason: string): void {
    this.audit("refused", { reason });
    connection.end(`Pages Git bridge refused: ${reason}\n`);
    // Reading on lets the half-open connection close, so it stops counting as a transfer.
    connection.resume();
  }

  private transfer(connection: Socket, service: GitBridgeService): void {
    const child = this.remote(service);
    this.children.add(child);
    let updates: readonly string[] = [];
    const guard = this.guardFor(service, {
      accepted: (refs) => {
        updates = refs;
      },
      refused: (reason, hasSideBand) => {
        this.audit("refused", { operation: service, reason });
        child.stdout.unpipe(connection);
        child.kill("SIGKILL");
        connection.end(
          refusalPacket(`Pages Git bridge refused: ${reason}`, hasSideBand),
        );
      },
    });
    child.stdin.on("error", (error: unknown) => {
      logCaughtError("CliGitBridge", error);
    });
    child.on("error", (error: unknown) => {
      logCaughtError("CliGitBridge", error);
      connection.destroy();
    });
    connection.on("close", () => child.kill("SIGTERM"));
    child.on("close", (code) => {
      this.children.delete(child);
      this.audit("closed", {
        operation: service,
        exitCode: code,
        refUpdates: updates.length,
        updatedRefs: updates.join(" "),
      });
    });
    connection.setTimeout(TRANSFER_IDLE_TIMEOUT_MS);
    connection.pipe(guard).pipe(child.stdin);
    this.answerFirst(connection, child);
    connection.resume();
  }

  /** Only the first bytes of GitHub show that the host identity was accepted, so they open the transfer. */
  private answerFirst(connection: Socket, child: RemoteProcess): void {
    const timer = setTimeout(
      () => child.kill("SIGTERM"),
      FIRST_ANSWER_TIMEOUT_MS,
    );
    const onClose = (): void => {
      clearTimeout(timer);
      connection.end(
        `Pages Git bridge could not reach ${this.options.grant.repository} with the host identity.\n`,
      );
    };
    child.once("close", onClose);
    child.stdout.once("data", (chunk: Buffer) => {
      clearTimeout(timer);
      child.off("close", onClose);
      connection.write("ok\n");
      connection.write(chunk);
      child.stdout.pipe(connection);
    });
  }

  private guardFor(
    service: GitBridgeService,
    outcome: {
      readonly accepted: (refs: readonly string[]) => void;
      readonly refused: (reason: string, hasSideBand: boolean) => void;
    },
  ): Transform {
    const { pushRefs } = this.options.grant;
    let pending: Buffer | null =
      service === "git-receive-pack" ? Buffer.alloc(0) : null;
    let isRefused = false;
    return new Transform({
      transform: (chunk: Buffer, encoding, done) => {
        if (isRefused) return done();
        if (pending === null) return done(null, chunk);
        const buffered = Buffer.concat([pending, chunk]);
        const commands = readReceiveCommands(buffered, pushRefs);
        if (commands.state === "incomplete") {
          pending = buffered;
          return done();
        }
        if (commands.state === "refused") {
          isRefused = true;
          outcome.refused(commands.reason, buffered.includes("side-band"));
          return done();
        }
        pending = null;
        outcome.accepted(commands.refs);
        return done(null, buffered);
      },
    });
  }

  private audit(
    outcome: "refused" | "closed",
    details: Readonly<Record<string, string | number | null>>,
  ): void {
    logEvent({
      level: "info",
      event: `agent.git_bridge.${outcome}`,
      component: "CliGitBridge",
      message: `A Git bridge transfer was ${outcome}.`,
      metadata: {
        sessionId: this.options.instanceId,
        repository: this.options.grant.repository,
        ...details,
      },
    });
  }
}

/**
 * Writes the program Git starts instead of an SSH client inside the namespace.
 *
 * @param file - Where the program goes, in the private folder of the session.
 * @param socketPath - The socket of the session's bridge.
 * @param capability - The capability of the session.
 *
 * @remarks
 * Git calls it with the destination and the service command. It holds no
 * secret beyond this session's own capability and relays bytes only.
 */
export async function writeGitBridgeClient(
  file: string,
  socketPath: string,
  capability: string,
): Promise<void> {
  await writeFile(
    file,
    `"use strict";
const net = require("node:net");
const [destination, command] = process.argv.slice(2);
const socket = net.createConnection({ path: ${JSON.stringify(socketPath)}, allowHalfOpen: true });
const fail = (message) => {
  process.stderr.write(message + "\\n");
  process.exit(128);
};
socket.on("error", () => fail("Pages Git bridge refused: this session has no running bridge"));
socket.write(JSON.stringify({ capability: ${JSON.stringify(capability)}, destination, command }) + "\\n");
let head = Buffer.alloc(0);
const onData = (chunk) => {
  head = Buffer.concat([head, chunk]);
  const end = head.indexOf(10);
  if (end < 0) return;
  const answer = head.toString("utf8", 0, end);
  if (answer !== "ok") fail(answer);
  socket.off("data", onData);
  socket.on("close", () => process.exit(0));
  process.stdout.on("error", () => process.exit(128));
  process.stdout.write(head.subarray(end + 1));
  socket.pipe(process.stdout, { end: false });
  process.stdin.pipe(socket);
};
socket.on("data", onData);
socket.on("end", () => {
  if (head.indexOf(10) < 0) fail("Pages Git bridge refused: the bridge ended the connection");
});
`,
    { mode: 0o600, flag: "wx" },
  );
}
