import { describe, expect, it } from "vitest";

import { planStructuredImport } from "@/backend/service/agents/StructuredImportPlanner";

import {
  manifestOf,
  milestoneSource,
  projectSource,
  ticketSource,
  wikiSource,
} from "./structured-manifest-fixture";

import type {
  AgentStructuredIssue,
  AgentStructuredLink,
  AgentStructuredSource,
} from "@/definition/AgentStructuredImportManifest";

function errorsOf(
  sources: readonly AgentStructuredSource[],
  links: readonly AgentStructuredLink[],
): readonly AgentStructuredIssue[] {
  return planStructuredImport(manifestOf(sources, { links })).errors;
}

function issue(
  reason: AgentStructuredIssue["reason"],
  keys: readonly string[],
): AgentStructuredIssue {
  return { code: "INVALID_REQUEST", reason, keys };
}

describe("planStructuredImport links", () => {
  const base = [
    projectSource(),
    ticketSource("e1", "epic"),
    ticketSource("t1", "task"),
    milestoneSource("m1"),
    milestoneSource("m2"),
  ];

  it("reports a link to a source that does not exist", () => {
    expect(
      errorsOf(base, [{ type: "parent", from: "t1", to: "ghost" }]),
    ).toEqual([issue("missing_reference", ["ticket:t1", "ticket:ghost"])]);
    expect(
      errorsOf(base, [{ type: "milestone", from: "t1", to: "ghost" }]),
    ).toEqual([issue("missing_reference", ["ticket:t1", "milestone:ghost"])]);
  });

  it("looks parents up among tickets and milestones among milestones", () => {
    // `m1` is a milestone, so it cannot be the parent ticket of `t1`.
    expect(errorsOf(base, [{ type: "parent", from: "t1", to: "m1" }])).toEqual([
      issue("missing_reference", ["ticket:t1", "ticket:m1"]),
    ]);
  });

  it("reports a dependency of a milestone on itself", () => {
    expect(
      errorsOf(base, [
        { type: "dependency", from: "m1", to: "m1", linkType: "blocks" },
      ]),
    ).toEqual([issue("self_reference", ["milestone:m1", "milestone:m1"])]);
  });

  it("reports a ticket that is its own parent", () => {
    const errors = errorsOf(base, [{ type: "parent", from: "t1", to: "t1" }]);
    expect(errors).toEqual([
      issue("self_reference", ["ticket:t1", "ticket:t1"]),
    ]);
  });

  it("reports links between objects of different projects", () => {
    const sources = [
      projectSource("main"),
      projectSource("other", "project-2"),
      ticketSource("e1", "epic", { project: "main" }),
      ticketSource("t1", "task", { project: "other" }),
    ];
    expect(
      errorsOf(sources, [{ type: "parent", from: "t1", to: "e1" }]),
    ).toEqual([issue("project_mismatch", ["ticket:t1", "ticket:e1"])]);
  });

  it("does not add a mismatch error when one end has no project yet", () => {
    const sources = [
      projectSource("main"),
      projectSource("other", "project-2"),
      ticketSource("e1", "epic", { project: "main" }),
      ticketSource("t1", "task", { project: "" }),
    ];
    expect(
      errorsOf(sources, [{ type: "parent", from: "t1", to: "e1" }]),
    ).toEqual([issue("project_required", ["ticket:t1"])]);
  });

  it("reports a second parent and a second milestone of one ticket", () => {
    const errors = errorsOf(
      [...base, ticketSource("e2", "epic")],
      [
        { type: "parent", from: "t1", to: "e1" },
        { type: "parent", from: "t1", to: "e2" },
        { type: "milestone", from: "t1", to: "m1" },
        { type: "milestone", from: "t1", to: "m2" },
      ],
    );
    expect(errors).toEqual([
      issue("duplicate_link", ["ticket:t1", "ticket:e2"]),
      issue("duplicate_link", ["ticket:t1", "milestone:m2"]),
    ]);
  });

  it("allows many tickets under one parent and in one milestone", () => {
    const errors = errorsOf(
      [...base, ticketSource("t2", "task")],
      [
        { type: "parent", from: "t1", to: "e1" },
        { type: "parent", from: "t2", to: "e1" },
        { type: "milestone", from: "t1", to: "m1" },
        { type: "milestone", from: "t2", to: "m1" },
      ],
    );
    expect(errors).toEqual([]);
  });

  it("allows one dependency per pair of milestones, whatever the direction", () => {
    const errors = errorsOf(base, [
      { type: "dependency", from: "m1", to: "m2", linkType: "blocks" },
      { type: "dependency", from: "m1", to: "m2", linkType: "blocks" },
      { type: "dependency", from: "m2", to: "m1", linkType: "follows" },
    ]);
    expect(errors).toEqual([
      issue("duplicate_link", ["milestone:m1", "milestone:m2"]),
      issue("duplicate_link", ["milestone:m2", "milestone:m1"]),
    ]);
  });
});

