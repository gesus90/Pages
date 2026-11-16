import { expect, it } from "vitest";

import { readAgentProfileInput } from "@/backend/service/agents/AgentProfileValidation";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

const PROFILE = {
  name: " Agent ",
  connectionId: " connection ",
  model: " model ",
  reasoningEffort: null,
  isActive: true,
  purposes: ["agent"],
  targets: [{ kind: "person", targetId: "user" }],
  configuration: emptyAgentConfiguration(),
  revision: 2,
};

it("normalizes a valid profile and deduplicates purposes", () => {
  expect(
    readAgentProfileInput({ ...PROFILE, purposes: ["agent", "agent"] }),
  ).toMatchObject({
    name: "Agent",
    connectionId: "connection",
    model: "model",
    purposes: ["agent"],
    revision: 2,
  });
});

it.each([
  { isActive: "yes" },
  { name: " " },
  { name: "x".repeat(81) },
  { connectionId: "" },
  { model: null },
  { reasoningEffort: "x".repeat(25) },
  { purposes: [] },
  { purposes: ["invalid"] },
  { purposes: ["agent", "agent", "agent"] },
  { revision: 0 },
  { revision: 1.5 },
  { revision: Number.MAX_SAFE_INTEGER + 1 },
])("rejects invalid profile input %j", (changes) => {
  expect(() => readAgentProfileInput({ ...PROFILE, ...changes })).toThrow();
});

it("checks the scope and active configuration before persistence", () => {
  expect(() => readAgentProfileInput({ ...PROFILE, targets: [] })).toThrow();
  expect(() =>
    readAgentProfileInput({
      ...PROFILE,
      configuration: { ...PROFILE.configuration, accessMode: "shared" },
    }),
  ).toThrow();
  expect(() =>
    readAgentProfileInput({
      ...PROFILE,
      configuration: { ...PROFILE.configuration, markdown: "{{text:missing}}" },
    }),
  ).toThrow();
  expect(
    readAgentProfileInput({ ...PROFILE, isActive: false, targets: [] }),
  ).toMatchObject({ isActive: false });
});
