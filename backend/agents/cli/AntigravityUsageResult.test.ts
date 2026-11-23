import { expect, it } from "vitest";

import {
  readAntigravityEnvelopeOutcome,
  readAntigravityUsage,
} from "@/backend/agents/cli/AntigravityUsageResult";

const RESET = "2030-01-01T10:00:00Z";
const RESET_ISO = "2030-01-01T10:00:00.000Z";

function bucket(window: unknown, remaining: unknown = 0.5): object {
  return {
    window,
    remaining_fraction: remaining,
    reset_time: RESET,
  };
}

function usage(payload: unknown): string {
  return JSON.stringify({
    status: "SUCCESS",
    num_turns: 0,
    command: { name: "usage", data: payload },
  });
}

it("reads the groups of a command envelope", () => {
  const output = usage({
    groups: [
      {
        display_name: "  Gemini  ",
        buckets: [bucket("5h"), bucket("weekly", 0.25)],
      },
    ],
  });

  expect(readAntigravityUsage(output)).toEqual([
    {
      name: "Gemini",
      windows: [
        { kind: "five_hour", remainingFraction: 0.5, resetsAt: RESET_ISO },
        { kind: "seven_day", remainingFraction: 0.25, resetsAt: RESET_ISO },
      ],
    },
  ]);
});

it("reads a bare object wrapped in a sentence and with alternative keys", () => {
  const output = `Here: ${JSON.stringify({
    quotaGroups: [
      {
        displayName: "Claude",
        windows: [
          {
            window: "seven_days",
            remainingFraction: 1,
            resetTime: RESET,
          },
        ],
      },
    ],
  })} done`;

  expect(readAntigravityUsage(output)).toEqual([
    {
      name: "Claude",
      windows: [
        { kind: "seven_day", remainingFraction: 1, resetsAt: RESET_ISO },
      ],
    },
  ]);
});

it("reads the groups key quota_groups and a name key", () => {
  const output = JSON.stringify({
    quota_groups: [{ name: "Other", buckets: [bucket("PT5H", 0)] }],
  });

  expect(readAntigravityUsage(output)).toEqual([
    {
      name: "Other",
      windows: [
        { kind: "five_hour", remainingFraction: 0, resetsAt: RESET_ISO },
      ],
    },
  ]);
});

it("reads a JSON response string of a success envelope", () => {
  const output = JSON.stringify({
    status: "success",
    response: JSON.stringify({
      groups: [{ name: "A", buckets: [bucket("5 hours")] }],
    }),
  });

  expect(readAntigravityUsage(output)).toHaveLength(1);
});

it("reads an object response of a success envelope", () => {
  const output = JSON.stringify({
    status: "SUCCESS",
    response: { groups: [{ name: "A", buckets: [bucket("5h")] }] },
  });

  expect(readAntigravityUsage(output)).toHaveLength(1);
});

it("returns an empty list for an empty group list", () => {
  expect(readAntigravityUsage(usage({ groups: [] }))).toEqual([]);
});

it("drops groups without a name or without windows", () => {
  const output = usage({
    groups: [
      { display_name: "  ", buckets: [bucket("5h")] },
      { name: 5, buckets: [bucket("5h")] },
      { name: "Empty", buckets: "none" },
      { name: "Unknown window", buckets: [bucket("month")] },
      "not an object",
    ],
  });

  expect(readAntigravityUsage(output)).toEqual([]);
});

it("skips windows that cannot be shown and keeps the first of a kind", () => {
  const output = usage({
    groups: [
      {
        name: "G",
        buckets: [
          { ...bucket("5h"), disabled: true },
          bucket("month"),
          bucket(undefined),
          bucket(18000),
          bucket("5h", "0.5"),
          bucket("5h", Number.NaN),
          bucket("5h", -0.1),
          bucket("5h", 1.1),
          bucket("5h", 0.4),
          bucket("five_hours", 0.1),
          { window: "7d", remaining_fraction: 0.3 },
        ],
      },
    ],
  });

  expect(readAntigravityUsage(output)).toEqual([
    {
      name: "G",
      windows: [
        { kind: "five_hour", remainingFraction: 0.5, resetsAt: RESET_ISO },
        { kind: "seven_day", remainingFraction: 0.3, resetsAt: null },
      ],
    },
  ]);
});

