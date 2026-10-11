import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../mcp/src/verification", () => ({ verifyPages: vi.fn() }));
vi.mock("../../mcp/src/tools/read-operation", () => ({
  readOperation: vi.fn(),
}));

import { postAgentRequest } from "../../mcp/src/pages-client";
import {
  operationFailure,
  PagesOperationFailure,
} from "../../mcp/src/tools/operation-failure";
import { readOperation } from "../../mcp/src/tools/read-operation";
import { verifyPages } from "../../mcp/src/verification";
import { connectMcpServer } from "../helpers/mcp-server";

const identity = { userId: "test", isAdmin: false, permissions: ["write"] };
const configuration = {
  agentsUrl: new URL("https://pages.invalid/api/v1/agents"),
  token: "isolated-test-token",
};
const manifest = {
  version: "1",
  sources: [
    { kind: "project", key: "project", projectId: "p1" },
    { kind: "ticket", key: "ticket", type: "task", title: "Ticket" },
  ],
};
const servers: Awaited<ReturnType<typeof connectMcpServer>>["server"][] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

describe("MCP structured import contract", () => {
  it("lists bounded shared schemas with read, write and idempotency annotations", async () => {
    vi.mocked(verifyPages).mockResolvedValue({
      identity,
      tools: ["import.structured.plan", "import.structured.apply"],
    });
    const connection = await connectMcpServer(() => configuration);
    servers.push(connection.server);
    const response = await connection.request("tools/list");
    expect(response).toMatchObject({
      result: {
        tools: [
          {
            name: "plan_structured_import",
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
            inputSchema: {
              additionalProperties: false,
              required: ["manifest"],
              properties: {
                manifest: {
                  properties: {
                    sources: { maxItems: 100 },
                    links: { maxItems: 200 },
                    assets: { maxItems: 32 },
                  },
                },
              },
            },
          },
          {
            name: "apply_structured_import",
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
            inputSchema: {
              required: ["operationId", "fingerprint", "manifest"],
            },
          },
        ],
      },
    });
  });

  it("forwards exact manifests and confirmations and rechecks authorization after response loss", async () => {
    vi.mocked(verifyPages).mockResolvedValue({
      identity,
      tools: ["import.structured.plan", "import.structured.apply"],
    });
    const connection = await connectMcpServer(() => configuration);
    servers.push(connection.server);
    for (const [name, operation, parameters] of [
      ["plan_structured_import", "import.structured.plan", { manifest }],
      [
        "apply_structured_import",
        "import.structured.apply",
        { manifest, operationId: "apply", fingerprint: "a".repeat(64) },
      ],
    ] as const) {
      const result = { marker: operation, items: [] };
      vi.mocked(readOperation).mockResolvedValue(result);
      expect(
        await connection.request("tools/call", { name, arguments: parameters }),
      ).toMatchObject({
        result: { content: [{ text: JSON.stringify(result) }] },
      });
      expect(readOperation).toHaveBeenLastCalledWith(
        configuration,
        operation,
        parameters,
      );
    }
    vi.mocked(readOperation).mockRejectedValueOnce(
      new PagesOperationFailure("CONFLICT"),
    );
    expect(
      await connection.request("tools/call", {
        name: "apply_structured_import",
        arguments: {
          manifest,
          operationId: "apply",
          fingerprint: "a".repeat(64),
        },
      }),
    ).toMatchObject({
      result: { isError: true, content: [{ text: '{"code":"CONFLICT"}' }] },
    });
    vi.mocked(verifyPages).mockResolvedValue({ identity, tools: [] });
    expect(
      await connection.request("tools/call", {
        name: "apply_structured_import",
        arguments: {},
      }),
    ).toMatchObject({ error: { message: "Pages authorization failed." } });
    expect(readOperation).toHaveBeenCalledTimes(3);
  });

  it("uses the apply timeout while keeping previews bounded to five seconds", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetch = vi
      .fn()
      .mockImplementation(
        async () => new Response('{"apiVersion":"1","result":{}}'),
      );
    vi.stubGlobal("fetch", fetch);
    await postAgentRequest(configuration, {
      operation: "import.structured.apply",
      parameters: {},
    });
    expect(timeout).toHaveBeenLastCalledWith(30000);
    await postAgentRequest(configuration, {
      operation: "import.structured.plan",
      parameters: {},
    });
    expect(timeout).toHaveBeenLastCalledWith(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["importSources", "importLinks", "importAssets"])(
    "preserves the public constraint %s without provider diagnostics",
    async (constraint) => {
      const failure = await operationFailure(
        new Response(
          JSON.stringify({
            apiVersion: "1",
            error: {
              code: "PAYLOAD_TOO_LARGE",
              details: { constraint, limit: 32, diagnostic: "private" },
            },
          }),
          { status: 413 },
        ),
      );
      expect(failure).toMatchObject({
        code: "PAYLOAD_TOO_LARGE",
        details: { constraint, limit: 32 },
      });
      expect(failure?.details).not.toHaveProperty("diagnostic");
    },
  );
});

it("documents the structured operations, tools and per-source recovery contract", async () => {
  const readme = await readFile(
    new URL("../../mcp/README.md", import.meta.url),
    "utf8",
  );
  for (const name of [
    "import.structured.plan",
    "import.structured.apply",
    "plan_structured_import",
    "apply_structured_import",
    "target_removed",
    "operationId",
  ])
    expect(readme).toContain(name);
});
