import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

import { vi } from "vitest";

/** What a static request left on the response. */
export interface StaticExchange {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  /** Header object of the single `writeHead(200, ...)` call, or `null`. */
  headers(): Readonly<Record<string, string | number>> | null;
  /** Status the response head was written with, or `null`. */
  status(): number | null;
  /** Text written to the response body so far. */
  body(): string;
  /** Resolves when the response was ended by the body stream or `end`. */
  readonly finished: Promise<void>;
  readonly destroyed: () => boolean;
  readonly endedWithoutBody: () => boolean;
}

/**
 * Builds a request and a response whose output stays in memory.
 *
 * @remarks
 * The node classes are real but never get a connected socket; the writing
 * methods are replaced, so nothing is sent anywhere.
 */
export function createStaticExchange(
  method: string,
  url: string | undefined,
): StaticExchange {
  const request = new IncomingMessage(new Socket());
  request.method = method;
  request.url = url;

  const response = new ServerResponse(request);
  const chunks: string[] = [];
  const heads: { status: number; headers: Record<string, string | number> }[] =
    [];
  let isDestroyed = false;
  let hasBody = false;
  const finished = new Promise<void>((resolve) => {
    vi.spyOn(response, "end").mockImplementation(() => {
      resolve();

      return response;
    });
  });

  vi.spyOn(response, "writeHead").mockImplementation(
    (status: number, headers?: unknown) => {
      heads.push({
        headers: toHeaderRecord(headers),
        status,
      });

      return response;
    },
  );
  vi.spyOn(response, "write").mockImplementation((chunk: Buffer | string) => {
    hasBody = true;
    chunks.push(chunk.toString());

    return true;
  });
  vi.spyOn(response, "destroy").mockImplementation(() => {
    isDestroyed = true;

    return response;
  });

  return {
    body: () => chunks.join(""),
    destroyed: () => isDestroyed,
    endedWithoutBody: () => !hasBody,
    finished,
    headers: () => heads[0]?.headers ?? null,
    request,
    response,
    status: () => heads[0]?.status ?? null,
  };
}

function toHeaderRecord(headers: unknown): Record<string, string | number> {
  const record: Record<string, string | number> = {};

  if (typeof headers !== "object" || headers === null) {
    return record;
  }

  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string" || typeof value === "number") {
      record[name] = value;
    }
  }

  return record;
}
