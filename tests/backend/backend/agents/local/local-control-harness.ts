import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";

import { vi } from "vitest";

import { MANIFEST } from "./local-sessions-fixture";
import { stub } from "./local-owner-session-fixture";

import type {
  IncomingMessage,
  RequestOptions,
  ServerResponse,
} from "node:http";
import type { LocalOwnerSession } from "@/backend/agents/local/LocalOwnerSession";
import type { LocalSessionCommand } from "@/backend/agents/local/LocalSessionContracts";

type RequestListener = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

interface MemoryResponse {
  headersSent: boolean;
  headers: unknown;
  writeHead: (status: number, headers?: unknown) => MemoryResponse;
  end: (answer?: string) => void;
}

/** In-memory HTTP boundary: neither listener nor client opens a socket. */
export const httpBoundary = {
  listener: null as RequestListener | null,
  reply: null as { status: number; body: string } | null,
  responses: [] as { status: number; body: string; headers: unknown }[],
  logEvent: vi.fn(),
};

/** Captures the native HTTP callback without binding a server. */
export function createServer(listener: RequestListener): object {
  httpBoundary.listener = listener;
  return { listening: false };
}

/** Replaces the request transport with streams that call the captured handler. */
export function request(
  options: RequestOptions,
  receive: (response: IncomingMessage) => void,
): object {
  const outgoing = new EventEmitter();
  return Object.assign(outgoing, {
    setTimeout: vi.fn(),
    destroy: (error: Error): void => {
      outgoing.emit("error", error);
    },
    end: (body: string): void => {
      const incoming = Object.assign(new PassThrough(), { statusCode: 0 });
      const response: MemoryResponse = {
        headersSent: false,
        headers: undefined,
        writeHead(status: number, headers?: unknown): MemoryResponse {
          incoming.statusCode = status;
          response.headers = headers;
          response.headersSent = true;
          return response;
        },
        end(answer = ""): void {
          httpBoundary.responses.push({
            status: incoming.statusCode,
            body: answer,
            headers: response.headers,
          });
          receive(stub<IncomingMessage>(incoming));
          incoming.end(answer);
        },
      };
      if (httpBoundary.reply) {
        response
          .writeHead(httpBoundary.reply.status)
          .end(httpBoundary.reply.body);
        return;
      }
      const incomingRequest = Object.assign(Readable.from([body]), {
        method: options.method,
        url: options.path,
        headers: options.headers,
      });
      if (!httpBoundary.listener)
        throw new Error("Missing owner HTTP callback");
      httpBoundary.listener(
        stub<IncomingMessage>(incomingRequest),
        stub<ServerResponse>(response),
      );
    },
  });
}

/** Installs one authenticated owner and attaches a client to it. */
export async function controlOwner(
  owner: Pick<LocalOwnerSession, "close">,
): Promise<(command: LocalSessionCommand) => Promise<unknown>> {
  const { LocalOwnerHttp } =
    await import("@/backend/agents/local/LocalOwnerHttp");
  const { sendLocalCommand } =
    await import("@/backend/agents/local/LocalSessionTransport");
  httpBoundary.responses.length = 0;
  httpBoundary.reply = null;
  httpBoundary.logEvent.mockReset();
  new LocalOwnerHttp(MANIFEST, stub(owner), stub({}), async () => {});
  const control = (command: LocalSessionCommand): Promise<unknown> =>
    sendLocalCommand(MANIFEST, command, "77777777-7777-4777-8777-777777777777");
  await control({
    kind: "attach",
    token: "77777777-7777-4777-8777-777777777777",
  });
  return control;
}
