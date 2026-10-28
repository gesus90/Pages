import { expect, it } from "vitest";

import {
  agentParameterIssues,
  hasAgentParameterValue,
  placeholderNames,
  scanAgentPlaceholders,
} from "@/definition/AgentParameters";

import type { AgentParameter } from "@/definition/AgentParameters";

/** A declared parameter of the given type without a default. */
function parameter(
  name: string,
  type: AgentParameter["type"],
  defaultValue: AgentParameter["defaultValue"] = null,
): AgentParameter {
  return { name, type, description: "", isRequired: false, defaultValue };
}

it("treats blank values as missing and zero as a number", () => {
  expect(hasAgentParameterValue(null)).toBe(false);
  expect(hasAgentParameterValue({ type: "text", text: " " })).toBe(false);
  expect(hasAgentParameterValue({ type: "number", number: 0 })).toBe(true);
  expect(hasAgentParameterValue({ type: "number", number: Number.NaN })).toBe(
    false,
  );
  expect(hasAgentParameterValue({ type: "ticket", ticketId: "t-1" })).toBe(
    true,
  );
  expect(hasAgentParameterValue({ type: "workspace", workspaceId: " " })).toBe(
    false,
  );
  expect(hasAgentParameterValue({ type: "wiki", pageId: "p-1" })).toBe(true);
});

it("reads typed properties and keeps escaped openings literal", () => {
  const scanned = scanAgentPlaceholders(
    "{{repo.path}} {{page.link}} {{page.markdown}} {{ticket.description}} {{ticket.assets}} \\{{skip}}",
  );

  expect(
    scanned.placeholders.map((found) => `${found.name}:${found.type}`),
  ).toEqual([
    "repo:workspace",
    "page:wiki",
    "page:wiki",
    "ticket:ticket",
    "ticket:ticket",
  ]);
  expect(scanned.hasInvalidSyntax).toBe(false);
});

it("reports run notes and invalid placeholder syntax", () => {
  expect(scanAgentPlaceholders("{{@run.notes}}").hasUnsupportedRunNotes).toBe(
    true,
  );
  for (const markdown of [
    "{{1name}}",
    "{{a.b.c}}",
    "{{a.size}}",
    "{{a.text}}",
    "{{open",
  ])
    expect(scanAgentPlaceholders(markdown).hasInvalidSyntax).toBe(true);
});

it("names only unescaped placeholders", () => {
  expect([...placeholderNames("{{ergebnis}} \\{{hidden}}")]).toEqual([
    "ergebnis",
  ]);
});

it("accepts declared parameters, numbers and tickets as text", () => {
  expect(
    agentParameterIssues({
      markdown: "{{count}} {{ticket}} {{repo.path}}",
      parameters: [
        parameter("count", "number", { type: "number", number: 2 }),
        parameter("ticket", "ticket"),
        parameter("repo", "workspace"),
      ],
      directoryParameter: "repo",
    }),
  ).toEqual([]);
});

it("collects every issue of a template once", () => {
  const issues = agentParameterIssues({
    markdown: "{{@run.notes}} {{bad.size}} {{missing}} {{page.path}} {{page}}",
    parameters: [
      parameter("page", "wiki"),
      parameter("page", "wiki"),
      parameter("limit", "number", { type: "number", number: Infinity }),
    ],
    directoryParameter: "page",
  });

  expect([...issues].sort()).toEqual([
    "directory",
    "duplicate",
    "number",
    "syntax",
    "typeMismatch",
    "undeclared",
    "unsupportedRunNotes",
  ]);
});

it("requires a named directory parameter to exist", () => {
  expect(
    agentParameterIssues({
      markdown: "",
      parameters: [],
      directoryParameter: "repo",
    }),
  ).toEqual(["directory"]);
});