it("groups ungrouped buckets by name or bucket id", () => {
  const output = usage({
    buckets: [
      { ...bucket("5h", 0.2), display_name: "Model A" },
      { ...bucket("7d", 0.3), display_name: "Model A" },
      { ...bucket("5h", 0.9), display_name: "Model A" },
      { ...bucket("5h", 0.6), bucket_id: "model-b" },
      { ...bucket("5h", 0.6) },
      { ...bucket("month"), display_name: "Model C" },
    ],
  });

  expect(readAntigravityUsage(output)).toEqual([
    {
      name: "Model A",
      windows: [
        { kind: "five_hour", remainingFraction: 0.2, resetsAt: RESET_ISO },
        { kind: "seven_day", remainingFraction: 0.3, resetsAt: RESET_ISO },
      ],
    },
    {
      name: "model-b",
      windows: [
        { kind: "five_hour", remainingFraction: 0.6, resetsAt: RESET_ISO },
      ],
    },
  ]);
});

it("combines groups and ungrouped buckets", () => {
  const output = usage({
    groups: [{ name: "G", buckets: [bucket("5h")] }],
    buckets: [{ ...bucket("5h"), name: "Single" }],
  });

  expect(readAntigravityUsage(output).map((group) => group.name)).toEqual([
    "G",
    "Single",
  ]);
});

it("limits the length of a name", () => {
  const output = usage({
    groups: [{ name: "n".repeat(500), buckets: [bucket("5h")] }],
  });

  expect(readAntigravityUsage(output)[0].name).toHaveLength(200);
});

it("limits the number of groups", () => {
  const groups = Array.from({ length: 200 }, (entry, index) => ({
    name: `Group ${index}`,
    buckets: [bucket("5h")],
  }));

  expect(readAntigravityUsage(usage({ groups })).length).toBeLessThan(200);
});

it.each([
  ["not JSON", "no data"],
  ["an empty object", "{}"],
  ["a broken object in a sentence", "x { broken } y"],
  ["an envelope that is no success", JSON.stringify({ status: "ERROR" })],
  [
    "the data of another command",
    JSON.stringify({
      status: "SUCCESS",
      command: { name: "help", data: { groups: [] } },
    }),
  ],
  [
    "a command without a name",
    JSON.stringify({ status: "SUCCESS", command: "usage" }),
  ],
  [
    "a response without data",
    JSON.stringify({ status: "SUCCESS", response: "plain text" }),
  ],
  ["data without a group list", usage({ other: true })],
  ["a missing response", JSON.stringify({ status: "SUCCESS" })],
])("refuses %s", (label, output) => {
  expect(() => readAntigravityUsage(output)).toThrow(
    expect.objectContaining({ code: "cli_unexpected_output" }),
  );
});

it("reads status, turns and command of an envelope", () => {
  expect(
    readAntigravityEnvelopeOutcome(
      JSON.stringify({
        status: "SUCCESS",
        num_turns: 0,
        command: { name: "usage" },
      }),
    ),
  ).toEqual({ status: "SUCCESS", turns: 0, command: "usage" });
});

it("returns null for values that are not fixed words", () => {
  expect(
    readAntigravityEnvelopeOutcome(
      JSON.stringify({
        status: "some account text",
        num_turns: 1.5,
        command: { name: "Some Account" },
      }),
    ),
  ).toEqual({ status: null, turns: null, command: null });
});

it("returns null for values of the wrong type", () => {
  expect(
    readAntigravityEnvelopeOutcome(
      JSON.stringify({ status: 1, num_turns: "0", command: { name: 5 } }),
    ),
  ).toEqual({ status: null, turns: null, command: null });
});

it("returns null for output that is no envelope", () => {
  expect(readAntigravityEnvelopeOutcome("plain text")).toEqual({
    status: null,
    turns: null,
    command: null,
  });
});
