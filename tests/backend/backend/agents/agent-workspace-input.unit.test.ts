import { expect, it } from "vitest";

import { readWorkspaceInput } from "@/backend/agents/AgentWorkspaceInput";

const VALID = { name: " Repo ", path: " /srv/repo ", projectId: " p-1 " };

it("trims valid registration metadata without a revision", () => {
  expect(readWorkspaceInput(VALID)).toEqual({
    name: "Repo",
    path: "/srv/repo",
    projectId: "p-1",
  });
});

it("keeps a positive integer revision", () => {
  expect(readWorkspaceInput({ ...VALID, revision: 3 })).toEqual({
    name: "Repo",
    path: "/srv/repo",
    projectId: "p-1",
    revision: 3,
  });
});

it.each([
  ["a text revision", { revision: "2" }],
  ["a fractional revision", { revision: 1.5 }],
  ["a zero revision", { revision: 0 }],
  ["a missing name", { name: undefined }],
  ["a blank name", { name: "   " }],
  ["an overlong name", { name: "n".repeat(121) }],
  ["a control character", { path: "/srv/\nrepo" }],
  ["an overlong project", { projectId: "p".repeat(101) }],
])("refuses %s", (_, override) => {
  expect(() => readWorkspaceInput({ ...VALID, ...override })).toThrow(
    expect.objectContaining({ code: "workspace_invalid" }),
  );
});

it("refuses a payload that is not an object", () => {
  expect(() => readWorkspaceInput(["Repo"])).toThrow(
    expect.objectContaining({ code: "workspace_invalid" }),
  );
});
