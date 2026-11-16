import { expect, it } from "vitest";

import { toPlanFlow } from "@/backend/service/mobile/plans/PicaMobilePlanFlow";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanActiveRun } from "@/backend/service/agents/AgentPlanActiveRuns";

it("maps only visible structure and counted progress from a run", () => {
  const entry = partial<AgentPlanActiveRun>({
    revision: 3,
    run: {
      id: "run",
      status: "running",
      startedAt: "2030-01-01",
      steps: [
        {
          id: "work",
          name: "Work result",
          status: "succeeded",
          activation: 2,
          output: "private",
        },
        {
          id: "decision",
          name: "Decision",
          status: "succeeded",
          branch: "true",
        },
        { id: "skipped", name: "Skipped", status: "skipped" },
      ],
    },
    stages: [
      [
        { id: "work", number: 2, isLoop: false },
        { id: "skipped", number: 3, isLoop: false },
      ],
    ],
    structure: [
      [{ id: "start", kind: "start", number: 1, name: null, isStep: false }],
      [
        { id: "work", kind: "agent", number: 2, name: null, isStep: true },
        {
          id: "decision",
          kind: "decision",
          number: 3,
          name: "Choose",
          isStep: false,
        },
        {
          id: "skipped",
          kind: "script",
          number: 4,
          name: "Skipped",
          isStep: true,
        },
      ],
    ],
  });
  const flow = toPlanFlow(entry);
  expect(flow).toMatchObject({
    revision: 3,
    progress: { done: 1, total: 1 },
    stages: [
      { nodes: [{ id: "start", kind: "start", counted: false }] },
      {
        nodes: [
          {
            id: "work",
            name: "Work result",
            status: "completed",
            pass: 2,
            counted: true,
          },
          { id: "decision", branch: "true", counted: false },
          { id: "skipped", status: "skipped", counted: false },
        ],
      },
    ],
  });
  expect(JSON.stringify(flow)).not.toContain("private");
});

it("reports a loop's started iterations and nested states", () => {
  const entry = partial<AgentPlanActiveRun>({
    run: {
      id: "run",
      status: "running",
      startedAt: "2030-01-01",
      steps: [{ id: "loop", name: "Loop", status: "running" }],
      loops: [
        {
          id: "loop",
          status: "running",
          completion: null,
          count: null,
          iterations: [
            {
              id: "i1",
              number: 1,
              status: "running",
              nodes: [{ id: "inside", name: "Inner", status: "running" }],
            },
          ],
        },
      ],
    },
    stages: [[{ id: "loop", number: 2, isLoop: true }]],
    structure: [
      [
        {
          id: "loop",
          kind: "loop",
          number: 2,
          name: "Loop",
          isStep: true,
          iteration: [
            [
              {
                id: "inside",
                kind: "agent",
                number: null,
                name: null,
                isStep: false,
              },
            ],
          ],
        },
      ],
    ],
  });
  expect(toPlanFlow(entry)).toMatchObject({
    stages: [
      {
        nodes: [
          {
            id: "loop",
            loop: {
              iterationCount: 1,
              stages: [
                { nodes: [{ id: "inside", name: "Inner", counted: false }] },
              ],
              iterations: [
                {
                  id: "i1",
                  number: 1,
                  nodes: [{ id: "inside", status: "running" }],
                },
              ],
            },
          },
        ],
      },
    ],
  });
});
