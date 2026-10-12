import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { agentApiFailure } from "@/app/lib/agent-api-response.server";
import { readAgentJson } from "@/app/lib/agent-json.server";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Server } from "node:http";
import type { TicketHarness } from "./mcp-tickets";

const REPLY_TIMEOUT_MS = 15_000;
const EXIT_TIMEOUT_MS = 5_000;
const BUILD_TIMEOUT_MS = 60_000;
/** The request headers the Pages agent route reads. */
const FORWARDED_HEADERS = ["authorization", "content-type", "content-length"];

/** A built bundle and the directory that holds it. */
export interface BuiltBundle {
  readonly file: string;
  readonly directory: string;
}

/**
 * Builds the single-file bundle exactly as `mcp/build.config.ts` does.
 *
 * @returns The bundle file and the temporary directory to remove afterwards.
 *
 * @remarks
 * The build runs in a temporary directory, so neither `mcp/dist` nor any other
 * file of the repository changes.
 */
export async function buildBundle(): Promise<BuiltBundle> {
  const directory = await mkdtemp(path.join(tmpdir(), "pages-mcp-bundle-"));
  const config = fileURLToPath(
    new URL("../../mcp/build.config.ts", import.meta.url),
  );
  const source = fileURLToPath(new URL("../../mcp/src", import.meta.url));
  await symlink(source, path.join(directory, "src"), "dir");
  const build = spawnSync(process.execPath, [config], {
    cwd: directory,
    encoding: "utf8",
    timeout: BUILD_TIMEOUT_MS,
  });
  if (build.status !== 0)
    throw new Error(`The bundle did not build: ${build.stderr}`);
  return {
    directory,
    file: path.join(directory, "dist", "pages-mcp-v0.1.0.js"),
  };
}

/** Removes the directory of a built bundle. */
export async function removeBundle(bundle: BuiltBundle): Promise<void> {
  await rm(bundle.directory, { recursive: true, force: true });
}

/**
 * Answers the agent API over HTTP like the Pages route does: verify first,
 * then handle, with the same fixed failure bodies.
 */
function agentApiHandler(
  harness: TicketHarness,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const authorization = request.headers.get("Authorization") ?? "";
    if (!/^Bearer [A-Za-z0-9._~+/-]+=*$/i.test(authorization))
      return agentApiFailure("AUTH_REQUIRED", 401);
    const token = authorization.slice(7);
    const service = harness.services.pagesAgentApiService;
    try {
      await service.verify(token);
      return Response.json(
        await service.handle(token, await readAgentJson(request)),
      );
    } catch (error: unknown) {
      if (error instanceof AgentOperationError)
        return agentApiFailure(error.code, error.status, error.details);
      if (error instanceof McpAuthorizationError)
        return agentApiFailure("AUTH_INVALID", error.status);
      throw error;
    }
  };
}

/** A listener in front of the Pages agent API of a fixture. */
export interface PagesListener {
  /** Base URL to give the bundle as `PAGES_URL`. */
  readonly url: string;
  close(): Promise<void>;
}

/**
 * Serves `/api/v1/agents` of a fixture on a free loopback port.
 *
 * @param harness - The fixture whose Pages API service answers.
 * @returns The base URL and a function that closes the listener.
 */
export async function startPagesListener(
  harness: TicketHarness,
): Promise<PagesListener> {
  const answer = agentApiHandler(harness);
  const server: Server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      void (async () => {
        const request = new Request("http://127.0.0.1/api/v1/agents", {
          method: incoming.method ?? "POST",
          headers: Object.fromEntries(
            FORWARDED_HEADERS.flatMap((name) => {
              const value = incoming.headers[name];
              return typeof value === "string" ? [[name, value]] : [];
            }),
          ),
          body: Buffer.concat(chunks),
        });
        try {
          const response = await answer(request);
          outgoing.writeHead(
            response.status,
            Object.fromEntries(response.headers),
          );
          outgoing.end(Buffer.from(await response.arrayBuffer()));
        } catch {
          outgoing.writeHead(503);
          outgoing.end();
        }
      })();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("The listener has no port.");
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One JSON-RPC reply of the bundle. */
export interface BundleReply {
  readonly id: number;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code: number; readonly message: string };
}

