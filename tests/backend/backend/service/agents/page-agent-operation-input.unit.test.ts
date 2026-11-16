import { expect, it } from "vitest";

import {
  readPageAgentFields,
  readPageAgentListRequest,
  readPageAgentReadRequest,
  readPageAgentRevision,
  readPageAgentSharing,
  readPageAgentWriteRequest,
  requirePageAgentModelsRequest,
} from "@/backend/service/agents/PageAgentOperationInput";

it("reads create and revision-checked update requests", () => {
  expect(
    readPageAgentWriteRequest("agents.create", {
      operationId: "op",
      name: "  Name  ",
      instruction: "Hello",
    }),
  ).toEqual({
    operation: "agents.create",
    operationId: "op",
    fields: { name: "Name", instruction: "Hello" },
  });
  expect(
    readPageAgentWriteRequest("agents.update", {
      operationId: "op",
      agentId: "agent",
      expectedRevision: 2,
      reasoningEffort: null,
    }),
  ).toEqual({
    operation: "agents.update",
    operationId: "op",
    agentId: "agent",
    expectedRevision: 2,
    fields: { reasoningEffort: null },
  });
  expect(() =>
    readPageAgentWriteRequest("agents.update", {
      operationId: "op",
      agentId: "agent",
      expectedRevision: 2,
    }),
  ).toThrow();
  expect(() =>
    readPageAgentWriteRequest("agents.create", {
      operationId: "op",
      name: "Name",
      ownerId: "other",
    }),
  ).toThrow();
});

it("normalizes restricted share targets without changing their operator", () => {
  expect(
    readPageAgentSharing({
      scope: "restricted",
      operator: "and",
      groupIds: ["b", "a", "b"],
      departmentIds: ["d"],
    }),
  ).toEqual({
    scope: "restricted",
    operator: "and",
    groupIds: ["a", "b"],
    departmentIds: ["d"],
  });
  expect(readPageAgentSharing({ scope: "private" })).toEqual({
    scope: "private",
    groupIds: [],
    departmentIds: [],
  });
});

it.each([
  { scope: "restricted" },
  { scope: "private", groupIds: ["a"] },
  { scope: "private", operator: "and" },
  { scope: "restricted", groupIds: ["a"], operator: "bad" },
  { scope: "bad" },
  { scope: "restricted", groupIds: Array.from({ length: 101 }, () => "a") },
])("rejects invalid sharing rules", (input) => {
  expect(() => readPageAgentSharing(input)).toThrow();
});

it.each([0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid revisions",
  (revision) => {
    expect(() => readPageAgentRevision(revision)).toThrow();
  },
);

it("validates optional fields and forbids replacing and changing parameters at once", () => {
  expect(
    readPageAgentFields({
      directoryParameter: null,
      modelProfileId: "model",
      reasoningEffort: "high",
    }),
  ).toEqual({
    directoryParameter: null,
    modelProfileId: "model",
    reasoningEffort: "high",
  });
  for (const input of [
    { name: " " },
    { instruction: 2 },
    { reasoningEffort: " " },
    { parameters: [], parameterChanges: [] },
  ])
    expect(() => readPageAgentFields(input)).toThrow();
});

it("validates list, read and models request shapes", () => {
  expect(readPageAgentListRequest({ limit: 10 })).toEqual({
    cursor: undefined,
    limit: 10,
  });
  expect(readPageAgentReadRequest({ agentId: "agent" })).toBe("agent");
  expect(() => requirePageAgentModelsRequest({})).not.toThrow();
  expect(() => readPageAgentListRequest({ other: true })).toThrow();
  expect(() => readPageAgentReadRequest({})).toThrow();
  expect(() => requirePageAgentModelsRequest({ other: true })).toThrow();
});
