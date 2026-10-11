import { describe, expect, it, vi } from "vitest";

import {
  configurationForTargets,
  readAgentConfiguration,
  readAgentParameterValue,
  readAgentTargets,
} from "@/backend/agents/AgentConfigurationInput";
import { readWorkspaceInput } from "@/backend/agents/AgentWorkspaceInput";
import { bindAgentParameters } from "@/backend/service/agents/AgentParameterBinding";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { scanAgentPlaceholders } from "@/definition/AgentParameters";

import type { AgentParameter } from "@/definition/AgentParameters";

const parameter: AgentParameter = {
  name: "input",
  type: "text",
  description: "Input",
  isRequired: false,
  defaultValue: null,
};

describe("A10 configuration boundary validation", () => {
  it("bounds every declaration field and rejects invalid scopes, access modes and sharing", () => {
    const base = emptyAgentConfiguration();
    for (const overrides of [
      { scope: "unknown" },
      { accessMode: "unknown" },
      { sharing: { isGlobal: null, targets: [] } },
      {
        sharing: {
          isGlobal: true,
          targets: [{ kind: "system", targetId: "agent" }],
        },
      },
      { parameters: null },
      { parameters: Array(51).fill(parameter) },
      { tag: null },
      { tag: "x".repeat(41) },
      { markdown: "x".repeat(200001) },
      { projectId: " " },
      { projectId: "x".repeat(101) },
      { directoryParameter: "" },
    ])
      expect(() => readAgentConfiguration({ ...base, ...overrides })).toThrow();
    for (const overrides of [
      { name: "Bad" },
      { type: "unknown" },
      { isRequired: null },
      { description: 7 },
      { description: "x".repeat(1001) },
      { defaultValue: { type: "workspace", workspaceId: "root" } },
    ])
      expect(() =>
        readAgentConfiguration({
          ...base,
          parameters: [{ ...parameter, ...overrides }],
        }),
      ).toThrow();
    expect(
      readAgentConfiguration({
        ...base,
        projectId: " project ",
        directoryParameter: "root",
      }),
    ).toMatchObject({ projectId: "project", directoryParameter: "root" });
    expect(
      readAgentConfiguration({
        ...base,
        parameters: [
          { ...parameter, defaultValue: { type: "text", text: "default" } },
        ],
      }).parameters[0].defaultValue,
    ).toEqual({ type: "text", text: "default" });
  });

  it("keeps typed references as trimmed identifiers and does not allow implicit values", () => {
    expect(
      readAgentParameterValue({ type: "workspace", workspaceId: " root " }),
    ).toEqual({ type: "workspace", workspaceId: "root" });
    expect(readAgentParameterValue({ type: "wiki", pageId: " page " })).toEqual(
      { type: "wiki", pageId: "page" },
    );
    expect(readAgentParameterValue({ type: "text", text: "" })).toEqual({
      type: "text",
      text: "",
    });
    for (const input of [
      null,
      { type: "unknown" },
      { type: "text", text: 7 },
      { type: "workspace", workspaceId: "" },
      { type: "wiki", pageId: "x".repeat(101) },
    ])
      expect(() => readAgentParameterValue(input)).toThrow();
  });

  it("deduplicates organizational grants and preserves compatibility scope independently of sharing", () => {
    expect(
      readAgentTargets([
        { kind: "person", targetId: " bob " },
        { kind: "person", targetId: "bob" },
        { kind: "group", targetId: "bob" },
      ]),
    ).toEqual([
      { kind: "person", targetId: "bob" },
      { kind: "group", targetId: "bob" },
    ]);
    for (const input of [
      null,
      Array(201).fill(null),
      [{ kind: "unknown", targetId: "bob" }],
    ])
      expect(() => readAgentTargets(input)).toThrow();
    expect(configurationForTargets([])).toMatchObject({
      scope: "system",
      sharing: { isGlobal: false, targets: [] },
    });
    expect(
      configurationForTargets([
        { kind: "group", targetId: "team" },
        { kind: "system", targetId: "agent" },
      ]),
    ).toMatchObject({
      scope: "group",
      sharing: {
        isGlobal: true,
        targets: [{ kind: "group", targetId: "team" }],
      },
    });
  });
});

describe("A10 workspace registration boundary", () => {
  const base = {
    name: "Copy",
    path: "/approved/copy",
    projectId: "project",
    targets: [{ kind: "person", targetId: "bob" }],
  };

  it("rejects malformed paths, missing grants and nonintegral optimistic revisions", () => {
    for (const overrides of [
      { name: 7 },
      { name: " " },
      { name: "x".repeat(121) },
      { path: "/copy\u0000" },
      { targets: [] },
      { targets: [{ kind: "system", targetId: "agent" }] },
      ...["1", 0, 1.5, Number.MAX_SAFE_INTEGER + 1].map((revision) => ({
        revision,
      })),
    ])
      expect(() => readWorkspaceInput({ ...base, ...overrides })).toThrow();
    expect(
      readWorkspaceInput({ ...base, name: " Copy ", revision: 2 }),
    ).toEqual({ ...base, revision: 2 });
    expect(readWorkspaceInput(base)).toEqual(base);
  });
});

describe("A10 parameter expansion limits", () => {
  it("rejects malformed binding containers, undeclared templates and oversized expansion", async () => {
    const references = { workspace: vi.fn(), wiki: vi.fn() };
    const base = {
      ...emptyAgentConfiguration(),
      parameters: [parameter],
      markdown: "{{input}}",
    };
    for (const input of [null, [], 7])
      await expect(
        bindAgentParameters(base, input, references),
      ).rejects.toMatchObject({ code: "parameter_invalid" });
    await expect(
      bindAgentParameters({ ...base, markdown: "{{unknown}}" }, {}, references),
    ).rejects.toMatchObject({ code: "parameter_invalid" });
    await expect(
      bindAgentParameters(
        { ...base, markdown: "{{input}}".repeat(6) },
        { input: { type: "text", text: "x".repeat(200000) } },
        references,
      ),
    ).rejects.toMatchObject({ code: "parameter_invalid" });
    expect(references.workspace).not.toHaveBeenCalled();
    expect(references.wiki).not.toHaveBeenCalled();
    expect(
      scanAgentPlaceholders("\\\\{{input}} {{input.path.extra}}"),
    ).toMatchObject({
      hasInvalidSyntax: true,
      placeholders: [expect.objectContaining({ name: "input" })],
    });
  });
});
