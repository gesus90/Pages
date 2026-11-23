import { expect, it } from "vitest";

import { findAcpSelectOption } from "@/backend/agents/acp/AcpConfigOptions";

import type {
  SessionConfigOption,
  SessionConfigSelectOptions,
} from "@agentclientprotocol/sdk";

const MODEL_VALUES: SessionConfigSelectOptions = [
  { group: "g1", name: "G1", options: [{ value: "m1", name: "M1" }] },
  { group: "g2", name: "G2", options: [{ value: "m2", name: "M2" }] },
];

const OPTIONS: readonly SessionConfigOption[] = [
  {
    id: "mode",
    name: "Mode",
    type: "select",
    currentValue: "a",
    options: [{ value: "a", name: "A" }],
  },
  {
    id: "model",
    name: "Model",
    type: "boolean",
    currentValue: true,
  },
  {
    id: "model",
    name: "Model",
    type: "select",
    currentValue: "m1",
    options: MODEL_VALUES,
  },
];

it("reads a select with plain values", () => {
  expect(findAcpSelectOption(OPTIONS, "mode")?.values).toEqual(["a"]);
});

it("reads a select with grouped values", () => {
  expect(findAcpSelectOption(OPTIONS, "model")).toEqual({
    id: "model",
    currentValue: "m1",
    values: ["m1", "m2"],
  });
});

it("skips other identifiers and non-select options", () => {
  expect(findAcpSelectOption(OPTIONS.slice(0, 2), "model")).toBeNull();
});