describe("planStructuredImport hierarchy rules", () => {
  const types = [
    projectSource(),
    ticketSource("i1", "initiative"),
    ticketSource("e1", "epic"),
    ticketSource("t1", "task"),
    ticketSource("s1", "subtask"),
  ];

  it("accepts each type below the type that holds it", () => {
    const errors = errorsOf(types, [
      { type: "parent", from: "e1", to: "i1" },
      { type: "parent", from: "t1", to: "e1" },
      { type: "parent", from: "s1", to: "t1" },
    ]);
    expect(errors).toEqual([]);
  });

  it.each([
    ["a task below an initiative", "t1", "i1"],
    ["a subtask below an epic", "s1", "e1"],
    ["an epic below a task", "e1", "t1"],
    ["an initiative below an epic", "i1", "e1"],
  ])("refuses %s", (_, child, parent) => {
    const errors = errorsOf(types, [
      { type: "parent", from: child, to: parent },
    ]);
    // Only the subtask `s1` lacks a parent besides, which is reported on its own.
    expect(errors).toContainEqual(
      issue("parent_type", [`ticket:${child}`, `ticket:${parent}`]),
    );
    expect(errors.map((error) => error.reason)).not.toContain("cycle");
  });

  it("requires a parent for a subtask only", () => {
    const errors = errorsOf(types, []);
    expect(errors).toEqual([issue("parent_required", ["ticket:s1"])]);
  });
});

describe("planStructuredImport cycles", () => {
  it("reports a loop of tickets and still terminates with ordered steps", () => {
    const sources = [
      projectSource(),
      ticketSource("a", "task"),
      ticketSource("b", "task"),
    ];
    const result = planStructuredImport(
      manifestOf(sources, {
        links: [
          { type: "parent", from: "a", to: "b" },
          { type: "parent", from: "b", to: "a" },
        ],
      }),
    );
    expect(result.errors.map((error) => error.reason)).toContain("cycle");
    const cycle = result.errors.find((error) => error.reason === "cycle");
    expect([...(cycle?.keys ?? [])].sort()).toEqual(["ticket:a", "ticket:b"]);
    expect(result.steps.map((step) => step.key)).toEqual([
      "ticket:a",
      "ticket:b",
    ]);
  });

  it("reports a loop of milestone dependencies of one type", () => {
    const sources = [
      projectSource(),
      milestoneSource("m1"),
      milestoneSource("m2"),
      milestoneSource("m3"),
    ];
    const errors = errorsOf(sources, [
      { type: "dependency", from: "m1", to: "m2", linkType: "blocks" },
      { type: "dependency", from: "m2", to: "m3", linkType: "blocks" },
      { type: "dependency", from: "m3", to: "m1", linkType: "blocks" },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toBe("cycle");
    expect([...errors[0].keys].sort()).toEqual([
      "milestone:m1",
      "milestone:m2",
      "milestone:m3",
    ]);
  });

  it("does not report a chain of dependencies as a loop", () => {
    const sources = [
      projectSource(),
      milestoneSource("m1"),
      milestoneSource("m2"),
      milestoneSource("m3"),
    ];
    const errors = errorsOf(sources, [
      { type: "dependency", from: "m1", to: "m2", linkType: "blocks" },
      { type: "dependency", from: "m2", to: "m3", linkType: "blocks" },
    ]);
    expect(errors).toEqual([]);
  });

  it("does not treat symmetric relates_to links as loops", () => {
    const sources = [
      projectSource(),
      milestoneSource("m1"),
      milestoneSource("m2"),
      milestoneSource("m3"),
    ];
    const errors = errorsOf(sources, [
      { type: "dependency", from: "m1", to: "m2", linkType: "relates_to" },
      { type: "dependency", from: "m2", to: "m3", linkType: "relates_to" },
      { type: "dependency", from: "m3", to: "m1", linkType: "relates_to" },
    ]);
    expect(errors).toEqual([]);
  });
});

describe("planStructuredImport wiki target", () => {
  const pages = [wikiSource("docs/a.md")];

  it("requires a target when wiki pages are present", () => {
    const result = planStructuredImport(
      manifestOf([projectSource(), ...pages], { wiki: null }),
    );
    expect(result.errors).toEqual([issue("wiki_target_required", ["wiki"])]);
  });

  it("accepts a target in a named project", () => {
    const result = planStructuredImport(
      manifestOf([projectSource(), ...pages], {
        wiki: { project: "main", parentId: null },
      }),
    );
    expect(result.errors).toEqual([]);
  });

  it.each([
    ["no project", "", "project_required"],
    [
      "a project that is not part of the manifest",
      "elsewhere",
      "unknown_project",
    ],
  ] as const)("reports a target with %s", (_, project, reason) => {
    const result = planStructuredImport(
      manifestOf([projectSource(), ...pages], {
        wiki: { project, parentId: null },
      }),
    );
    expect(result.errors).toEqual([issue(reason, ["wiki"])]);
  });

  it("needs no target without wiki pages", () => {
    expect(planStructuredImport(manifestOf([projectSource()])).errors).toEqual(
      [],
    );
  });
});
