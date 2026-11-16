import { expect, it } from "vitest";

import { readAgentWikiCreate } from "@/backend/service/agents/AgentWikiCreateValidation";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

const input = {
  operationId: "op",
  projectId: "project",
  parentId: null,
  title: "Title",
  content: "Content",
  icon: null,
  assetIds: ["asset"],
};

it("reads explicit wiki creation fields and supported scopes", () => {
  expect(readAgentWikiCreate(input)).toEqual(input);
  for (const scope of ["project", "instance", "private"])
    expect(readAgentWikiCreate({ ...input, scope })).toEqual({
      ...input,
      scope,
    });
  expect(
    readAgentWikiCreate({
      ...input,
      projectId: null,
      parentId: "parent",
      icon: "book",
    }),
  ).toMatchObject({ projectId: null, parentId: "parent", icon: "book" });
});

it.each([
  { ...input, unknown: true },
  { ...input, title: 1 },
  { ...input, content: null },
  { ...input, icon: false },
  { ...input, assetIds: null },
  { ...input, assetIds: ["same", "same"] },
  { ...input, assetIds: Array.from({ length: 101 }, () => "x") },
  { ...input, operationId: " " },
  { ...input, projectId: "x".repeat(201) },
  { ...input, parentId: 1 },
  { ...input, scope: "invalid" },
])("rejects malformed creation requests", (value) => {
  expect(() => readAgentWikiCreate(value)).toThrow();
});

it("limits content by UTF-8 bytes", () => {
  expect(() =>
    readAgentWikiCreate({
      ...input,
      content: "ä".repeat(
        Math.floor(PAGES_AGENT_LIMITS.wikiContentBytes / 2) + 1,
      ),
    }),
  ).toThrow();
});
