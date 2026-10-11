import { describe, expect, it, vi } from "vitest";

import { readAgentConfiguration } from "@/backend/agents/AgentConfigurationInput";
import { bindAgentParameters } from "@/backend/service/agents/AgentParameterBinding";
import { readAgentProfileInput } from "@/backend/service/agents/AgentProfileValidation";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import {
  agentParameterIssues,
  scanAgentPlaceholders,
} from "@/definition/AgentParameters";

import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { AgentParameter } from "@/definition/AgentParameters";

function configuration(
  overrides: Partial<AgentConfiguration> = {},
): AgentConfiguration {
  return { ...emptyAgentConfiguration(), ...overrides };
}

function parameter(
  name: string,
  overrides: Partial<AgentParameter> = {},
): AgentParameter {
  return {
    name,
    type: "text",
    description: "",
    isRequired: true,
    defaultValue: null,
    ...overrides,
  };
}

function references(): {
  readonly workspace: ReturnType<
    typeof vi.fn<(id: string) => Promise<{ path: string }>>
  >;
  readonly wiki: ReturnType<
    typeof vi.fn<
      (
        id: string,
      ) => Promise<{ markdown: string; link: string; version: string }>
    >
  >;
} {
  return {
    workspace: vi.fn(async (id: string) => ({ path: `/work/${id}` })),
    wiki: vi.fn(async (id: string) => ({
      markdown: "Wiki {{instruction}}",
      link: `/wiki/${id}`,
      version: "7",
    })),
  };
}

describe("A10.2 template declarations and typed step bindings", () => {
  it("recognizes only the fixed syntax, preserves escaped literals and requires confirmed declarations", () => {
    const scanned = scanAgentPlaceholders(
      "{{text}} {{workspace.path}} {{task.link}} {{task.markdown}} \\{{literal}}",
    );
    expect(scanned.hasInvalidSyntax).toBe(false);
    expect(
      scanned.placeholders.map((entry) => [entry.name, entry.type]),
    ).toEqual([
      ["text", "text"],
      ["workspace", "workspace"],
      ["task", "wiki"],
      ["task", "wiki"],
    ]);
    for (const markdown of [
      "{{Bad}}",
      "{{text.text}}",
      "{{text | eval}}",
      "{{task.unknown}}",
      "{{text",
    ])
      expect(scanAgentPlaceholders(markdown).hasInvalidSyntax).toBe(true);
    expect(agentParameterIssues(configuration({ markdown: "{{text" }))).toEqual(
      ["syntax"],
    );
    expect(
      agentParameterIssues(configuration({ markdown: "{{text}}" })),
    ).toEqual(["undeclared"]);
    expect(
      agentParameterIssues(
        configuration({
          markdown: "{{text.path}}",
          parameters: [parameter("text"), parameter("text")],
          directoryParameter: "text",
        }),
      ),
    ).toEqual(["duplicate", "typeMismatch", "directory"]);
  });

  it("binds explicit values over defaults exactly once, preserving the reusable template and typed references", async () => {
    const source = configuration({
      markdown:
        "{{instruction}}\n{{workspace.path}}\n{{task.link}}\n{{task.markdown}}\n\\{{literal}}",
      parameters: [
        parameter("instruction", {
          defaultValue: { type: "text", text: "Default" },
        }),
        parameter("workspace", { type: "workspace" }),
        parameter("task", { type: "wiki" }),
      ],
      directoryParameter: "workspace",
    });
    const before = JSON.stringify(source);
    const resolved = references();
    const result = await bindAgentParameters(
      source,
      {
        instruction: { type: "text", text: "Keep {{task.markdown}} literal" },
        workspace: { type: "workspace", workspaceId: "root" },
        task: { type: "wiki", pageId: "task-page" },
      },
      resolved,
    );
    expect(result.markdown).toBe(
      "Keep {{task.markdown}} literal\n/work/root\n/wiki/task-page\nWiki {{instruction}}\n\\{{literal}}",
    );
    expect(result.directory).toBe("/work/root");
    expect(result.values.workspace).toEqual({
      type: "workspace",
      workspaceId: "root",
    });
    expect(result.wikiVersions).toEqual({ task: "7" });
    expect(JSON.stringify(source)).toBe(before);
    expect(resolved.workspace).toHaveBeenCalledOnce();
    expect(resolved.wiki).toHaveBeenCalledOnce();
  });

  it("enforces required values and types, keeps optional empties, and does not infer a working directory from prompt paths", async () => {
    const source = configuration({
      markdown: "{{required}}/{{optional}}/{{root.path}}",
      parameters: [
        parameter("required", {
          defaultValue: { type: "text", text: "Default" },
        }),
        parameter("optional", { isRequired: false }),
        parameter("root", {
          type: "workspace",
          defaultValue: { type: "workspace", workspaceId: "root" },
        }),
      ],
    });
    const resolved = references();
    expect(await bindAgentParameters(source, {}, resolved)).toMatchObject({
      markdown: "Default///work/root",
      directory: null,
    });
    await expect(
      bindAgentParameters(source, { required: null }, resolved),
    ).rejects.toMatchObject({ code: "parameter_required" });
    for (const bindings of [
      { required: null },
      { required: { type: "text", text: "  " } },
      { optional: { type: "wiki", pageId: "page" } },
      { unknown: { type: "text", text: "x" } },
    ])
      await expect(
        bindAgentParameters(source, bindings, resolved),
      ).rejects.toThrow();
    await expect(
      bindAgentParameters(
        configuration({
          parameters: [
            parameter("root", { type: "workspace", isRequired: false }),
          ],
          directoryParameter: "root",
        }),
        {},
        resolved,
      ),
    ).rejects.toMatchObject({ code: "parameter_required" });
    const unavailable = references();
    unavailable.workspace.mockRejectedValue(
      new Error("denied by resource policy"),
    );
    await expect(bindAgentParameters(source, {}, unavailable)).rejects.toThrow(
      "denied by resource policy",
    );
  });

  it("validates bounded declarations at the server boundary and permits unfinished placeholders only in inactive drafts", () => {
    const source = configuration({ markdown: "{{missing}}" });
    const input = {
      name: "Task",
      connectionId: "access",
      model: "model",
      reasoningEffort: null,
      isActive: false,
      purposes: ["agent"],
      targets: [],
      configuration: source,
    };
    expect(readAgentProfileInput(input).configuration?.markdown).toBe(
      "{{missing}}",
    );
    expect(() =>
      readAgentProfileInput({
        ...input,
        isActive: true,
        targets: [{ kind: "person", targetId: "alice" }],
      }),
    ).toThrow(expect.objectContaining({ code: "parameter_invalid" }));
    expect(() =>
      readAgentConfiguration(
        configuration({ parameters: [parameter("invalid.name")] }),
      ),
    ).toThrow();
    expect(() =>
      readAgentConfiguration(
        configuration({
          parameters: [
            parameter("text", { defaultValue: { type: "wiki", pageId: "id" } }),
          ],
        }),
      ),
    ).toThrow();
    expect(() =>
      readAgentProfileInput({
        ...input,
        configuration: configuration({ accessMode: "shared" }),
      }),
    ).toThrow(expect.objectContaining({ code: "profile_scope_invalid" }));
    expect(() =>
      readAgentProfileInput({
        ...input,
        targets: [
          { kind: "person", targetId: "alice" },
          { kind: "group", targetId: "team" },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: "profile_scope_invalid" }));
    expect(() => readAgentProfileInput({ ...input, revision: 0 })).toThrow(
      expect.objectContaining({ code: "profile_invalid" }),
    );
  });
});
