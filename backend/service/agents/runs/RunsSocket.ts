import { chmod, mkdir, lstat, unlink } from "node:fs/promises";
import { createServer, request } from "node:http";
import path from "node:path";

import { z } from "zod";

import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import {
  PAGES_RUNNER_DISPATCH_ERRORS,
  PAGES_RUNNER_TIMEOUT_MS,
  PAGES_RUNNER_MAX_BYTES,
  pagesRunnerReplySchema,
} from "@/definition/PagesRunsRunner";
import {
  pagesRunsOwnershipReplySchema,
  pagesRunsSwarmReplySchema,
  PAGES_RUNS_PROTOCOL,
  PAGES_RUNS_TIMEOUT_MS,
  pagesRunsWakeSchema,
  pagesRunsReplySchema,
} from "@/definition/PagesRuns";
import { AgentError, isAgentErrorCode } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { SwarmCallError } from "../swarm/SwarmRegistry";
import { planWritingWorkspaces } from "../AgentPlanContinuation";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanSnapshot } from "../AgentPlanSnapshot";

import type { SwarmCall } from "../swarm/SwarmRegistry";
import type { Server, IncomingMessage, ServerResponse } from "node:http";

/** Stable private socket shared by API and scheduler for this data directory. */
export function runsSocketPath(databasePath: string): string {
  return path.join(path.dirname(databasePath), "runs-control", "engine.sock");
}

/** Calls one versioned API operation with an absolute deadline and no persistent channel. */
export async function callRunApi(
  socketPath: string,
  input: unknown,
): Promise<unknown> {
  const reply = pagesRunnerReplySchema.parse(
    await socketRequest(socketPath, "/v1/runner", input),
  );
  if (reply.ok) return reply.result;
  if (reply.error === PAGES_RUNNER_DISPATCH_ERRORS.PAUSED)
    throw new AgentPlanPausedError();
  if (reply.error === PAGES_RUNNER_DISPATCH_ERRORS.CANCELLED)
    throw new AgentPlanCancelledError();
  if (isAgentErrorCode(reply.error)) throw new AgentError(reply.error);
  throw new Error("Run API unavailable");
}

/** Observes engine ownership through a bounded request; callers keep cleanup conservative on failure. */
export async function queryRunOwnership(
  socketPath: string,
  runId: string,
): Promise<boolean> {
  const reply = pagesRunnerReplySchema.parse(
    await socketRequest(socketPath, "/v1/engine", {
      version: 1,
      operation: "ownership",
      runId,
    }),
  );
  if (!reply.ok) throw new Error("Run ownership unavailable");
  return pagesRunsOwnershipReplySchema.parse(reply.result).active;
}

/** Hands forced start cleanup to the process that owns the native sessions. */
export async function releaseRunsStartResources(
  socketPath: string,
  run: AgentPlanRun,
  snapshot: AgentPlanSnapshot,
): Promise<readonly string[]> {
  const reply = pagesRunnerReplySchema.parse(
    await socketRequest(socketPath, "/v1/engine", {
      version: 1,
      operation: "start_resources",
      start: {
        id: run.id,
        userId: run.userId,
        planId: run.planId,
        ...(run.origin?.kind === "restart"
          ? { sourceRunId: run.origin.runId }
          : {}),
      },
      resourceKeys: planWritingWorkspaces(snapshot),
    }),
  );
  if (!reply.ok) throw new Error("Start resource cleanup unavailable");
  return z.array(z.string()).parse(reply.result);
}

/**
 * Hands a swarm tool call to the engine process (PAGE-313).
 *
 * @throws {SwarmCallError} When the engine refused the call.
 */
export async function callRunsSwarm(
  socketPath: string,
  call: SwarmCall,
): Promise<unknown> {
  const reply = pagesRunnerReplySchema.parse(
    await socketRequest(socketPath, "/v1/engine", {
      version: 1,
      operation: "swarm",
      runId: call.runId,
      stepId: call.stepId,
      swarmOperation: call.operation,
      parameters: call.parameters,
    }),
  );
  if (!reply.ok) throw new Error("Swarm call unavailable");
  const answer = pagesRunsSwarmReplySchema.parse(reply.result);
  if ("refused" in answer) throw new SwarmCallError(answer.refused);
  return answer.result;
}

/** Best-effort wakeup. A missing peer leaves the command in the durable inbox. */
export async function notifyRuns(socketPath: string): Promise<boolean> {
  try {
    return pagesRunsReplySchema.safeParse(
      await socketRequest(socketPath, "/v1/wake", {
        version: PAGES_RUNS_PROTOCOL,
        operation: "wake",
      }),
    ).success;
  } catch {
    return false;
  }
}

