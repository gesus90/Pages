import { describe, expect, it } from "vitest";

import {
  readPlanStackHandover,
  readPlanStackRuns,
} from "@/backend/agents/AgentPlanStackRunInput";
import { AgentError } from "@/backend/error/AgentErrors";

describe("readPlanStackHandover", () => {
  it("reads an empty and a delivered handover", () => {
    expect(
      readPlanStackHandover({ entryId: null, position: 0, total: 2 }),
    ).toEqual({ entryId: null, position: 0, total: 2 });
    expect(
      readPlanStackHandover({ entryId: " e ", position: 1, total: 2 }),
    ).toEqual({ entryId: "e", position: 1, total: 2 });
  });

  it("rejects bad counts and positions", () => {
    expect(() =>
      readPlanStackHandover({ entryId: null, position: 3, total: 2 }),
    ).toThrow(AgentError);
    expect(() =>
      readPlanStackHandover({ entryId: null, position: 0, total: -1 }),
    ).toThrow(AgentError);
    expect(() =>
      readPlanStackHandover({ entryId: null, position: 0.5, total: 2 }),
    ).toThrow(AgentError);
    expect(() => readPlanStackHandover({})).toThrow(AgentError);
  });

  it("rejects a null entry beyond the start and an entry without position", () => {
    expect(() =>
      readPlanStackHandover({ entryId: null, position: 1, total: 2 }),
    ).toThrow(AgentError);
    expect(() =>
      readPlanStackHandover({ entryId: "e", position: 0, total: 2 }),
    ).toThrow(AgentError);
  });
});

function stack(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "s",
    name: "Stack",
    total: 2,
    deliveries: [
      { entryId: "e", position: 1, loopId: null, iteration: null, at: "t" },
      { entryId: "e2", position: 2, loopId: "l", iteration: 3, at: "t" },
    ],
    emptyTriggers: 0,
    last: "entry",
    ...overrides,
  };
}

describe("readPlanStackRuns", () => {
  it("reads stacks with deliveries", () => {
    const [run] = readPlanStackRuns([stack()]);

    expect(run.deliveries[1]).toEqual({
      entryId: "e2",
      position: 2,
      loopId: "l",
      iteration: 3,
      at: "t",
    });
    expect(readPlanStackRuns([stack({ last: null })])[0].last).toBeNull();
    expect(readPlanStackRuns([stack({ last: "empty" })])[0].last).toBe("empty");
  });

  it("rejects a non list and too many stacks", () => {
    expect(() => readPlanStackRuns({})).toThrow(AgentError);
    expect(() => readPlanStackRuns(Array(101).fill(stack()))).toThrow(
      AgentError,
    );
  });

  it.each([
    { total: -1 },
    { emptyTriggers: "1" },
    { emptyTriggers: 1.5 },
    { emptyTriggers: -1 },
    { last: "other" },
    { deliveries: "x" },
    { total: 1 },
  ])("rejects a malformed stack %j", (overrides) => {
    expect(() => readPlanStackRuns([stack(overrides)])).toThrow(AgentError);
  });

  it.each([
    { position: 0 },
    { position: 1.5 },
    { iteration: "1" },
    { iteration: 1.5 },
    { iteration: 0 },
  ])("rejects a malformed delivery %j", (overrides) => {
    const delivery = {
      entryId: "e",
      position: 1,
      loopId: null,
      iteration: null,
      at: "t",
      ...overrides,
    };

    expect(() =>
      readPlanStackRuns([stack({ deliveries: [delivery] })]),
    ).toThrow(AgentError);
  });
});
