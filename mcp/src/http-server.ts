import { createServer } from "node:http";

import { createProtectedResource } from "./http-resource.js";

import type { IncomingMessage, ServerResponse, Server } from "node:http";
import type { HttpConfiguration } from "./http-configuration.js";

async function respond(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  configuration: HttpConfiguration,
  resource: ReturnType<typeof createProtectedResource>,
): Promise<void> {
  try {
    if (incoming.headers.host !== configuration.resource.host) {
      outgoing.writeHead(403).end();
      return;
    }
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of incoming) {
      const bytes = Buffer.from(chunk);
      length += bytes.length;
      if (length > 65_536) {
        outgoing.writeHead(413).end();
        return;
      }
      chunks.push(bytes);
    }
    const headers = new Headers();
    for (const [name, content] of Object.entries(incoming.headers)) {
      if (typeof content === "string") headers.set(name, content);
    }
    const request = new Request(
      `${configuration.resource.origin}${incoming.url}`,
      {
        method: incoming.method,
        headers,
        ...(length > 0 ? { body: Buffer.concat(chunks) } : {}),
      },
    );
    const response = await resource.fetch(request);
    const responseHeaders = Object.fromEntries(response.headers);
    // Node must honor a client's Connection: close, even when the SDK serves legacy SSE.
    delete responseHeaders.connection;
    outgoing.writeHead(response.status, responseHeaders);
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(503).end();
  }
}

/**
 * Opens only a loopback listener; remote HTTP requires a trusted HTTPS reverse proxy.
 *
 * @param configuration - Validated options; `host` is always a loopback address.
 * @returns The listening server, closed by the caller on shutdown.
 */
export async function startHttpServer(
  configuration: HttpConfiguration,
): Promise<Server> {
  const resource = createProtectedResource(configuration);
  const server = createServer((incoming, outgoing) => {
    void respond(incoming, outgoing, configuration, resource);
  });
  server.on("close", () => {
    void resource
      .close()
      .catch(() => console.error("[pages-mcp] HTTP shutdown failed."));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(configuration.port, configuration.host, resolve);
  });
  server.on("error", () => console.error("[pages-mcp] HTTP server failed."));
  return server;
}
