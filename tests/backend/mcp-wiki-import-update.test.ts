import { describe, expect, it, vi } from "vitest";

vi.mock("../../mcp/src/verification", () => ({ verifyPages: vi.fn() }));
vi.mock("../../mcp/src/tools/read-operation", () => ({
  readOperation: vi.fn(),
}));

import { readOperation } from "../../mcp/src/tools/read-operation";
import { PagesOperationFailure } from "../../mcp/src/tools/operation-failure";
import { verifyPages } from "../../mcp/src/verification";
import { connectMcpServer } from "../helpers/mcp-server";

const identity = { userId: "test", isAdmin: false, permissions: [] };
const configuration = {
  agentsUrl: new URL("https://pages.invalid/api/v1/agents"),
  token: "isolated-test-token",
};

describe("MCP A9.9 import update contract", () => {
  it("exposes bounded revision entries with explicit overwrite and destructive/idempotent annotations", async () => {
    vi.mocked(verifyPages).mockResolvedValue({
      identity,
      tools: ["wiki.import.update"],
    });
    const { server, request } = await connectMcpServer(() => configuration);
    expect(await request("tools/list")).toMatchObject({
      result: {
        tools: [
          {
            name: "update_wiki_import",
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: true,
              openWorldHint: false,
            },
            inputSchema: {
              additionalProperties: false,
              required: [
                "operationId",
                "fingerprint",
                "projectId",
                "parentId",
                "manifest",
                "updates",
              ],
              properties: {
                updates: {
                  type: "array",
                  minItems: 1,
                  maxItems: 32,
                  items: {
                    additionalProperties: false,
                    required: ["sourceKey", "expectedRevision"],
                    properties: {
                      sourceKey: { type: "string", minLength: 1 },
                      expectedRevision: { type: "integer", minimum: 1 },
                      overwrite: { type: "boolean", default: false },
                    },
                  },
                },
                manifest: {
                  properties: {
                    index: { maxItems: 128 },
                    files: { maxItems: 32 },
                  },
                },
              },
            },
          },
        ],
      },
    });
    await server.close();
  });

  it("forwards update entries unchanged, returns per-source conflicts and blocks revoked retries", async () => {
    vi.mocked(verifyPages).mockResolvedValue({
      identity,
      tools: ["wiki.import.update"],
    });
    const { server, request } = await connectMcpServer(() => configuration);
    const parameters = {
      operationId: "update",
      fingerprint: "a".repeat(64),
      projectId: "alpha",
      parentId: null,
      manifest: { version: "1", index: [], files: [] },
      updates: [{ sourceKey: "a.md", expectedRevision: 2, overwrite: true }],
    };
    const result = {
      status: "partial",
      counts: { updated: 0, skipped: 0, conflict: 1, failed: 0 },
      items: [
        {
          sourceKey: "a.md",
          action: "conflict",
          reason: "stale_revision",
          errorCode: "CONFLICT",
          revision: 3,
        },
      ],
    };
    vi.mocked(readOperation).mockResolvedValue(result);
    for (let attempt = 0; attempt < 2; attempt++)
      expect(
        await request("tools/call", {
          name: "update_wiki_import",
          arguments: parameters,
        }),
      ).toMatchObject({
        result: { content: [{ text: JSON.stringify(result) }] },
      });
    expect(readOperation).toHaveBeenCalledTimes(2);
    expect(readOperation).toHaveBeenLastCalledWith(
      configuration,
      "wiki.import.update",
      parameters,
    );
    vi.mocked(readOperation).mockRejectedValueOnce(
      new PagesOperationFailure("CONFLICT"),
    );
    expect(
      await request("tools/call", {
        name: "update_wiki_import",
        arguments: parameters,
      }),
    ).toMatchObject({
      result: { isError: true, content: [{ text: '{"code":"CONFLICT"}' }] },
    });
    vi.mocked(verifyPages).mockResolvedValue({ identity, tools: [] });
    expect(await request("tools/list")).toMatchObject({
      result: { tools: [] },
    });
    expect(
      await request("tools/call", {
        name: "update_wiki_import",
        arguments: parameters,
      }),
    ).toMatchObject({ error: { message: "Pages authorization failed." } });
    expect(readOperation).toHaveBeenCalledTimes(3);
    await server.close();
  });
});
