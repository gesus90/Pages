import { expect, it } from "vitest";

import {
  isAcpSteeringSupported,
  readAcpSteerOutcome,
} from "@/backend/agents/acp/AcpChat";

it.each(["injected", "startedNewTurn", "promptRequired"])(
  "reads the documented steering outcome %s",
  (outcome) => {
    expect(readAcpSteerOutcome({ outcome })).toBe(outcome);
  },
);

it.each([
  ["an undocumented outcome", { outcome: "queued" }],
  ["a missing outcome", {}],
  ["null", null],
  ["text", "injected"],
])("treats %s as a failed steering request", (_, response) => {
  expect(readAcpSteerOutcome(response)).toBe("failed");
});

it("detects announced steering support", () => {
  expect(isAcpSteeringSupported({ steering: { supported: true } })).toBe(true);
});

it.each([
  ["no metadata", undefined],
  ["null metadata", null],
  ["no steering entry", {}],
  ["a null steering entry", { steering: null }],
  ["a text steering entry", { steering: "yes" }],
  ["an unsupported steering entry", { steering: { supported: "true" } }],
])("does not steer with %s", (_, meta) => {
  expect(isAcpSteeringSupported(meta)).toBe(false);
});
