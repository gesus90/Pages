import { createInterface } from "node:readline";

import { StdioCheckError, withDeadline } from "./server.ts";

import type { Interface } from "node:readline";
import type { RunningServer } from "./server.ts";

const REQUEST_TIMEOUT_MS = 15_000;

/** The MCP revision the checks announce. */
export const PROTOCOL_VERSION = "2025-11-25";

/** Narrows an untyped protocol value. */
export function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function readMessage(line: string): Record<string, unknown> {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    throw new StdioCheckError("Server stdout contains non-protocol output.");
  }
  if (!isRecord(message) || message.jsonrpc !== "2.0") {
    throw new StdioCheckError(
      "Server stdout contains an invalid MCP envelope.",
    );
  }
  return message;
}

function requireNotification(message: Record<string, unknown>): void {
  if (
    typeof message.method !== "string" ||
    "id" in message ||
    "result" in message ||
    "error" in message ||
    ("params" in message && !isRecord(message.params))
  ) {
    throw new StdioCheckError("Server sent an unexpected MCP message.");
  }
}

/** One JSON-RPC response as the server sent it. */
export interface StdioResponse {
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

/** Sequential stdio peer for one acceptance flow; results never enter diagnostics. */
export class StdioClient {
  private readonly server: RunningServer;
  private readonly reader: Interface;
  private readonly lines: AsyncIterableIterator<string>;
  private requestId = 0;
  private hasCompleteFrame = true;
  private streamFailure: StdioCheckError | null = null;

  public constructor(server: RunningServer) {
    this.server = server;
    this.reader = createInterface({
      input: server.child.stdout,
      crlfDelay: Infinity,
    });
    this.lines = this.reader[Symbol.asyncIterator]();
    server.child.stdout.on("data", (chunk: Buffer) => {
      this.hasCompleteFrame = chunk[chunk.length - 1] === 10;
    });
    const failStream = (): void => {
      this.streamFailure = new StdioCheckError(
        "The stdio pipe failed. Check that isolated Pages is reachable and the credential is valid.",
      );
    };
    server.child.stdin.on("error", failStream);
    server.child.stdout.on("error", failStream);
  }

  /** Sends one request, accepts valid notifications and validates its matching response. */
  public async request(
    method: string,
    parameters: Record<string, unknown>,
  ): Promise<unknown> {
    const id = ++this.requestId;
    await this.send({ jsonrpc: "2.0", id, method, params: parameters });
    return withDeadline(
      this.readResponse(id),
      REQUEST_TIMEOUT_MS,
      "Timed out waiting for an MCP response from the real bundle.",
    );
  }

  /** Sends one request and returns the response, also an MCP error, for the caller to judge. */
  public async exchange(
    method: string,
    parameters: Record<string, unknown>,
  ): Promise<StdioResponse> {
    const id = ++this.requestId;
    await this.send({ jsonrpc: "2.0", id, method, params: parameters });
    return withDeadline(
      this.readEnvelope(id),
      REQUEST_TIMEOUT_MS,
      "Timed out waiting for an MCP response from the real bundle.",
    );
  }

  /** Announces initialization without expecting a JSON-RPC response. */
  public async initialized(): Promise<void> {
    await this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  /** Ends stdin, checks all remaining stdout frames and requires a clean server exit. */
  public async finish(): Promise<void> {
    this.server.child.stdin.end();
    const exit = await withDeadline(
      this.server.closed,
      5000,
      "Server did not exit after stdin closed.",
    );
    for await (const line of this.lines) requireNotification(readMessage(line));
    if (!this.hasCompleteFrame || this.streamFailure) {
      throw (
        this.streamFailure ??
        new StdioCheckError("Server stdout ended with an incomplete MCP frame.")
      );
    }
    if (exit.hasStartFailed || exit.code !== 0 || exit.signal !== null) {
      throw new StdioCheckError(
        "The real MCP bundle did not exit successfully.",
      );
    }
  }

  /** Releases the local line reader when either acceptance or cleanup finishes. */
  public dispose(): void {
    this.reader.close();
  }

  private async send(message: Record<string, unknown>): Promise<void> {
    if (this.streamFailure) throw this.streamFailure;
    await new Promise<void>((resolve, reject) => {
      this.server.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error)
          reject(
            new StdioCheckError(
              "Could not send an MCP message to the real bundle.",
            ),
          );
        else resolve();
      });
    });
  }

  private async readResponse(id: number): Promise<unknown> {
    const response = await this.readEnvelope(id);
    if (!("result" in response) || "error" in response) {
      throw new StdioCheckError(
        "The real bundle returned an MCP error or an invalid response.",
      );
    }
    return response.result;
  }

  private async readEnvelope(id: number): Promise<StdioResponse> {
    while (true) {
      const next = await this.lines.next();
      if (next.done) break;
      if (this.streamFailure) throw this.streamFailure;
      const message = readMessage(next.value);
      if ("method" in message) {
        requireNotification(message);
        continue;
      }
      if (message.id !== id) {
        throw new StdioCheckError(
          "The real bundle answered with another request ID.",
        );
      }
      return message;
    }
    throw new StdioCheckError(
      "The MCP bundle closed before answering. Check isolated Pages reachability and credential validity.",
    );
  }
}
