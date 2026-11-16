import { describe, expect, it } from "vitest";

import {
  changePageAgentParameters,
  readPageAgentParameterChanges,
  readPageAgentParameters,
} from "@/backend/service/agents/PageAgentParameterChanges";

const first = {
  name: "first",
  type: "text",
  description: "First",
  isRequired: false,
  defaultValue: null,
};
const second = {
  name: "second",
  type: "text",
  description: "Second",
  isRequired: false,
  defaultValue: null,
};

describe("agent parameter changes", () => {
  it("validates and applies a batch while retaining unmentioned fields", () => {
    const parameters = readPageAgentParameters([first, second]);
    const changes = readPageAgentParameterChanges([
      { action: "update", name: "first", fields: { description: "Changed" } },
      { action: "remove", name: "second" },
      { action: "add", parameter: { ...second, name: "third" } },
    ]);
    expect(changePageAgentParameters(parameters, changes)).toEqual([
      { ...first, description: "Changed" },
      { ...second, name: "third" },
    ]);
    expect(changePageAgentParameters(parameters, undefined)).toBe(parameters);
    expect(parameters).toEqual([first, second]);
  });

  it.each([
    null,
    [],
    Array.from({ length: 51 }, () => ({ action: "remove", name: "first" })),
    [{ action: "unknown", name: "first" }],
    [{ action: "remove", name: "bad name" }],
    [{ action: "remove", name: "first", extra: true }],
    [{ action: "update", name: "first", fields: {} }],
    [{ action: "update", name: "first", fields: { name: "other" } }],
    [
      { action: "remove", name: "first" },
      { action: "update", name: "first", fields: { description: "x" } },
    ],
  ])("rejects malformed or ambiguous batches", (input) => {
    expect(() => readPageAgentParameterChanges(input)).toThrow();
  });

  it.each([
    null,
    {},
    Array.from({ length: 51 }, () => first),
    [{ ...first, type: "invalid" }],
  ])("rejects invalid declarations", (input) => {
    expect(() => readPageAgentParameters(input)).toThrow();
  });

  it.each([
    [{ action: "add", parameter: first }],
    [{ action: "remove", name: "missing" }],
    [{ action: "update", name: "missing", fields: { description: "x" } }],
  ])("rejects changes that conflict with the current revision", (input) => {
    const changes = readPageAgentParameterChanges([input]);
    expect(() =>
      changePageAgentParameters(readPageAgentParameters([first]), changes),
    ).toThrow();
  });
});