/** A stdio MCP client of one bundle process, signed in as one person. */
export class BundleClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly waiting = new Map<number, (reply: BundleReply) => void>();
  private buffered = "";
  private nextId = 0;
  private stderr = "";

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (text: string) => this.take(text));
    child.stderr.on("data", (text: string) => {
      this.stderr += text;
    });
  }

  /**
   * Starts the bundle for one person and completes the MCP handshake.
   *
   * @param bundle - The built bundle.
   * @param url - Base URL of the Pages listener.
   * @param token - The personal token of the person.
   * @returns A connected client.
   */
  public static async connect(
    bundle: BuiltBundle,
    url: string,
    token: string,
  ): Promise<BundleClient> {
    const child = spawn(process.execPath, [bundle.file], {
      cwd: bundle.directory,
      env: {
        PATH: process.env.PATH ?? "",
        PAGES_URL: url,
        PAGES_TOKEN: token,
        XDG_CONFIG_HOME: path.join(bundle.directory, "config"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const client = new BundleClient(child);
    await client.request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "page-16-e2e", version: "1" },
    });
    client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return client;
  }

  /** Sends a request and waits at most 15 seconds for its reply. */
  public async request(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<BundleReply> {
    this.nextId += 1;
    const id = this.nextId;
    const reply = new Promise<BundleReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(
          new Error(
            `No reply to ${method} within ${String(REPLY_TIMEOUT_MS)} ms. stderr: ${this.stderr}`,
          ),
        );
      }, REPLY_TIMEOUT_MS);
      this.waiting.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
    this.send({ jsonrpc: "2.0", id, method, params });
    return reply;
  }

  /** Calls a tool and returns its JSON result, failures included as `{code, ...}`. */
  public async call(
    name: string,
    parameters: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const reply = await this.request("tools/call", {
      name,
      arguments: parameters,
    });
    const content: unknown = reply.result?.content;
    if (!Array.isArray(content))
      throw new Error(
        `No content in the reply of ${name}: ${reply.error?.message ?? ""}`,
      );
    const first: unknown = content[0];
    if (
      typeof first !== "object" ||
      first === null ||
      !("text" in first) ||
      typeof first.text !== "string"
    )
      throw new Error(`No text in the reply of ${name}.`);
    const parsed: unknown = JSON.parse(first.text);
    if (!isRecord(parsed))
      throw new Error(`No object in the reply of ${name}.`);
    return parsed;
  }

  /** Closes stdin so the bundle ends, and stops it when it does not within five seconds. */
  public async close(): Promise<void> {
    const exited = new Promise<void>((resolve) => {
      if (this.child.exitCode !== null) resolve();
      this.child.once("exit", () => resolve());
    });
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill("SIGKILL"), EXIT_TIMEOUT_MS);
    await exited;
    clearTimeout(timer);
  }

  private send(message: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private take(text: string): void {
    this.buffered += text;
    for (
      let newline = this.buffered.indexOf("\n");
      newline >= 0;
      newline = this.buffered.indexOf("\n")
    ) {
      const line = this.buffered.slice(0, newline).trim();
      this.buffered = this.buffered.slice(newline + 1);
      if (line) this.deliver(line);
    }
  }

  private deliver(line: string): void {
    const message: unknown = JSON.parse(line);
    if (!isRecord(message) || typeof message.id !== "number") return;
    const { id, result, error } = message;
    const reply: BundleReply = {
      id,
      ...(isRecord(result) ? { result } : {}),
      ...(isRecord(error) &&
      typeof error.code === "number" &&
      typeof error.message === "string"
        ? { error: { code: error.code, message: error.message } }
        : {}),
    };
    this.waiting.get(id)?.(reply);
    this.waiting.delete(id);
  }
}
