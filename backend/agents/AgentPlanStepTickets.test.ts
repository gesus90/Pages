import { expect, it } from "vitest";

import { readPlanStepTickets } from "@/backend/agents/AgentPlanStepTickets";

it("collects bound and listed tickets per node without duplicates", () => {
  expect(
    readPlanStepTickets({
      steps: [
        {
          step: { id: "s1" },
          taskIds: ["t1"],
          prepared: {
            parameters: {
              values: {
                none: null,
                ticket: { type: "ticket", ticketId: "t1" },
                other: { type: "ticket", ticketId: "t2" },
                text: { type: "text", text: "x" },
              },
            },
          },
        },
        { step: { id: "s2" } },
        { step: {} },
      ],
      remoteSteps: [
        {
          step: { id: "r1", type: "agent" },
          parameters: { tickets: { t3: {} } },
        },
        { step: { id: "r2", type: "agent" } },
        { step: { id: "r3", type: "script" } },
      ],
    }),
  ).toEqual({ s1: ["t1", "t2"], s2: [], r1: ["t3"], r2: [] });
});

it("reads nothing from a snapshot without steps", () => {
  expect(readPlanStepTickets(null)).toEqual({});
});
