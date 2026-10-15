import { describe, expect, it } from "vitest";

import {
  dependencyKey,
  planStructuredImport,
  structuredKey,
} from "@/backend/service/agents/StructuredImportPlanner";

import {
  manifestOf,
  milestoneSource,
  projectSource,
  ticketSource,
} from "./structured-manifest-fixture";

import type { AgentStructuredReason } from "@/definition/AgentStructuredImportManifest";

function reasons(
  result: ReturnType<typeof planStructuredImport>,
): AgentStructuredReason[] {
  return result.errors.map((error) => error.reason);
}

describe("plan keys", () => {
  it("prefixes the kind and builds dependency keys from both ends and type", () => {
    expect(structuredKey("ticket", "t1")).toBe("ticket:t1");
    expect(structuredKey("project", "main")).toBe("project:main");
    expect(dependencyKey("m1", "m2", "blocks")).toBe("dependency:m1>m2:blocks");
  });
});

const hierarchy = manifestOf(
  [
    projectSource(),
    ticketSource("s1", "subtask"),
    ticketSource("t1", "task"),
    ticketSource("e1", "epic"),
    ticketSource("i1", "initiative"),
    milestoneSource("m2"),
    milestoneSource("m1"),
  ],
  {
    links: [
      { type: "parent", from: "s1", to: "t1" },
      { type: "parent", from: "t1", to: "e1" },
      { type: "parent", from: "e1", to: "i1" },
      { type: "dependency", from: "m1", to: "m2", linkType: "blocks" },
    ],
  },
);

describe("planStructuredImport ordering", () => {
  it("lists milestones, then tickets parents first, then dependencies", () => {
    const result = planStructuredImport(hierarchy);
    expect(result.errors).toEqual([]);
    expect(result.steps.map((step) => step.key)).toEqual([
      "milestone:m2",
      "milestone:m1",
      "ticket:i1",
      "ticket:e1",
      "ticket:t1",
      "ticket:s1",
      "dependency:m1>m2:blocks",
    ]);
  });

  it("keeps the manifest order between tickets of the same depth", () => {
    const result = planStructuredImport(
      manifestOf([
        projectSource(),
        ticketSource("b"),
        ticketSource("a"),
        ticketSource("c"),
      ]),
    );
    expect(result.steps.map((step) => step.name)).toEqual(["b", "a", "c"]);
  });

  it("describes each step with project, name and trimmed label", () => {
    const result = planStructuredImport(
      manifestOf([
        projectSource(),
        ticketSource("t1", "task", { title: "  Padded title  " }),
        milestoneSource("m1", { name: " Beta " }),
      ]),
    );
    expect(result.steps).toEqual([
      {
        kind: "milestone",
        key: "milestone:m1",
        name: "m1",
        project: "main",
        label: "Beta",
      },
      {
        kind: "ticket",
        key: "ticket:t1",
        name: "t1",
        project: "main",
        label: "Padded title",
      },
    ]);
  });

  it("describes a dependency step with its ends and type", () => {
    const [step] = planStructuredImport(hierarchy).steps.slice(-1);
    expect(step).toEqual({
      kind: "dependency",
      key: "dependency:m1>m2:blocks",
      name: "m1",
      from: "m1",
      to: "m2",
      linkType: "blocks",
      project: "main",
      label: "m1 blocks m2",
    });
  });
});

describe("planStructuredImport edges", () => {
  it("exposes parents, milestones and edges for the later stages", () => {
    const result = planStructuredImport(
      manifestOf(
        [
          projectSource(),
          ticketSource("e1", "epic"),
          ticketSource("t1", "task"),
          milestoneSource("m1"),
        ],
        {
          links: [
            { type: "parent", from: "t1", to: "e1" },
            { type: "milestone", from: "t1", to: "m1" },
          ],
        },
      ),
    );
    expect(result.parents).toEqual(new Map([["t1", "e1"]]));
    expect(result.milestones).toEqual(new Map([["t1", "m1"]]));
    expect(result.edges).toEqual([
      { type: "parent", from: "ticket:t1", to: "ticket:e1" },
      { type: "milestone", from: "ticket:t1", to: "milestone:m1" },
    ]);
  });

  it("is deterministic for the same manifest", () => {
    expect(planStructuredImport(hierarchy)).toEqual(
      planStructuredImport(hierarchy),
    );
  });
});

describe("planStructuredImport source errors", () => {
  it("reports a key that cannot be a plan key", () => {
    const result = planStructuredImport(
      manifestOf([projectSource(), ticketSource("bad key")]),
    );
    expect(result.errors).toEqual([
      {
        code: "INVALID_REQUEST",
        reason: "invalid_key",
        keys: ["ticket:bad key"],
      },
    ]);
    expect(result.steps).toEqual([]);
  });

  it("reports a repeated key once and keeps the first source", () => {
    const result = planStructuredImport(
      manifestOf([
        projectSource(),
        ticketSource("t1", "task", { title: "First" }),
        ticketSource("t1", "task", { title: "Second" }),
      ]),
    );
    expect(reasons(result)).toEqual(["duplicate_key"]);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ label: "First" });
  });

  it("allows the same key for a ticket and a milestone", () => {
    const result = planStructuredImport(
      manifestOf([
        projectSource(),
        ticketSource("same"),
        milestoneSource("same"),
      ]),
    );
    expect(result.errors).toEqual([]);
    expect(result.steps).toHaveLength(2);
  });

  it("names a missing or unknown project on the object", () => {
    const result = planStructuredImport(
      manifestOf([
        projectSource(),
        ticketSource("t1", "task", { project: "" }),
        milestoneSource("m1", { project: "elsewhere" }),
      ]),
    );
    expect(result.errors).toEqual([
      {
        code: "INVALID_REQUEST",
        reason: "project_required",
        keys: ["ticket:t1"],
      },
      {
        code: "INVALID_REQUEST",
        reason: "unknown_project",
        keys: ["milestone:m1"],
      },
    ]);
  });
});

describe("planStructuredImport field errors", () => {
  it.each([
    ["an empty title", { title: "" }],
    ["a blank title", { title: "   " }],
    ["a title over 200 characters", { title: "t".repeat(201) }],
    [
      "a description over 65536 characters",
      { description: "d".repeat(65_537) },
    ],
  ])("applies the ticket field rules for %s", (_, fields) => {
    const result = planStructuredImport(
      manifestOf([projectSource(), ticketSource("t1", "task", fields)]),
    );
    expect(result.errors).toEqual([
      { code: "INVALID_REQUEST", reason: "invalid_field", keys: ["ticket:t1"] },
    ]);
  });

  it("accepts the largest valid title and description", () => {
    const result = planStructuredImport(
      manifestOf([
        projectSource(),
        ticketSource("t1", "task", {
          title: "t".repeat(200),
          description: "d".repeat(65_536),
        }),
      ]),
    );
    expect(result.errors).toEqual([]);
  });

  it.each([
    ["a blank name", { name: "  " }],
    ["a name over 200 characters", { name: "n".repeat(201) }],
    ["a start date in another format", { startAt: "2026/11/01" }],
    ["a due date with a time", { dueAt: "2026-11-01T10:00:00Z" }],
    [
      "a due date before the start",
      { startAt: "2026-12-01", dueAt: "2026-11-01" },
    ],
  ])("applies the milestone field rules for %s", (_, fields) => {
    const result = planStructuredImport(
      manifestOf([projectSource(), milestoneSource("m1", fields)]),
    );
    expect(result.errors).toEqual([
      {
        code: "INVALID_REQUEST",
        reason: "invalid_field",
        keys: ["milestone:m1"],
      },
    ]);
  });
});
