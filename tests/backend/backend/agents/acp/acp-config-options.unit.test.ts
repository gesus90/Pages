import { expect, it } from "vitest";

import { findAcpSelectOption } from "@/backend/agents/acp/AcpConfigOptions";

import type { SessionConfigOption } from "@agentclientprotocol/sdk";

const OPTIONS: SessionConfigOption[] = [
  {
    id: "thinking",
    name: "Thinking",
    type: "boolean",
    currentValue: true,
  },
  {
    id: "mode",
    name: "Mode",
    type: "select",
    currentValue: "ask",
    options: [{ value: "ask", name: "Ask" }],
  },
  {
    id: "model",
    name: "Model",
    type: "select",
    currentValue: "b",
    options: [
      { group: "base", name: "Base", options: [{ value: "a", name: "A" }] },
      {
        group: "more",
        name: "More",
        options: [
          { value: "b", name: "B" },
          { value: "c", name: "C" },
        ],
      },
    ],
  },
];

it("flattens the values of every group of a select option", () => {
  expect(findAcpSelectOption(OPTIONS, "model")).toEqual({
    id: "model",
    currentValue: "b",
    values: ["a", "b", "c"],
  });
});

it("lists the plain values of an ungrouped select option", () => {
  expect(findAcpSelectOption(OPTIONS, "mode")).toEqual({
    id: "mode",
    currentValue: "ask",
    values: ["ask"],
  });
});

it("ignores options that are no select", () => {
  expect(findAcpSelectOption(OPTIONS, "thinking")).toBeNull();
});

it("returns null for an unknown option", () => {
  expect(findAcpSelectOption(OPTIONS, "effort")).toBeNull();
});
