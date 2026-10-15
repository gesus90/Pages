import { expect, it } from "vitest";

import { readPlanConfiguration } from "@/backend/agents/AgentPlanConfigurationInput";
import { planExecutionIssues } from "@/definition/AgentPlanGraph";
import { bindAgentParameters } from "@/backend/service/agents/AgentParameterBinding";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import {
  agentParameterIssues,
  scanAgentPlaceholders,
} from "@/definition/AgentParameters";

import { parameterRunFixture } from "./page55-run-fixture";

const REFERENCES = {
  workspace: async () => ({ path: "/work" }),
  wiki: async () => ({ markdown: "", link: "", version: "1" }),
};

it("reports the removed token without creating parameter declarations and preserves run accesses", () => {
  const result = scanAgentPlaceholders("{{@run.notes}} {{run}} {{run.path}}");
  expect(result.hasInvalidSyntax).toBe(false);
  expect(result.hasUnsupportedRunNotes).toBe(true);
  expect(result.placeholders.map((entry) => entry.name)).toEqual([
    "run",
    "run",
  ]);
  expect(
    agentParameterIssues({
      ...emptyAgentConfiguration(),
      markdown: "{{@run.notes}}",
    }),
  ).toEqual(["unsupportedRunNotes"]);
  expect(
    agentParameterIssues({
      ...emptyAgentConfiguration(),
      markdown: "{{run}}",
    }),
  ).toContain("undeclared");
});

it("retains escaping and rejects unknown tokens and the previously invalid run.notes", () => {
  expect(
    scanAgentPlaceholders(String.raw`\{{@run.notes}}`).hasUnsupportedRunNotes,
  ).toBe(false);
  for (const markdown of [
    "{{run.notes}}",
    "{{@run.unknown}}",
    "{{@run.notes.path}}",
    "{{@run.notes",
  ])
    expect(scanAgentPlaceholders(markdown).hasInvalidSyntax).toBe(true);
});

it("resolves original parameter occurrences once without interpreting inserted text", async () => {
  const configuration = {
    ...emptyAgentConfiguration(),
    markdown: "{{run}} {{run}}",
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
    REFERENCES,
  );
  expect(result.markdown).toBe("{{@run.notes}} {{@run.notes}}");
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

it.each(["codex_cli", "openai"] as const)(
  "rejects legacy template and instruction use for %s without changing stored text",
  async (provider) => {
    const template = {
      ...emptyAgentConfiguration(),
      markdown: "{{@run.notes}}",
    };
    await expect(
      bindAgentParameters(template, {}, REFERENCES),
    ).rejects.toMatchObject({ code: "run_notes_unsupported" });
    const fixture = await parameterRunFixture(
      emptyAgentConfiguration(),
      provider,
    );
    const configuration = readPlanConfiguration({
      name: "Legacy node",
      revision: 1,
      modelProfileId: "agent",
      model: fixture.step.model,
      reasoningEffort: null,
      provider,
      template,
    });
    const legacy = { ...fixture.step.step, configuration };
    expect(
      planExecutionIssues({ ...fixture.snapshot.plan, nodes: [legacy] }, []),
    ).toContainEqual({
      nodeId: legacy.id,
      port: null,
      reason: "unsupportedRunNotes",
    });
    await expect(
      fixture.start.prepare(fixture.run, fixture.snapshot, {
        ...fixture.step,
        step: legacy,
        template,
      }),
    ).rejects.toMatchObject({ code: "run_notes_unsupported" });
    await expect(
      fixture.start.prepare(fixture.run, fixture.snapshot, {
        ...fixture.step,
        step: { ...fixture.step.step, instruction: "Read {{@run.notes}}" },
      }),
    ).rejects.toMatchObject({ code: "run_notes_unsupported" });
    expect(configuration.template.markdown).toBe(template.markdown);
  },
);
