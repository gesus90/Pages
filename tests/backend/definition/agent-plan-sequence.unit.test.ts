import { describe, expect, it } from "vitest";

import {
  inPlanSequence,
  planFlowSequence,
  planRunSequence,
} from "@/definition/AgentPlanSequence";
import { planValueIssue } from "@/definition/AgentPlanValue";

import {
  agent,
  boundary,
  edge,
  groupOf,
  planOf,
  script,
} from "./plan-fixtures";

import type { AgentPlanParameter } from "@/definition/AgentPlan";

describe("the order of a plan flow", () => {
  it("runs from start to end, one level after the other, and ties by id", () => {
    const plan = planOf(
      [
        boundary("end", "end"),
        agent("c"),
        boundary("start", "start"),
        agent("b"),
        agent("a"),
        script("d"),
      ],
      [
        edge("start", "a"),
        edge("start", "b"),
        edge("a", "c"),
        edge("b", "c"),
        edge("c", "d"),
        edge("d", "end"),
      ],
    );

    expect(planFlowSequence(plan)).toEqual({
      order: ["start", "a", "b", "c", "d", "end"],
      gaps: [],
    });
  });

  it("places a node behind its longest path", () => {
    const plan = planOf(
      [boundary("start", "start"), agent("a"), agent("b"), agent("c")],
      [edge("start", "a"), edge("a", "b"), edge("b", "c"), edge("start", "c")],
    );

    expect(planFlowSequence(plan).order).toEqual(["start", "a", "b", "c"]);
  });

  it("reports nodes the flow never reaches and nodes inside a cycle", () => {
    const plan = planOf(
      [
        boundary("start", "start"),
        agent("a"),
        agent("loopA"),
        agent("loopB"),
        agent("island"),
        agent("alsoLost"),
      ],
      [
        edge("start", "a"),
        edge("a", "loopA"),
        edge("loopA", "loopB"),
        edge("loopB", "loopA"),
        edge("island", "alsoLost"),
      ],
    );

    expect(planFlowSequence(plan)).toEqual({
      order: ["start", "a"],
      gaps: [
        { id: "alsoLost", reason: "unreachable" },
        { id: "island", reason: "unreachable" },
        { id: "loopA", reason: "cycle" },
        { id: "loopB", reason: "cycle" },
      ],
    });
  });
});

describe("edges and nodes the flow ignores", () => {
  it("ignores edges into the start, out of the end, to unknown nodes and repeated edges", () => {
    const plan = planOf(
      [boundary("start", "start"), agent("a"), boundary("end", "end")],
      [
        edge("a", "start"),
        edge("end", "a"),
        edge("start", "ghost"),
        edge("ghost", "a"),
        edge("start", "a"),
        edge("start", "a"),
        edge("a", "end"),
      ],
    );

    expect(planFlowSequence(plan)).toEqual({
      order: ["start", "a", "end"],
      gaps: [],
    });
  });

  it("treats a plan without a start as entirely unreachable and values nodes as no flow", () => {
    const plan = planOf(
      [
        agent("a"),
        {
          id: "p",
          type: "parameter",
          name: "p",
          format: "string",
          value: { type: "text", text: "" },
          x: 0,
          y: 0,
        },
      ],
      [],
    );

    expect(planFlowSequence(plan)).toEqual({
      order: [],
      gaps: [{ id: "a", reason: "unreachable" }],
    });
  });

  it("flows through the members of a group in a run", () => {
    const plan = planOf(
      [
        boundary("start", "start"),
        groupOf("g", [agent("a"), agent("b")]),
        boundary("end", "end"),
      ],
      [edge("start", "a"), edge("b", "end")],
    );

    expect(planRunSequence(plan)).toEqual({
      order: ["start", "a", "b", "end"],
      gaps: [],
    });
  });
});

describe("sorting entries into the sequence", () => {
  it("orders entries by the sequence and keeps the rest behind them in their own order", () => {
    const entries = [{ id: "x" }, { id: "b" }, { id: "y" }, { id: "a" }];

    expect(
      inPlanSequence(entries, ["a", "b"]).map((entry) => entry.id),
    ).toEqual(["a", "b", "x", "y"]);
    expect(inPlanSequence(entries, []).map((entry) => entry.id)).toEqual([
      "x",
      "b",
      "y",
      "a",
    ]);
  });
});

function parameter(
  format: AgentPlanParameter["format"],
  value: AgentPlanParameter["value"],
): Pick<AgentPlanParameter, "format" | "value"> {
  return { format, value };
}

describe("checking the value of a parameter node", () => {
  it("checks numbers for finiteness", () => {
    expect(
      planValueIssue(parameter("number", { type: "number", number: 4 })),
    ).toBeNull();
    expect(
      planValueIssue(
        parameter("number", { type: "number", number: Number.NaN }),
      ),
    ).toBe("number");
    expect(
      planValueIssue(
        parameter("string", {
          type: "number",
          number: Number.POSITIVE_INFINITY,
        }),
      ),
    ).toBe("number");
  });

  it("accepts any text for a string and any other value type", () => {
    expect(
      planValueIssue(parameter("string", { type: "text", text: "{not json" })),
    ).toBeNull();
    expect(
      planValueIssue(parameter("json", { type: "ticket", ticketId: "t" })),
    ).toBeNull();
  });

  it("parses json and number texts", () => {
    expect(
      planValueIssue(parameter("json", { type: "text", text: '{"a":[1,2]}' })),
    ).toBeNull();
    expect(
      planValueIssue(parameter("json", { type: "text", text: "{broken" })),
    ).toBe("json");
    expect(
      planValueIssue(parameter("json", { type: "text", text: "1e999" })),
    ).toBe("json");
    expect(
      planValueIssue(
        parameter("json", { type: "text", text: '{"a":[1,1e999]}' }),
      ),
    ).toBe("json");
    expect(
      planValueIssue(parameter("number", { type: "text", text: "12.5" })),
    ).toBeNull();
    expect(
      planValueIssue(parameter("number", { type: "text", text: '"12"' })),
    ).toBe("number");
    expect(
      planValueIssue(parameter("number", { type: "text", text: "nope" })),
    ).toBe("number");
    expect(
      planValueIssue(parameter("number", { type: "text", text: "1e999" })),
    ).toBe("number");
  });
});