function socketRequest(
  socketPath: string,
  endpoint: string,
  input: unknown,
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const call = request(
      { socketPath, method: "POST", path: endpoint, agent: false },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
          if (Buffer.byteLength(body) > PAGES_RUNNER_MAX_BYTES)
            call.destroy(new Error("Run API reply too large"));
        });
        response.on("error", reject);
        response.on("end", () => {
          clearTimeout(timer);
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("Invalid run API reply"));
          }
        });
      },
    );
    const timer = setTimeout(
      () => call.destroy(new Error("Run API deadline exceeded")),
      endpoint === "/v1/wake" ? PAGES_RUNS_TIMEOUT_MS : PAGES_RUNNER_TIMEOUT_MS,
    );
    call.on("error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
    const body = JSON.stringify(input);
    if (Buffer.byteLength(body) > PAGES_RUNNER_MAX_BYTES)
      call.destroy(new Error("Run API request too large"));
    else call.end(body);
  });
}

/** Versioned bounded local endpoint. Only the database lock owner may bind or remove its socket. */
export class RunsSocket {
  private readonly socketPath: string;
  private readonly wake: () => void;
  private readonly server: Server;
  private readonly controlEndpoint: "/v1/runner" | "/v1/engine";
  private readonly handleApi:
    ((input: unknown) => Promise<unknown>) | undefined;

  public constructor(
    socketPath: string,
    wake: () => void,
    handleApi?: (input: unknown) => Promise<unknown>,
    endpoint: "/v1/runner" | "/v1/engine" = "/v1/runner",
  ) {
    this.controlEndpoint = endpoint;
    this.handleApi = handleApi;
    this.socketPath = socketPath;
    this.wake = wake;
    this.server = createServer((incoming, response) => {
      void this.handle(incoming, response).catch((error: unknown) => {
        logCaughtError("RunsSocket", error);
        response.destroy();
      });
    });
    this.server.requestTimeout = PAGES_RUNNER_TIMEOUT_MS;
    this.server.headersTimeout = PAGES_RUNNER_TIMEOUT_MS;
    this.server.timeout = PAGES_RUNNER_TIMEOUT_MS;
  }

  /** Binds inside a private directory after exclusive ownership has been established. */
  public async listen(): Promise<void> {
    const directory = path.dirname(this.socketPath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const parent = await lstat(directory);
    if (!parent.isDirectory() || parent.uid !== process.getuid?.())
      throw new Error("Unsafe run socket directory");
    await chmod(directory, 0o700);
    try {
      const previous = await lstat(this.socketPath);
      if (!previous.isSocket() || previous.uid !== process.getuid?.())
        throw new Error("Unsafe run socket path");
      await unlink(this.socketPath);
    } catch (error: unknown) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.socketPath, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    this.server.on("error", (error: Error) =>
      logCaughtError("RunsSocket", error),
    );
    await chmod(this.socketPath, 0o600);
  }

  /** Closes the listener before the engine drains; no caller waits for this process. */
  public async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private async handle(
    incoming: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const timer = setTimeout(() => response.destroy(), PAGES_RUNNER_TIMEOUT_MS);
    try {
      const isWake = incoming.url === "/v1/wake";
      const isControl = this.handleApi && incoming.url === this.controlEndpoint;
      if (incoming.method !== "POST" || (!isWake && !isControl)) {
        response.writeHead(404).end();
        return;
      }
      let body = "";
      incoming.setEncoding("utf8");
      for await (const chunk of incoming) {
        body += String(chunk);
        if (Buffer.byteLength(body) > PAGES_RUNNER_MAX_BYTES) {
          response.writeHead(413).end();
          return;
        }
      }
      const input: unknown = JSON.parse(body);
      const reply =
        !isWake && this.handleApi
          ? { version: 1, ok: true, result: await this.handleApi(input) }
          : this.wakeReply(input);
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(reply));
    } catch (error: unknown) {
      response.writeHead(503, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          version: 1,
          ok: false,
          error: runServiceError(error),
        }),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private wakeReply(input: unknown): unknown {
    pagesRunsWakeSchema.parse(input);
    this.wake();
    return { version: PAGES_RUNS_PROTOCOL, accepted: true };
  }
}

function runServiceError(error: unknown): string {
  if (error instanceof AgentPlanPausedError)
    return PAGES_RUNNER_DISPATCH_ERRORS.PAUSED;
  if (error instanceof AgentPlanCancelledError)
    return PAGES_RUNNER_DISPATCH_ERRORS.CANCELLED;
  return error instanceof AgentError ? error.code : "unavailable";
}
