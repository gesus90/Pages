import { describe, expect, it } from "vitest";

import {
  configurationForTargets,
  readAgentConfiguration,
  readAgentParameterValue,
  readAgentTargets,
} from "@/backend/agents/AgentConfigurationInput";
import { AgentError } from "@/backend/error/AgentErrors";

const RUN = {
  access: "read_only",
  shell: false,
  web: true,
  timeoutMinutes: 10,
};

const PARAMETER = {
  name: "topic",
  type: "text",
  description: "Topic",
  isRequired: true,
  defaultValue: { type: "text", text: "x" },
};

function configuration(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    scope: "person",
    tag: " tag ",
    markdown: "Body",
    projectId: null,
    accessMode: "personal",
    parameters: [],
    directoryParameter: null,
    sharing: { isGlobal: false, targets: [] },
    ...overrides,
  };
}

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof AgentError ? error.code : undefined;
  }
  return undefined;
}

describe("readAgentParameterValue", () => {
  it("reads every typed value and trims identifiers", () => {
    expect(readAgentParameterValue({ type: "text", text: "" })).toEqual({
      type: "text",
      text: "",
    });
    expect(readAgentParameterValue({ type: "number", number: 0 })).toEqual({
      type: "number",
      number: 0,
    });
    expect(
      readAgentParameterValue({ type: "ticket", ticketId: " t " }),
    ).toEqual({ type: "ticket", ticketId: "t" });
    expect(
      readAgentParameterValue({ type: "workspace", workspaceId: "" }),
    ).toEqual({ type: "workspace", workspaceId: "" });
    expect(readAgentParameterValue({ type: "wiki", pageId: " p " })).toEqual({
      type: "wiki",
      pageId: "p",
    });
    expect(readAgentParameterValue({ type: "asset", assetId: " a " })).toEqual({
      type: "asset",
      assetId: "a",
    });
  });

  it("rejects malformed values", () => {
    expect(
      codeOf(() => readAgentParameterValue({ type: "text", text: 1 })),
    ).toBe("configuration_invalid");
    expect(
      codeOf(() => readAgentParameterValue({ type: "ticket", ticketId: " " })),
    ).toBe("configuration_invalid");
    expect(
      codeOf(() =>
        readAgentParameterValue({ type: "wiki", pageId: "x".repeat(101) }),
      ),
    ).toBe("configuration_invalid");
    expect(
      codeOf(() => readAgentParameterValue({ type: "number", number: "1" })),
    ).toBe("parameter_number_invalid");
    expect(
      codeOf(() =>
        readAgentParameterValue({ type: "number", number: Number.NaN }),
      ),
    ).toBe("parameter_number_invalid");
    expect(codeOf(() => readAgentParameterValue({ type: "other" }))).toBe(
      "parameter_invalid",
    );
    expect(codeOf(() => readAgentParameterValue(null))).toBe(
      "parameter_invalid",
    );
  });
});

describe("readAgentTargets", () => {
  it("keeps the first of repeated targets", () => {
    expect(
      readAgentTargets([
        { kind: "person", targetId: " a " },
        { kind: "person", targetId: "a" },
        { kind: "group", targetId: "a" },
      ]),
    ).toEqual([
      { kind: "person", targetId: "a" },
      { kind: "group", targetId: "a" },
    ]);
  });

  it("rejects a non-list, an oversized list and an unknown kind", () => {
    expect(codeOf(() => readAgentTargets("x"))).toBe("profile_invalid");
    expect(
      codeOf(() =>
        readAgentTargets(
          Array.from({ length: 201 }, () => ({
            kind: "person",
            targetId: "a",
          })),
        ),
      ),
    ).toBe("profile_invalid");
    expect(
      codeOf(() => readAgentTargets([{ kind: "nope", targetId: "a" }])),
    ).toBe("profile_invalid");
  });
});

describe("configurationForTargets", () => {
  it("derives scope and sharing from the targets", () => {
    const result = configurationForTargets([
      { kind: "system", targetId: "s" },
      { kind: "group", targetId: "g" },
    ]);
    expect(result.scope).toBe("system");
    expect(result.sharing).toEqual({
      isGlobal: true,
      targets: [{ kind: "group", targetId: "g" }],
    });
    expect(configurationForTargets([]).scope).toBe("system");
    expect(configurationForTargets([]).sharing.isGlobal).toBe(false);
  });
});

