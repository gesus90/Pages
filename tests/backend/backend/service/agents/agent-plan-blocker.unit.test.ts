import { expect, it } from "vitest";

import {
  evaluatePlanAcceptance,
  explicitPlanBlocker,
} from "@/backend/service/agents/AgentPlanAcceptance";

import type { AgentPlanTicketStates } from "@/backend/service/agents/AgentPlanAcceptance";
import type { AgentPlanContract } from "@/definition/AgentPlanSession";

const REPORT =
  '```pages-report\n{"todos":[{"id":"T1","status":"done"}],"criteria":[{"id":"K1","met":true,"evidence":"logs"}],"decisions":[],"summary":"x"}\n```';

const CONTRACT: AgentPlanContract = {
  todos: [{ id: "T1", text: "todo", ticket: null }],
  criteria: [{ id: "K1", text: "criterion", ticket: null }],
  tickets: [],
};

const STATES: AgentPlanTicketStates = {
  checked: new Map(),
  unreadable: [],
  changed: [],
  isCheckRequired: false,
};

it.each([
  ["a whole JSON answer", '{"status":"blocked","reason":"x"}', "blocked"],
  ["a JSON fence", '```json\n{"status":"Failed"}\n```\nprose', "failed"],
  [
    "a first line before a report",
    `{"status":"blocked"}\n\n${REPORT}`,
    "blocked",
  ],
  ["indented output", `\n  {"status":"open"}\n${REPORT}`, "open"],
  [
    "an object over several lines before a report",
    `{\n  "status": "error",\n  "reason": "a } in \\" text"\n}\n\n${REPORT}`,
    "error",
  ],
  [
    "a leading fence with a later successful one",
    '```json\n{"status":"blocked"}\n```\ntext\n```json\n{"status":"done"}\n```',
    "blocked",
  ],
  [
    "a leading object with a later successful fence",
    '{"status":"incomplete"}\n```json\n{"status":"done"}\n```',
    "incomplete",
  ],
])("reads the blocker of %s", (_, output, status) => {
  expect(explicitPlanBlocker(output)).toBe(status);
});

it.each([
  ["a successful first line", `{"status":"done"}\n\n${REPORT}`],
  ["prose", "The status is blocked for now."],
  ["prose that starts with a brace", '{"status":"blocked" is what it said'],
  ["braces that never close", '{"status":"blocked"'],
  ["a blocker further down in the text", 'Result:\n{"status":"blocked"}'],
  ["a blocker in a nested object", '{"result":{"status":"blocked"}}'],
  ["a status that is no text", '{"status":1}'],
  ["a status that is not a blocker", '{"status":"blocked soon"}'],
  ["a list", '[{"status":"blocked"}]'],
  ["an empty answer", ""],
])("finds no blocker in %s", (_, output) => {
  expect(explicitPlanBlocker(output)).toBeNull();
});

it("keeps a complete report open behind a blocked result, also over several lines", () => {
  const acceptance = evaluatePlanAcceptance(
    CONTRACT,
    `{\n  "status": "blocked"\n}\n\n${REPORT}`,
    STATES,
  );

  expect(acceptance.verdict).toBe("open");
  expect(acceptance.issues).toEqual(["business_blocked"]);
});

it("accepts a complete report behind a successful result and behind prose", () => {
  expect(
    evaluatePlanAcceptance(CONTRACT, `{"status":"done"}\n\n${REPORT}`, STATES)
      .verdict,
  ).toBe("accepted");
  expect(
    evaluatePlanAcceptance(CONTRACT, `Nothing is blocked.\n${REPORT}`, STATES)
      .verdict,
  ).toBe("accepted");
});

it("never lets a done result stand in for a missing or open report", () => {
  expect(
    evaluatePlanAcceptance(CONTRACT, '{"status":"done"}', STATES).issues,
  ).toContain("report_missing");
  expect(
    evaluatePlanAcceptance(
      CONTRACT,
      `{"status":"done"}\n${REPORT.replace('"met":true', '"met":false')}`,
      STATES,
    ).issues,
  ).toEqual(["criterion_unmet:K1"]);
});
