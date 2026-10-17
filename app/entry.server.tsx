import { PassThrough } from "node:stream";

import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";

import { logEvent } from "@/backend/logging/Logger";

import type { EntryContext } from "react-router";
import type { RenderToPipeableStreamOptions } from "react-dom/server";

/** Matches React Router's default streaming timeout. */
export const streamTimeout = 5_000;

/** Records server errors centrally; internal stacks never become client error messages. */
export function handleError(error: unknown): void {
  logEvent({
    level: "error",
    event: "http.application.failed",
    component: "ServerRendering",
    message: "Application request failed",
    error,
  });
}

/** Renders the standard streaming response with centrally logged SSR failures. */
export default function handleRequest(
  request: Request,
  statusCode: number,
  headers: Headers,
  routerContext: EntryContext,
): Promise<Response> | Response {
  if (request.method === "HEAD")
    return new Response(null, { status: statusCode, headers });
  return new Promise((resolve, reject) => {
    let hasRenderedShell = false;
    const userAgent = request.headers.get("user-agent");
    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode
        ? "onAllReady"
        : "onShellReady";
    const timeout = setTimeout(() => abort(), streamTimeout + 1_000);
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        [readyOption](): void {
          hasRenderedShell = true;
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeout);
              callback();
            },
          });
          headers.set("Content-Type", "text/html");
          pipe(body);
          resolve(
            new Response(createReadableStreamFromReadable(body), {
              headers,
              status: statusCode,
            }),
          );
        },
        onShellError(error: unknown): void {
          clearTimeout(timeout);
          reject(error);
        },
        onError(error: unknown): void {
          statusCode = 500;
          if (hasRenderedShell) handleError(error);
        },
      },
    );
  });
}
