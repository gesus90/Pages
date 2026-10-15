import { expect, it } from "vitest";

import {
  bindAgentParameters,
  bindAgentRunContext,
} from "@/backend/service/agents/AgentParameterBinding";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import {
  agentParameterIssues,
  scanAgentPlaceholders,
} from "@/definition/AgentParameters";

const REFERENCES = {
  workspace: async () => ({ path: "/work" }),
  wiki: async () => ({ markdown: "", link: "", version: "1" }),
};

it("accepts built-ins without creating parameter declarations and preserves run accesses", () => {
  const markdown = "{{@run.notes}} {{run}} {{run.path}}";
  const result = scanAgentPlaceholders(markdown);
  expect(result.hasInvalidSyntax).toBe(false);
  expect(result.builtins.map((entry) => entry.token)).toEqual(["@run.notes"]);
  expect(result.placeholders.map((entry) => entry.name)).toEqual([
    "run",
    "run",
  ]);
  expect(
    agentParameterIssues({
      ...emptyAgentConfiguration(),
      markdown: "{{@run.notes}}",
    }),
  ).toEqual([]);
  expect(
    agentParameterIssues({ ...emptyAgentConfiguration(), markdown: "{{run}}" }),
  ).toContain("undeclared");
});

it("retains escaping and rejects unknown built-ins and the previously invalid run.notes", () => {
  expect(scanAgentPlaceholders(String.raw`\{{@run.notes}}`).builtins).toEqual(
    [],
  );
  for (const markdown of [
    "{{run.notes}}",
    "{{@run.unknown}}",
    "{{@run.notes.path}}",
    "{{@run.notes",
  ])
    expect(scanAgentPlaceholders(markdown).hasInvalidSyntax).toBe(true);
});

it("resolves original occurrences once, preserving tokens inserted by parameter values", async () => {
  const configuration = {
    ...emptyAgentConfiguration(),
    markdown: "{{run}} {{@run.notes}} {{@run.notes}}",
    parameters: [
      {
        name: "run",
        type: "text",
        description: "",
        isRequired: true,
        defaultValue: null,
      } as const,
    ],
  };
  const result = await bindAgentParameters(
    configuration,
    { run: { type: "text", text: "{{@run.notes}}" } },
    { ...REFERENCES, runContext: { notes: "/notes/plan/run" } },
  );
  expect(result.markdown).toBe(
    "{{@run.notes}} /notes/plan/run /notes/plan/run",
  );
  expect(result.values).toEqual({
    run: { type: "text", text: "{{@run.notes}}" },
  });
  await expect(
    bindAgentParameters(
      configuration,
      { "@run.notes": { type: "text", text: "/foreign" } },
      REFERENCES,
    ),
  ).rejects.toMatchObject({ code: "parameter_invalid" });
});

it("keeps a preview symbolic, requires execution context, and resolves node instructions", async () => {
  const template = { ...emptyAgentConfiguration(), markdown: "{{@run.notes}}" };
  expect(
    (
      await bindAgentParameters(
        template,
        {},
        { ...REFERENCES, runContext: "preview" },
      )
    ).markdown,
  ).toBe(template.markdown);
  await expect(
    bindAgentParameters(template, {}, REFERENCES),
  ).rejects.toMatchObject({ code: "plan_notes_unavailable" });
  expect(bindAgentRunContext("Read {{@run.notes}}", { notes: "/notes" })).toBe(
    "Read /notes",
  );
  expect(() => bindAgentRunContext(template.markdown)).toThrow();
});
