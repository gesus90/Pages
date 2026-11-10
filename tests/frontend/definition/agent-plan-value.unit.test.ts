import { describe, expect, it } from "vitest";

import { planValueIssue } from "@/definition/AgentPlanValue";

import type { AgentPlanParameter } from "@/definition/AgentPlan";

function parameter(
  format: AgentPlanParameter["format"],
  value: AgentPlanParameter["value"],
): Pick<AgentPlanParameter, "format" | "value"> {
  return { format, value };
}

describe("checking a boolean parameter node", () => {
  it("accepts exactly the texts true and false", () => {
    expect(
      planValueIssue(parameter("boolean", { type: "text", text: "true" })),
    ).toBeNull();
    expect(
      planValueIssue(parameter("boolean", { type: "text", text: "false" })),
    ).toBeNull();
  });

  it("refuses any other text, even one that reads like a boolean", () => {
    for (const text of ["True", "yes", "1", " true", ""])
      expect(planValueIssue(parameter("boolean", { type: "text", text }))).toBe(
        "boolean",
      );
  });

  it("refuses a value that is not text", () => {
    expect(
      planValueIssue(parameter("boolean", { type: "ticket", ticketId: "t" })),
    ).toBe("boolean");
  });

  it("checks a number value for finiteness before the boolean format", () => {
    expect(
      planValueIssue(parameter("boolean", { type: "number", number: 1 })),
    ).toBeNull();
    expect(
      planValueIssue(
        parameter("boolean", { type: "number", number: Number.NaN }),
      ),
    ).toBe("number");
  });
});

describe("checking nested json numbers", () => {
  it("accepts finite numbers at any depth", () => {
    expect(
      planValueIssue(
        parameter("json", { type: "text", text: '{"a":{"b":[1,{"c":2.5}]}}' }),
      ),
    ).toBeNull();
  });

  it("accepts json null, which holds no number", () => {
    expect(
      planValueIssue(parameter("json", { type: "text", text: "null" })),
    ).toBeNull();
  });

  it("names the declared format when a nested number overflows", () => {
    expect(
      planValueIssue(
        parameter("json", { type: "text", text: '{"a":{"b":[1e999]}}' }),
      ),
    ).toBe("json");
  });
});