describe("readAgentConfiguration", () => {
  it("reads a configuration without run options", () => {
    const result = readAgentConfiguration(configuration());
    expect(result).toEqual({
      scope: "person",
      tag: "tag",
      markdown: "Body",
      projectId: null,
      accessMode: "personal",
      parameters: [],
      directoryParameter: null,
      sharing: { isGlobal: false, targets: [] },
    });
    expect("run" in result).toBe(false);
  });

  it("reads parameters, project, directory, operator and run options", () => {
    const result = readAgentConfiguration(
      configuration({
        projectId: " p ",
        accessMode: "shared",
        parameters: [
          PARAMETER,
          { ...PARAMETER, name: "dir", type: "workspace", defaultValue: null },
        ],
        directoryParameter: "dir",
        sharing: {
          isGlobal: true,
          operator: "or",
          targets: [{ kind: "group", targetId: "g" }],
        },
        run: { ...RUN, monthlyCostLimitUsd: 5, browser: true },
      }),
    );
    expect(result.projectId).toBe("p");
    expect(result.parameters).toHaveLength(2);
    expect(result.directoryParameter).toBe("dir");
    expect(result.sharing.operator).toBe("or");
    expect(result.run).toEqual({
      ...RUN,
      monthlyCostLimitUsd: 5,
      browser: true,
    });
  });

  it("reads a false browser flag and turns full_environment into yolo", () => {
    const result = readAgentConfiguration(
      configuration({
        run: { ...RUN, access: "full_environment", browser: false },
      }),
    );
    expect(result.run).toEqual({ ...RUN, access: "yolo", browser: false });
    expect(
      readAgentConfiguration(
        configuration({ run: { ...RUN, access: "workspace_write" } }),
      ).run?.access,
    ).toBe("workspace_write");
    expect(
      readAgentConfiguration(configuration({ run: { ...RUN, access: "yolo" } }))
        .run?.access,
    ).toBe("yolo");
  });
});

describe("readAgentConfiguration rejections", () => {
  it("rejects malformed run options", () => {
    const invalid = [
      { ...RUN, access: "root" },
      { ...RUN, shell: "no" },
      { ...RUN, web: 1 },
      { ...RUN, browser: "yes" },
      { ...RUN, timeoutMinutes: "5" },
      { ...RUN, timeoutMinutes: 1.5 },
      { ...RUN, timeoutMinutes: -1 },
      { ...RUN, timeoutMinutes: 121 },
      { ...RUN, monthlyCostLimitUsd: "1" },
      { ...RUN, monthlyCostLimitUsd: -1 },
      { ...RUN, monthlyCostLimitUsd: Number.POSITIVE_INFINITY },
      null,
    ];
    for (const run of invalid)
      expect(codeOf(() => readAgentConfiguration(configuration({ run })))).toBe(
        "configuration_invalid",
      );
  });

  it("rejects malformed top-level fields", () => {
    const invalid = [
      { scope: "nope" },
      { accessMode: "open" },
      { sharing: { isGlobal: "yes", targets: [] } },
      { parameters: "x" },
      { parameters: Array.from({ length: 51 }, () => PARAMETER) },
      { sharing: { isGlobal: false, targets: [], operator: "xor" } },
      {
        sharing: {
          isGlobal: false,
          targets: [{ kind: "system", targetId: "s" }],
        },
      },
      { tag: "x".repeat(41) },
      { markdown: 1 },
      { projectId: "" },
      { directoryParameter: "x".repeat(65) },
    ];
    for (const overrides of invalid)
      expect(
        codeOf(() => readAgentConfiguration(configuration(overrides))),
      ).toBe("configuration_invalid");
  });

  it("rejects malformed parameters", () => {
    const invalid = [
      { ...PARAMETER, name: "1bad" },
      { ...PARAMETER, type: "json" },
      { ...PARAMETER, isRequired: "yes" },
      { ...PARAMETER, defaultValue: { type: "number", number: 1 } },
      { ...PARAMETER, defaultValue: undefined },
    ];
    for (const entry of invalid)
      expect(
        codeOf(() =>
          readAgentConfiguration(configuration({ parameters: [entry] })),
        ),
      ).toBe("parameter_invalid");
    expect(
      codeOf(() =>
        readAgentConfiguration(
          configuration({ parameters: [{ ...PARAMETER, description: 1 }] }),
        ),
      ),
    ).toBe("configuration_invalid");
  });

  it("accepts each parameter type", () => {
    for (const type of ["number", "ticket", "workspace", "wiki", "asset"])
      expect(
        readAgentConfiguration(
          configuration({
            parameters: [{ ...PARAMETER, type, defaultValue: null }],
          }),
        ).parameters[0]?.type,
      ).toBe(type);
  });
});
