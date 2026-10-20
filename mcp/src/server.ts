import { createOperationsServer } from "./operations-server.js";
import { listProjectNames } from "./project-names.js";
import { readOperation } from "./tools/read-operation.js";
import { verifyPages } from "./verification.js";

import type { McpServer } from "@modelcontextprotocol/server";
import type { PagesConfiguration } from "./configuration.js";

/** Creates a client-started stdio server with per-request credential resolution. */
export function createServer(resolve: () => PagesConfiguration): McpServer {
  return createOperationsServer({
    verify: () => verifyPages(resolve()),
    names: () => listProjectNames(resolve()),
    read: (operation, parameters) =>
      readOperation(resolve(), operation, parameters),
  });
}
