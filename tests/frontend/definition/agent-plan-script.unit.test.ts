import { describe, expect, it } from "vitest";

import {
  PLAN_SCRIPT_CONTENT_LENGTH,
  PLAN_SCRIPT_INPUT_COUNT,
  PLAN_SCRIPT_NAME_LENGTH,
  PLAN_SCRIPT_TIMEOUT,
  planInterpreters,
  planScriptIssues,
  planScriptParameters,
} from "@/definition/AgentPlanScript";

import type { AgentPlanScriptConfiguration } from "@/definition/AgentPlanScript";

/** A valid script configuration, changed by the given fields. */
function script(
  overrides: Partial<AgentPlanScriptConfiguration> = {},
): AgentPlanScriptConfiguration {
  return {
    name: "Build report",
    interpreterProfileId: "bash-5",
    content: "echo done",
    inputs: [{ name: "ticket", type: "text", isRequired: true }],
    outputs: [{ name: "report", type: "text" }],
    timeoutSeconds: 60,
    ...overrides,
  };
}

function inputs(count: number): AgentPlanScriptConfiguration["inputs"] {
  return Array.from({ length: count }, (_, index) => ({
    name: `input${index}`,
    type: "text" as const,
    isRequired: false,
  }));
}

describe("checking a script configuration", () => {
  it("accepts a complete configuration and the limits themselves", () => {
    expect(planScriptIssues(script())).toEqual([]);
    expect(
      planScriptIssues(
        script({
          name: "x".repeat(PLAN_SCRIPT_NAME_LENGTH),
          content: "x".repeat(PLAN_SCRIPT_CONTENT_LENGTH),
          inputs: inputs(PLAN_SCRIPT_INPUT_COUNT),
          outputs: [],
          timeoutSeconds: PLAN_SCRIPT_TIMEOUT.maximum,
        }),
      ),
    ).toEqual([]);
    expect(
      planScriptIssues(script({ timeoutSeconds: PLAN_SCRIPT_TIMEOUT.minimum })),
    ).toEqual([]);
  });

  it.each([
    { label: "empty", name: "   " },
    { label: "too long", name: "x".repeat(PLAN_SCRIPT_NAME_LENGTH + 1) },
    { label: "with a control character", name: "Build\nreport" },
  ])("refuses a name that is $label", ({ name }) => {
    expect(planScriptIssues(script({ name }))).toEqual(["name"]);
  });

  it.each(["", "bash 5", "bash/5", "x".repeat(81)])(
    "refuses the interpreter profile id “%s”",
    (interpreterProfileId) => {
      expect(planScriptIssues(script({ interpreterProfileId }))).toEqual([
        "profile",
      ]);
    },
  );

  it("refuses blank content and content beyond the limit", () => {
    expect(planScriptIssues(script({ content: " \n\t" }))).toEqual(["content"]);
    expect(
      planScriptIssues(
        script({ content: "x".repeat(PLAN_SCRIPT_CONTENT_LENGTH + 1) }),
      ),
    ).toEqual(["contentLength"]);
  });

  it("refuses too many inputs and unusable input or output names", () => {
    expect(
      planScriptIssues(script({ inputs: inputs(PLAN_SCRIPT_INPUT_COUNT + 1) })),
    ).toEqual(["inputCount"]);
    expect(
      planScriptIssues(
        script({ inputs: [{ name: "1bad", type: "text", isRequired: true }] }),
      ),
    ).toEqual(["inputName"]);
    expect(
      planScriptIssues(
        script({ outputs: [{ name: "bad name", type: "text" }] }),
      ),
    ).toEqual(["outputName"]);
  });

  it("allows one output at most and refuses duplicate names across inputs and outputs", () => {
    expect(
      planScriptIssues(
        script({
          outputs: [
            { name: "one", type: "text" },
            { name: "two", type: "text" },
          ],
        }),
      ),
    ).toEqual(["outputName"]);
    expect(
      planScriptIssues(script({ outputs: [{ name: "ticket", type: "text" }] })),
    ).toEqual(["duplicateName"]);
  });

  it.each([0, -1, PLAN_SCRIPT_TIMEOUT.maximum + 1, 1.5, Number.NaN])(
    "refuses the timeout %s",
    (timeoutSeconds) => {
      expect(planScriptIssues(script({ timeoutSeconds }))).toEqual(["timeout"]);
    },
  );

  it("reports every problem at once, in a stable order", () => {
    expect(
      planScriptIssues(
        script({
          name: "",
          interpreterProfileId: "",
          content: "",
          timeoutSeconds: 0,
        }),
      ),
    ).toEqual(["name", "profile", "content", "timeout"]);
  });
});

describe("script inputs as parameters", () => {
  it("offers every input as a text parameter without a default", () => {
    expect(
      planScriptParameters({
        inputs: [
          { name: "a", type: "text", isRequired: true },
          { name: "b", type: "text", isRequired: false },
        ],
      }),
    ).toEqual([
      {
        name: "a",
        type: "text",
        description: "",
        isRequired: true,
        defaultValue: null,
      },
      {
        name: "b",
        type: "text",
        description: "",
        isRequired: false,
        defaultValue: null,
      },
    ]);
    expect(planScriptParameters({ inputs: [] })).toEqual([]);
  });
});

describe("interpreters of the editor", () => {
  it("joins every profile with its last check and treats a missing check as unchecked", () => {
    const failure = "missing" as const;
    expect(
      planInterpreters(
        [
          { id: "ok", name: "Bash" },
          { id: "bad", name: "Python" },
          { id: "new", name: "Node" },
        ],
        {
          ok: { path: "/bin/bash", status: "ok", version: "5.2" },
          bad: {
            path: "/bin/python",
            status: "error",
            version: null,
            error: failure,
          },
        },
      ),
    ).toEqual([
      { id: "ok", name: "Bash", status: "ok", version: "5.2", error: null },
      {
        id: "bad",
        name: "Python",
        status: "error",
        version: null,
        error: failure,
      },
      {
        id: "new",
        name: "Node",
        status: "unchecked",
        version: null,
        error: null,
      },
    ]);
  });
});
