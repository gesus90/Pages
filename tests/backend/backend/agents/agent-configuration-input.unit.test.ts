import { expect, it } from "vitest";

import {
  configurationForTargets,
  readAgentConfiguration,
  readAgentParameterValue,
  readAgentTargets,
} from "@/backend/agents/AgentConfigurationInput";

import { agentErrorCode } from "./agent-error-code";

const PARAMETER = {
  name: "topic",
  type: "text",
  description: "Topic",
  isRequired: true,
  defaultValue: { type: "text", text: "Default" },
};

const RUN_WITHOUT_BROWSER = {
  access: "read_only",
  shell: true,
  web: false,
  timeoutMinutes: 30,
};

const RUN = { ...RUN_WITHOUT_BROWSER, browser: true };

const CONFIGURATION_WITHOUT_RUN = {
  scope: "group",
  tag: " review ",
  markdown: "# Task",
  projectId: " project-1 ",
  accessMode: "shared",
  parameters: [PARAMETER],
  directoryParameter: "topic",
  sharing: {
    isGlobal: true,
    operator: "or",
    targets: [{ kind: "group", targetId: " g1 " }],
  },
};

const CONFIGURATION = { ...CONFIGURATION_WITHOUT_RUN, run: RUN };

it("reads a complete configuration with trimmed identifiers and run options", () => {
  expect(readAgentConfiguration(CONFIGURATION)).toEqual({
    scope: "group",
    tag: "review",
    markdown: "# Task",
    projectId: "project-1",
    accessMode: "shared",
    parameters: [
      {
        name: "topic",
        type: "text",
        description: "Topic",
        isRequired: true,
        defaultValue: { type: "text", text: "Default" },
      },
    ],
    directoryParameter: "topic",
    sharing: {
      isGlobal: true,
      operator: "or",
      targets: [{ kind: "group", targetId: "g1" }],
    },
    run: {
      access: "read_only",
      shell: true,
      web: false,
      browser: true,
      timeoutMinutes: 30,
    },
  });
});

it("leaves optional parts out when they are absent", () => {
  const result = readAgentConfiguration({
    ...CONFIGURATION_WITHOUT_RUN,
    projectId: null,
    directoryParameter: null,
    parameters: [],
    sharing: { isGlobal: false, targets: [] },
  });
  expect(result).toEqual({
    scope: "group",
    tag: "review",
    markdown: "# Task",
    projectId: null,
    accessMode: "shared",
    parameters: [],
    directoryParameter: null,
    sharing: { isGlobal: false, targets: [] },
  });
});

it("keeps run options without a browser setting and accepts a false browser", () => {
  expect(
    readAgentConfiguration({ ...CONFIGURATION, run: RUN_WITHOUT_BROWSER }).run,
  ).toEqual({
    access: "read_only",
    shell: true,
    web: false,
    timeoutMinutes: 30,
  });
  expect(
    readAgentConfiguration({
      ...CONFIGURATION,
      run: { ...RUN, access: "yolo", browser: false },
    }).run,
  ).toMatchObject({ access: "yolo", browser: false });
  expect(
    readAgentConfiguration({
      ...CONFIGURATION,
      run: { ...RUN, access: "workspace_write" },
    }).run,
  ).toMatchObject({ access: "workspace_write" });
});

it.each<[string, Record<string, unknown>]>([
  ["an unknown scope", { scope: "world" }],
  ["an unknown access mode", { accessMode: "public" }],
  [
    "the personal access mode with a malformed share",
    { accessMode: "personal", sharing: {} },
  ],
  ["parameters that are no list", { parameters: {} }],
  [
    "more than 50 parameters",
    { parameters: Array.from({ length: 51 }, () => PARAMETER) },
  ],
  [
    "an unknown share operator",
    { sharing: { ...CONFIGURATION.sharing, operator: "xor" } },
  ],
  [
    "a system share target",
    {
      sharing: {
        isGlobal: false,
        targets: [{ kind: "system", targetId: "all" }],
      },
    },
  ],
  ["a tag that is too long", { tag: "x".repeat(41) }],
  ["a markdown that is no text", { markdown: 1 }],
  ["an empty project id", { projectId: "  " }],
  [
    "a directory parameter that is too long",
    { directoryParameter: "x".repeat(65) },
  ],
  ["an unknown run access", { run: { ...RUN, access: "root" } }],
  ["a shell flag that is no boolean", { run: { ...RUN, shell: "yes" } }],
  ["a web flag that is no boolean", { run: { ...RUN, web: 1 } }],
  ["a browser flag that is no boolean", { run: { ...RUN, browser: "on" } }],
  ["a timeout that is no number", { run: { ...RUN, timeoutMinutes: "5" } }],
  ["a fractional timeout", { run: { ...RUN, timeoutMinutes: 1.5 } }],
  ["a negative timeout", { run: { ...RUN, timeoutMinutes: -1 } }],
  ["a timeout above the maximum", { run: { ...RUN, timeoutMinutes: 121 } }],
])("refuses %s as configuration_invalid", (scenario, change) => {
  expect(
    agentErrorCode(() =>
      readAgentConfiguration({ ...CONFIGURATION, ...change }),
    ),
  ).toBe("configuration_invalid");
});

