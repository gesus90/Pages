import { expect, it } from "vitest";

import { readPlanConfiguration } from "@/backend/agents/AgentPlanConfigurationInput";

import { agentErrorCode } from "./agent-error-code";

const RUN = {
  access: "read_only",
  shell: false,
  web: true,
  timeoutMinutes: 10,
};

const ROUTE = {
  connectionId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  catalogRevision: "r1",
};

const CONFIGURATION = {
  name: "Reviewer",
  revision: 2,
  modelProfileId: "",
  model: "gpt-5",
  provider: "openai",
  reasoningEffort: "high",
  template: {
    markdown: "Review {{topic}}",
    parameters: [
      {
        name: "topic",
        type: "text",
        description: "",
        isRequired: true,
        defaultValue: null,
      },
    ],
    directoryParameter: null,
  },
};

it("reads a node copy without the optional route, connection and run options", () => {
  expect(readPlanConfiguration(CONFIGURATION)).toEqual({
    name: "Reviewer",
    revision: 2,
    modelProfileId: "",
    model: "gpt-5",
    provider: "openai",
    reasoningEffort: "high",
    template: {
      markdown: "Review {{topic}}",
      parameters: CONFIGURATION.template.parameters,
      directoryParameter: null,
    },
  });
});

it("reads the optional runner route, connection and run options", () => {
  expect(
    readPlanConfiguration({
      ...CONFIGURATION,
      provider: null,
      reasoningEffort: null,
      runnerRoute: ROUTE,
      connectionId: "connection-1",
      template: { ...CONFIGURATION.template, run: RUN },
    }),
  ).toMatchObject({
    runnerRoute: ROUTE,
    connectionId: "connection-1",
    provider: null,
    reasoningEffort: null,
    template: { run: RUN },
  });
});

it("keeps a removed run-notes token for node diagnostics", () => {
  expect(
    readPlanConfiguration({
      ...CONFIGURATION,
      template: { ...CONFIGURATION.template, markdown: "{{@run.notes}}" },
    }).template.markdown,
  ).toBe("{{@run.notes}}");
});

it.each<[string, Record<string, unknown>]>([
  ["a revision that is no number", { revision: "2" }],
  ["a fractional revision", { revision: 1.5 }],
  ["a revision below one", { revision: 0 }],
  ["an unknown provider", { provider: "acme" }],
  ["a reasoning effort that is no text", { reasoningEffort: 3 }],
  ["a reasoning effort that is too long", { reasoningEffort: "x".repeat(101) }],
  ["a name that is no text", { name: null }],
  ["a name that is too long", { name: "x".repeat(201) }],
  ["an empty model", { model: " " }],
  ["an empty connection", { connectionId: "" }],
])("refuses a node copy with %s", (scenario, change) => {
  expect(
    agentErrorCode(() =>
      readPlanConfiguration({ ...CONFIGURATION, ...change }),
    ),
  ).toBe("configuration_invalid");
});

it("refuses a template with an undeclared placeholder", () => {
  expect(
    agentErrorCode(() =>
      readPlanConfiguration({
        ...CONFIGURATION,
        template: { ...CONFIGURATION.template, markdown: "{{missing}}" },
      }),
    ),
  ).toBe("parameter_invalid");
});

it("refuses an invalid runner route through its schema", () => {
  expect(
    agentErrorCode(() =>
      readPlanConfiguration({
        ...CONFIGURATION,
        runnerRoute: { ...ROUTE, connectionId: "nope" },
      }),
    ),
  ).toBe("other");
});
