import { createServer } from "node:http";

import type { Server, ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";

/** The synthetic credential; it opens nothing outside this fixture. */
export const FIXTURE_TOKEN = "pages-mcp-fixture-credential";

/** Text in a failure body that must never reach the MCP client or stderr. */
export const FIXTURE_SECRET = "fixture-internal-detail";

/** The endpoint the adapter must call. */
const AGENT_ENDPOINT = "/api/v1/agents";

/** Where the fixture redirects to, on its own address so that a follow is seen. */
const REDIRECT_TARGET = "/redirected";

/** One request as the fixture received it. */
export interface FixtureRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly contentType: string | undefined;
  readonly operation: string;
  readonly parameters: unknown;
}

/** What the fixture does with the next business request. */
export type FixtureOutcome =
  | "success"
  | "not_found"
  | "invalid_request"
  | "redirect"
  | "invalid_json"
  | "server_error"
  | "unauthorized"
  | "connection_lost";

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(typeof body === "string" ? body : JSON.stringify(body));
}

/**
 * A synthetic Pages Agent API on an ephemeral loopback port.
 *
 * @remarks
 * It answers with the documented envelopes and records every request, so the
 * check can compare what the real adapter sent. It holds no Pages code or data.
 */
export class PagesFixture {
  /** Every request in the order it arrived. */
  public readonly requests: FixtureRequest[] = [];

  /** Requests that followed a redirect, which the adapter must never do. */
  public redirectsFollowed = 0;

  /** The operations Pages offers this account right now. */
  public offeredOperations: readonly string[] = [
    "projects.names.list",
    "ticket.read",
    "fixture.unknown",
  ];

  /** The outcome of the next `verify`; a rejected credential at startup. */
  public verifyOutcome: "success" | "unauthorized" = "success";

  /** The outcome of the next business request. */
  public outcome: FixtureOutcome = "success";

  private readonly server: Server;
  private readonly sockets = new Set<Socket>();

  public constructor() {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        if (request.url === REDIRECT_TARGET) {
          this.redirectsFollowed += 1;
          send(response, 200, { apiVersion: "1", result: {} });
          return;
        }
        this.answer(
          {
            method: request.method ?? "",
            path: request.url ?? "",
            authorization: request.headers.authorization,
            contentType: request.headers["content-type"],
          },
          Buffer.concat(chunks).toString("utf8"),
          response,
        );
      });
    });
    this.server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.once("close", () => this.sockets.delete(socket));
    });
  }

  /** The address to pass as `PAGES_URL`, once listening. */
  public get url(): string {
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  /** Requests of one operation. */
  public requestsOf(operation: string): readonly FixtureRequest[] {
    return this.requests.filter((entry) => entry.operation === operation);
  }

  /** Starts listening on a free loopback port. */
  public async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", resolve);
    });
  }

  /** Stops the server and every open connection. */
  public async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private answer(
    head: Omit<FixtureRequest, "operation" | "parameters">,
    body: string,
    response: ServerResponse,
  ): void {
    const { operation, parameters } = JSON.parse(body) as {
      readonly operation: string;
      readonly parameters: unknown;
    };
    this.requests.push({ ...head, operation, parameters });
    if (
      head.method !== "POST" ||
      head.path !== AGENT_ENDPOINT ||
      head.authorization !== `Bearer ${FIXTURE_TOKEN}`
    ) {
      send(response, 401, { error: FIXTURE_SECRET });
      return;
    }
    if (operation === "verify") {
      this.answerVerify(response);
      return;
    }
    this.answerBusiness(operation, parameters, response);
  }

  private answerVerify(response: ServerResponse): void {
    if (this.verifyOutcome === "unauthorized") {
      send(response, 401, { error: FIXTURE_SECRET });
      return;
    }
    send(response, 200, {
      apiVersion: "1",
      identity: {
        userId: "fixture-user",
        isAdmin: false,
        permissions: ["fixture"],
      },
      tools: this.offeredOperations,
    });
  }

  private answerBusiness(
    operation: string,
    parameters: unknown,
    response: ServerResponse,
  ): void {
    const outcome = this.outcome;
    this.outcome = "success";
    switch (outcome) {
      case "connection_lost":
        response.socket?.destroy();
        return;
      case "invalid_json":
        send(response, 200, "not json");
        return;
      case "not_found":
        send(response, 404, {
          apiVersion: "1",
          error: { code: "NOT_FOUND", message: "No such ticket." },
        });
        return;
      case "redirect":
        response.writeHead(307, { Location: REDIRECT_TARGET });
        response.end();
        return;
      case "invalid_request":
        send(response, 400, {
          apiVersion: "1",
          error: { code: "INVALID_REQUEST" },
        });
        return;
      case "server_error":
        send(response, 500, { error: FIXTURE_SECRET });
        return;
      case "unauthorized":
        send(response, 401, { error: FIXTURE_SECRET });
        return;
      case "success":
        send(
          response,
          200,
          operation === "projects.names.list"
            ? { apiVersion: "1", projectNames: ["Fixture Ä", "Fixture B"] }
            : { apiVersion: "1", result: { echoed: parameters } },
        );
    }
  }
}
