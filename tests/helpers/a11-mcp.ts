import { rmSync } from "node:fs";

import { afterEach } from "vitest";

import { createMcpServices } from "@/app/lib/mcp-services.server";
import { readAgentJson } from "@/app/lib/agent-json.server";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { readParameterRecord } from "@/backend/service/agents/AgentParameterReader";
import { CAPABILITY } from "@/definition/Authorization";

import { connectMcpServer } from "./mcp-server";
import { useMigratedDatabase } from "./test-database";
import { createWikiHarness } from "./wiki-harness";

import type { McpTestConnection } from "./mcp-server";

/** Complete in-process Pages/MCP stack, with real authorization and an isolated DuckDB. */
export function useA11McpHarness(): () => Promise<
  Awaited<ReturnType<typeof createHarness>> & {
    readonly connection: McpTestConnection;
  }
> {
  const getDatabase = useMigratedDatabase();
  const directories: string[] = [];
  const connections: McpTestConnection[] = [];
  afterEach(async () => {
    for (const connection of connections) await connection.server.close();
    connections.length = 0;
    for (const directory of directories)
      rmSync(directory, { recursive: true, force: true });
    directories.length = 0;
  });
  return async () => {
    const harness = await createHarness(getDatabase());
    directories.push(harness.filesDirectory);
    const connection = await connectMcpServer(() => harness.configuration);
    connections.push(connection);
    return { ...harness, connection };
  };
}

async function createHarness(
  database: ReturnType<ReturnType<typeof useMigratedDatabase>>,
) {
  const wiki = createWikiHarness(database);
  const owner = await wiki.addUser("owner", { isAdmin: true, mode: "admin" });
  await wiki.addDepartment("alpha");
  await wiki.addDepartment("beta");
  const writer = await wiki.addUser("writer", {
    departments: ["alpha"],
    capabilities: [CAPABILITY.WRITE],
    displayName: "Visible writer",
  });
  const manager = await wiki.addUser("manager", {
    departments: ["alpha"],
    capabilities: [CAPABILITY.WRITE, CAPABILITY.MANAGE_PROJECTS],
  });
  const reader = await wiki.addUser("reader", {
    departments: ["alpha"],
    capabilities: [],
  });
  const hidden = await wiki.addUser("hidden", {
    departments: ["beta"],
    displayName: "Hidden name",
  });
  await wiki.addProject("p1", ["alpha"]);
  await wiki.addProject("p2", ["beta"]);
  const authorization = new AuthorizationRepository(database);
  const managerAccess = (await authorization.snapshot()).accounts.find(
    ({ userId }) => userId === manager.id,
  );
  if (!managerAccess) throw new Error("Missing manager access.");
  await authorization.saveAccount({
    ...managerAccess,
    managedDepartments: ["alpha"],
  });
  await authorization.groups().save({
    id: "visible-group",
    name: "Visible group",
    memberIds: [writer.id],
  });
  await authorization
    .groups()
    .save({ id: "hidden-group", name: "Hidden group", memberIds: [hidden.id] });
  const users = {
    getById: (id: string) => new UserRepository(database).findById(id),
  };
  const administration = {
    getContext: async (id: string) => {
      const account = (await authorization.snapshot()).accounts.find(
        ({ userId }) => userId === id,
      );
      if (!account) throw new Error("Missing fixture account.");
      return account;
    },
  };
  const services = createMcpServices(database, users, administration, {
    directory: wiki.filesDirectory,
    wikiService: wiki.service,
    tickets: { cache: new ServerCache(), publisher: null },
  });
  const tokens = new Map<string, string>();
  for (const user of [owner, writer, reader, manager, hidden])
    tokens.set(
      user.id,
      (
        await services.personalAgentTokenService.create(
          user.id,
          "A11 fixture",
          null,
        )
      ).token,
    );
  const configuration = {
    agentsUrl: new URL("https://pages.invalid/api/v1/agents"),
    token: tokens.get(owner.id) ?? "",
  };
  return {
    ...wiki,
    owner,
    writer,
    reader,
    manager,
    hidden,
    services,
    tokens,
    configuration,
  };
}

/** Routes the MCP adapter's real HTTP requests directly to the isolated Pages API service. */
export function a11Fetch(
  harness: Awaited<ReturnType<typeof createHarness>>,
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    try {
      const token = request.headers.get("authorization")?.slice(7) ?? "";
      await harness.services.pagesAgentApiService.verify(token);
      return Response.json(
        await harness.services.pagesAgentApiService.handle(
          token,
          await readAgentJson(request),
        ),
      );
    } catch (error: unknown) {
      if (error instanceof AgentOperationError)
        return Response.json(
          {
            apiVersion: "1",
            error: { code: error.code, details: error.details },
          },
          { status: error.status },
        );
      throw error;
    }
  };
}

/** Extracts the explicit JSON result from an MCP tools/call response. */
export function a11ToolResult(
  message: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const envelope = readParameterRecord(message);
  const result = readParameterRecord(envelope.result);
  if (!Array.isArray(result.content)) throw new Error("Missing MCP content.");
  const content = readParameterRecord(result.content[0]);
  if (typeof content.text !== "string") throw new Error("Missing MCP text.");
  const parsed: unknown = JSON.parse(content.text);
  return readParameterRecord(parsed);
}

/** Calls a tool through the real MCP transport and extracts its JSON result. */
export async function callA11Tool(
  connection: McpTestConnection,
  name: string,
  parameters: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return a11ToolResult(
    await connection.request("tools/call", { name, arguments: parameters }),
  );
}