it("refuses a share whose targets are malformed as profile_invalid", () => {
  expect(
    agentErrorCode(() =>
      readAgentConfiguration({
        ...CONFIGURATION,
        sharing: { isGlobal: false, targets: "all" },
      }),
    ),
  ).toBe("profile_invalid");
});

it.each<[string, Record<string, unknown>]>([
  ["an invalid name", { name: "1topic" }],
  ["an unknown type", { type: "date" }],
  ["a missing required flag", { isRequired: "yes" }],
  [
    "a default of another type",
    { defaultValue: { type: "number", number: 1 } },
  ],
])("refuses a parameter with %s", (scenario, change) => {
  expect(
    agentErrorCode(() =>
      readAgentConfiguration({
        ...CONFIGURATION,
        parameters: [{ ...PARAMETER, ...change }],
      }),
    ),
  ).toBe("parameter_invalid");
});

it.each(["number", "ticket", "workspace", "wiki"])(
  "accepts a %s parameter without a default",
  (type) => {
    const [parameter] = readAgentConfiguration({
      ...CONFIGURATION,
      parameters: [{ ...PARAMETER, type, defaultValue: null }],
    }).parameters;
    expect(parameter).toMatchObject({ type, defaultValue: null });
  },
);

it("reads every typed parameter value", () => {
  expect(readAgentParameterValue({ type: "text", text: "" })).toEqual({
    type: "text",
    text: "",
  });
  expect(readAgentParameterValue({ type: "number", number: 0 })).toEqual({
    type: "number",
    number: 0,
  });
  expect(readAgentParameterValue({ type: "ticket", ticketId: " t1 " })).toEqual(
    { type: "ticket", ticketId: "t1" },
  );
  expect(
    readAgentParameterValue({ type: "workspace", workspaceId: "" }),
  ).toEqual({ type: "workspace", workspaceId: "" });
  expect(readAgentParameterValue({ type: "wiki", pageId: " w1 " })).toEqual({
    type: "wiki",
    pageId: "w1",
  });
});

it.each<[unknown, string]>([
  [{ type: "number", number: "1" }, "parameter_number_invalid"],
  [
    { type: "number", number: Number.POSITIVE_INFINITY },
    "parameter_number_invalid",
  ],
  [{ type: "ticket", ticketId: " " }, "configuration_invalid"],
  [{ type: "wiki", pageId: "x".repeat(101) }, "configuration_invalid"],
  [{ type: "date" }, "parameter_invalid"],
  [null, "parameter_invalid"],
])("refuses the parameter value %j as %s", (input, code) => {
  expect(agentErrorCode(() => readAgentParameterValue(input))).toBe(code);
});

it("reads share targets once each", () => {
  expect(
    readAgentTargets([
      { kind: "person", targetId: " p1 " },
      { kind: "person", targetId: "p1" },
      { kind: "department", targetId: "p1" },
    ]),
  ).toEqual([
    { kind: "person", targetId: "p1" },
    { kind: "department", targetId: "p1" },
  ]);
});

it.each<[string, unknown]>([
  ["no list", { kind: "person" }],
  [
    "more than 200 targets",
    Array.from({ length: 201 }, () => ({ kind: "person", targetId: "p" })),
  ],
  ["an unknown kind", [{ kind: "team", targetId: "t" }]],
])("refuses share targets with %s", (scenario, input) => {
  expect(agentErrorCode(() => readAgentTargets(input))).toBe("profile_invalid");
});

it("turns old profile grants into a shared configuration", () => {
  expect(
    configurationForTargets([
      { kind: "department", targetId: "d1" },
      { kind: "system", targetId: "all" },
    ]),
  ).toMatchObject({
    scope: "department",
    accessMode: "shared",
    sharing: {
      isGlobal: true,
      targets: [{ kind: "department", targetId: "d1" }],
    },
  });
  expect(configurationForTargets([])).toMatchObject({
    scope: "system",
    sharing: { isGlobal: false, targets: [] },
  });
});
