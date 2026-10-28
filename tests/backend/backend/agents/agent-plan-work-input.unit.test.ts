import { expect, it } from "vitest";

import {
  readCompletionGate,
  readPlanWorkRecord,
  readPlanWorkView,
} from "@/backend/agents/AgentPlanWorkInput";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

const RECORD = {
  revision: 1,
  requirementsHash: "r",
  contentHash: "c",
  scopeHash: "s",
  scope: [{ itemId: "i", relevant: true, reason: "" }],
  note: "Checked",
  proofs: [{ itemId: "i", evidence: "test passes" }],
  checks: [{ name: "lint", command: "pnpm lint", exitCode: 0, evidence: "ok" }],
  confirmed: true,
};

const VIEW = {
  runId: "run",
  stepId: "step",
  attemptId: "attempt",
  ticketId: "t",
  ticketKey: "K-1",
  statusKey: "open",
  requirementsHash: "r",
  contentHash: "c",
  requiredChecks: ["lint"],
  items: [
    {
      id: "i",
      text: "Item",
      checked: false,
      source: "criteria",
      order: 0,
      depth: 0,
      parentId: null,
    },
  ],
  record: RECORD,
  issues: [],
};

it("reads a work view with its stored record", () => {
  expect(readPlanWorkView(VIEW)).toEqual(VIEW);
  expect(() => readPlanWorkView({ ...VIEW, ticketKey: " " })).toThrow();
});

it("reads a stored work record with the constraints of new input", () => {
  expect(readPlanWorkRecord(RECORD)).toEqual(RECORD);
  expect(() => readPlanWorkRecord({ ...RECORD, revision: 0 })).toThrow();
});

it("reads a completion gate and keeps an absent one absent", () => {
  expect(readCompletionGate(undefined)).toBeUndefined();
  expect(readCompletionGate({ version: 1, requiredChecks: ["lint"] })).toEqual({
    version: 1,
    requiredChecks: ["lint"],
  });
  expect(() =>
    readCompletionGate({ version: 1, requiredChecks: ["lint", "lint"] }),
  ).toThrow(AgentOperationError);
});
