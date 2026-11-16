import { Readable } from "node:stream";

import { expect, it, vi } from "vitest";

import { AgentSimulator } from "@/backend/agents/simulation/AgentSimulator";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentSimulatorDependencies } from "@/backend/agents/simulation/AgentSimulator";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";

const INPUT = partial<AgentPlanExecutionInput>({
  userId: "user",
  agent: { connection: { id: "pages-simulation" } },
  resourceContext: { runId: "run", stepId: "step" },
});

it("reads local asset bytes and stores the derived result", async () => {
  const describe = vi.fn(async () => ({ kind: "file", projectId: "project" }));
  const storeResult = vi.fn(async () => ({
    fileName: "ergebnis-input.txt",
    assetId: "result",
  }));
  const beforeStart = vi.fn(async () => {});
  const simulator = new AgentSimulator(
    partial<AgentSimulatorDependencies>({
      mode: { scenario: "ok" },
      assets: { describe, storeResult },
    }),
  );
  const answer = await simulator.run(
    {
      ...INPUT,
      beforeStart,
      readTicketAssets: async () => [
        partial({
          asset: { source: "plan", id: "asset" },
          fileName: "input.txt",
          bytes: Buffer.from("content"),
          original: { mimeType: "text/plain", size: 7 },
        }),
      ],
    },
    new AbortController().signal,
  );
  expect(beforeStart).toHaveBeenCalledOnce();
  expect(answer).toContain("ergebnis-input.txt");
  expect(storeResult).toHaveBeenCalledWith("user", {
    projectId: "project",
    fileName: "ergebnis-input.txt",
    bytes: Buffer.from("content"),
    origin: { runId: "run", stepId: "step", sourceAssetId: "asset" },
  });
});

it("redeems remote references without exposing local paths", async () => {
  const issue = vi.fn(async () => "reference");
  const redeem = vi.fn(async () => ({
    fileName: "remote.txt",
    mediaType: "text/plain",
    size: 3,
    stream: Readable.from([Buffer.from("abc")]),
  }));
  const simulator = new AgentSimulator(
    partial<AgentSimulatorDependencies>({
      mode: { scenario: "ok" },
      assets: { describe: async () => null },
      references: { issue, redeem },
    }),
  );
  const input = partial<AgentPlanExecutionInput>({
    ...INPUT,
    agent: { connection: { id: "pages-simulation-remote" } },
    ticketInputs: [
      {
        owner: "asset",
        ticket: { title: "Ticket", assets: [{ id: "asset", source: "plan" }] },
        originals: { "plan:asset": "digest" },
      },
    ],
  });
  expect(await simulator.run(input, new AbortController().signal)).toContain(
    "remote.txt",
  );
  expect(issue).toHaveBeenCalledWith("user", {
    assetId: "asset",
    digest: "digest",
    runId: "run",
    stepId: "step",
  });
  expect(redeem).toHaveBeenCalledWith("reference");
});

it("reports a deliberately defective item and honors cancellation", async () => {
  const simulator = new AgentSimulator(
    partial<AgentSimulatorDependencies>({ mode: { scenario: "item_failed" } }),
  );
  const input = partial<AgentPlanExecutionInput>({
    ...INPUT,
    readTicketAssets: async () => [
      partial({
        asset: { id: "asset" },
        fileName: "defekt.txt",
        bytes: Buffer.from("x"),
      }),
    ],
  });
  await expect(
    simulator.run(input, new AbortController().signal),
  ).rejects.toMatchObject({ code: "plan_simulation_item_failed" });
  const controller = new AbortController();
  controller.abort();
  await expect(simulator.run(INPUT, controller.signal)).rejects.toThrow();
});
