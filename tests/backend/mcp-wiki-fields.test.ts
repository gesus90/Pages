import { expect, it, vi } from "vitest";

vi.mock("../../mcp/src/verification", () => ({ verifyPages: vi.fn() }));
vi.mock("../../mcp/src/tools/read-operation", () => ({
  readOperation: vi.fn(),
}));

import { PagesOperationFailure } from "../../mcp/src/tools/operation-failure";
import { readOperation } from "../../mcp/src/tools/read-operation";
import { verifyPages } from "../../mcp/src/verification";
import { connectMcpServer } from "../helpers/mcp-server";

const identity = { userId: "writer", isAdmin: false, permissions: ["write"] };
const configuration = {
  agentsUrl: new URL("https://pages.invalid/api/v1/agents"),
  token: "isolated-test-token",
};
const operations = [
  "wiki.page.setTitle",
  "wiki.page.setContent",
  "wiki.page.setIcon",
  "wiki.page.move",
] as const;

it("offers exact field schemas, required arguments and destructive/idempotent annotations", async () => {
  vi.mocked(verifyPages).mockResolvedValue({ identity, tools: operations });
  const { server, request } = await connectMcpServer(() => configuration);
  try {
    const identifier = { type: "string", minLength: 1, maxLength: 200 };
    const common = {
      operationId: identifier,
      pageId: identifier,
      expectedRevision: { type: "integer", minimum: 1 },
    };
    const specifications = [
      {
        name: "set_wiki_page_title",
        fields: { title: { type: "string", minLength: 1, maxLength: 200 } },
      },
      {
        name: "set_wiki_page_content",
        fields: { content: { type: "string" } },
      },
      {
        name: "set_wiki_page_icon",
        fields: { icon: { type: ["string", "null"] } },
      },
      {
        name: "move_wiki_page",
        fields: {
          projectId: { type: ["string", "null"], maxLength: 200 },
          parentId: {
            type: ["string", "null"],
            minLength: 1,
            maxLength: 200,
          },
          beforeId: {
            type: ["string", "null"],
            minLength: 1,
            maxLength: 200,
          },
        },
      },
    ];
    expect(await request("tools/list")).toMatchObject({
      result: {
        tools: specifications.map(({ name, fields }) => ({
          name,
          annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: false,
          },
          inputSchema: {
            type: "object",
            additionalProperties: false,
            properties: { ...common, ...fields },
            required: [...Object.keys(common), ...Object.keys(fields)],
          },
        })),
      },
    });
  } finally {
    await server.close();
  }
});

it.each([
  ["set_wiki_page_title", "wiki.page.setTitle", { title: "Title" }],
  [
    "set_wiki_page_content",
    "wiki.page.setContent",
    { content: "\uFEFF# Body\r\n" },
  ],
  ["set_wiki_page_icon", "wiki.page.setIcon", { icon: null }],
  [
    "move_wiki_page",
    "wiki.page.move",
    { projectId: "alpha", parentId: "/wiki/parent", beforeId: null },
  ],
])(
  "forwards %s unchanged, preserves safe conflicts and blocks revoked replay",
  async (name, operation, fields) => {
    vi.mocked(verifyPages).mockResolvedValue({ identity, tools: operations });
    const { server, request } = await connectMcpServer(() => configuration);
    try {
      const parameters = {
        operationId: "change",
        pageId: "https://pages.invalid/wiki/page",
        expectedRevision: 3,
        ...fields,
      };
      const result = {
        pageId: "page",
        link: "/wiki/page",
        changed: true,
        revision: 4,
      };
      vi.mocked(readOperation).mockResolvedValue(result);
      for (let attempt = 0; attempt < 2; attempt++)
        expect(
          await request("tools/call", { name, arguments: parameters }),
        ).toMatchObject({
          result: { content: [{ text: JSON.stringify(result) }] },
        });
      expect(readOperation).toHaveBeenLastCalledWith(
        configuration,
        operation,
        parameters,
      );
      vi.mocked(readOperation).mockRejectedValueOnce(
        new PagesOperationFailure("CONFLICT"),
      );
      expect(
        await request("tools/call", { name, arguments: parameters }),
      ).toMatchObject({
        result: { isError: true, content: [{ text: '{"code":"CONFLICT"}' }] },
      });
      vi.mocked(verifyPages).mockResolvedValue({
        identity: { ...identity, permissions: [] },
        tools: [],
      });
      expect(await request("tools/list")).toMatchObject({
        result: { tools: [] },
      });
      expect(
        await request("tools/call", { name, arguments: parameters }),
      ).toMatchObject({ error: { message: "Pages authorization failed." } });
      expect(readOperation).toHaveBeenCalledTimes(3);
    } finally {
      await server.close();
    }
  },
);
