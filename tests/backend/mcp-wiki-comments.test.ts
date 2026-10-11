import { readFileSync } from "node:fs";

import { expect, it, vi } from "vitest";

import { PAGES_AGENT_COMMENT_OPERATIONS } from "@/definition/PagesAgentOperations";

vi.mock("../../mcp/src/verification", () => ({ verifyPages: vi.fn() }));
vi.mock("../../mcp/src/tools/read-operation", () => ({
  readOperation: vi.fn(),
}));

import { readOperation } from "../../mcp/src/tools/read-operation";
import { PagesOperationFailure } from "../../mcp/src/tools/operation-failure";
import { COMMENT_TOOLS } from "../../mcp/src/tools/wiki-comments";
import { verifyPages } from "../../mcp/src/verification";
import { connectMcpServer } from "../helpers/mcp-server";

const identity = { userId: "reader", isAdmin: false, permissions: [] };
const configuration = {
  agentsUrl: new URL("https://pages.invalid/api/v1/agents"),
  token: "isolated-test-token",
};

it("offers all five exact schemas to an account without write rights", async () => {
  vi.mocked(verifyPages).mockResolvedValue({
    identity,
    tools: PAGES_AGENT_COMMENT_OPERATIONS,
  });
  const connection = await connectMcpServer(() => configuration);
  try {
    const identifier = { type: "string", minLength: 1, maxLength: 200 };
    const body = { type: "string", minLength: 1, maxLength: 5000 };
    const specifications = [
      {
        name: "read_wiki_comments",
        properties: { pageId: identifier },
        required: ["pageId"],
        readOnlyHint: true,
        destructiveHint: false,
      },
      {
        name: "add_wiki_comment",
        properties: {
          operationId: identifier,
          pageId: identifier,
          body,
          parentId: { type: ["string", "null"], maxLength: 200 },
          quote: { type: ["string", "null"], maxLength: 500 },
        },
        required: ["operationId", "pageId", "body"],
        readOnlyHint: false,
        destructiveHint: false,
      },
      {
        name: "edit_wiki_comment",
        properties: { operationId: identifier, commentId: identifier, body },
        required: ["operationId", "commentId", "body"],
        readOnlyHint: false,
        destructiveHint: true,
      },
      {
        name: "resolve_wiki_comment",
        properties: {
          operationId: identifier,
          commentId: identifier,
          resolved: { type: "boolean" },
        },
        required: ["operationId", "commentId", "resolved"],
        readOnlyHint: false,
        destructiveHint: false,
      },
      {
        name: "delete_wiki_comment",
        properties: { operationId: identifier, commentId: identifier },
        required: ["operationId", "commentId"],
        readOnlyHint: false,
        destructiveHint: true,
      },
    ];
    expect(await connection.request("tools/list")).toMatchObject({
      result: {
        tools: specifications.map(
          ({ name, properties, required, readOnlyHint, destructiveHint }) => ({
            name,
            inputSchema: {
              type: "object",
              properties,
              required,
              additionalProperties: false,
            },
            annotations: {
              readOnlyHint,
              destructiveHint,
              idempotentHint: true,
              openWorldHint: false,
            },
          }),
        ),
      },
    });
  } finally {
    await connection.server.close();
  }
});

it.each([
  ["read_wiki_comments", "wiki.comments.read", { pageId: "/wiki/page" }],
  [
    "add_wiki_comment",
    "wiki.comment.add",
    { operationId: "add", pageId: "page", body: " Text @reader " },
  ],
  [
    "add_wiki_comment",
    "wiki.comment.add",
    {
      operationId: "reply",
      pageId: "page",
      body: "Answer",
      parentId: "root",
      quote: "Passage",
    },
  ],
  [
    "edit_wiki_comment",
    "wiki.comment.edit",
    { operationId: "edit", commentId: "comment", body: "Edited" },
  ],
  [
    "resolve_wiki_comment",
    "wiki.comment.resolve",
    { operationId: "resolve", commentId: "comment", resolved: true },
  ],
  [
    "resolve_wiki_comment",
    "wiki.comment.resolve",
    { operationId: "open", commentId: "comment", resolved: false },
  ],
  [
    "delete_wiki_comment",
    "wiki.comment.delete",
    { operationId: "delete", commentId: "comment" },
  ],
] as const)(
  "forwards %s unchanged and rechecks current authorization",
  async (name, operation, parameters) => {
    vi.mocked(verifyPages).mockResolvedValue({
      identity,
      tools: PAGES_AGENT_COMMENT_OPERATIONS,
    });
    const connection = await connectMcpServer(() => configuration);
    try {
      const result = { pageId: "page", commentId: "comment", changed: true };
      vi.mocked(readOperation).mockResolvedValue(result);
      for (let attempt = 0; attempt < 2; attempt++)
        expect(
          await connection.request("tools/call", {
            name,
            arguments: parameters,
          }),
        ).toMatchObject({
          result: { content: [{ text: JSON.stringify(result) }] },
        });
      expect(readOperation).toHaveBeenLastCalledWith(
        configuration,
        operation,
        parameters,
      );
      for (const code of [
        "FORBIDDEN",
        "INVALID_REQUEST",
        "CONFLICT",
        "NOT_FOUND",
      ] as const) {
        vi.mocked(readOperation).mockRejectedValueOnce(
          new PagesOperationFailure(code),
        );
        expect(
          await connection.request("tools/call", {
            name,
            arguments: parameters,
          }),
        ).toMatchObject({
          result: {
            isError: true,
            content: [
              {
                text: JSON.stringify({
                  code,
                  ...(code === "NOT_FOUND"
                    ? { message: "Not found or no access." }
                    : {}),
                }),
              },
            ],
          },
        });
      }
      vi.mocked(verifyPages).mockResolvedValue({ identity, tools: [] });
      expect(await connection.request("tools/list")).toMatchObject({
        result: { tools: [] },
      });
      expect(
        await connection.request("tools/call", { name, arguments: parameters }),
      ).toMatchObject({ error: { message: "Pages authorization failed." } });
      expect(readOperation).toHaveBeenCalledTimes(6);
    } finally {
      await connection.server.close();
    }
  },
);

it("documents the exact tools, rights, mentions, recovery and completed coverage", () => {
  const readme = readFileSync(
    new URL("../../mcp/README.md", import.meta.url),
    "utf8",
  );
  const section = readme
    .split("## Wiki comments (A9.13)")[1]
    ?.replace(/\s+/g, " ");
  expect(COMMENT_TOOLS.map((entry) => entry.operation)).toEqual(
    PAGES_AGENT_COMMENT_OPERATIONS,
  );
  for (const { operation, tool } of COMMENT_TOOLS) {
    expect(section).toContain(`\`${operation}\``);
    expect(section).toContain(`\`${tool.name}\``);
    for (const argument of tool.inputSchema.required ?? [])
      expect(section).toContain(`\`${argument}\``);
  }
  for (const contract of [
    "without the write right",
    "both return `NOT_FOUND`",
    "its author (`canEdit`)",
    "private page records no mentions",
    "Nothing is sent by mail or push",
    "`deletedComments` names the scope",
    "other input returns `CONFLICT`",
    "100% statements, branches, functions and lines per executable file",
    "contracts have no executable coverage counters",
  ])
    expect(section).toContain(contract);
  expect(section).not.toContain("remain open");
});
