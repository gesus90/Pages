import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { AgentTicketAssetSnapshots } from "@/backend/service/agents/AgentTicketAssetSnapshots";
import { AgentTicketParameterService } from "@/backend/service/agents/AgentTicketParameterService";
import { collectStream } from "@/backend/storage/StreamBytes";

import { TICKET } from "./page55-ticket-fixture";
import { PNG, ticketAssetWorld } from "./page60-ticket-assets-fixture";
import {
  STACK_TICKETS,
  finishedRun,
  flow,
  stackEngine,
  stackReport,
  stackRuntime,
} from "./page175-stack-fixture";

import type { AgentPlanNode } from "@/definition/AgentPlan";
import type { StackNodes } from "./page175-stack-fixture";

it("pins, opens and reads a 219735-byte snapshot on the real filesystem", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "page350-snapshot-"));
  try {
    const bytes = randomBytes(219_735);
    const store = new AgentTicketAssetSnapshots(directory);
    const snapshot = await store.pin({
      fileName: "image.png",
      bytes,
      original: {
        mimeType: "image/png",
        size: bytes.length,
        digest: createHash("sha256").update(bytes).digest("hex"),
      },
    });
    expect(
      await collectStream(await store.open(snapshot), bytes.length),
    ).toEqual(bytes);
    expect(await store.read(snapshot, bytes.length)).toMatchObject({ bytes });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function stackNodes(
  ticketIds: readonly string[],
  { agent }: StackNodes,
): readonly AgentPlanNode[] {
  return [
    { id: "start", type: "start", x: 0, y: 0 },
    { id: "end", type: "end", x: 900, y: 0 },
    {
      id: "stack",
      type: "stack",
      name: "Tickets",
      x: 0,
      y: 400,
      entries: ticketIds.map((taskId, index) => ({
        id: `entry-${index}`,
        type: "task",
        taskId,
      })),
    },
    {
      id: "loop",
      type: "loop",
      name: "Loop",
      x: 300,
      y: 0,
      steps: [
        {
          ...agent("work"),
          bindings: {
            aufgabe: {
              kind: "stack",
              stackId: "stack",
              output: "content",
            },
          },
        },
      ],
      edges: [],
      runs: 1,
      runsSource: "parameter",
      bindings: {
        runs: { kind: "stack", stackId: "stack", output: "count" },
      },
      countMode: "expected",
      sessionPolicy: "fresh",
      condition: null,
    },
  ];
}

it.each([["ticket-1", "ticket-2"], ["ticket-2"]])(
  "starts stack tickets %s with their own attachments",
  async (...ticketIds) => {
    const directory = await mkdtemp(path.join(tmpdir(), "page350-stack-"));
    try {
      const world = ticketAssetWorld("");
      world.tickets.clear();
      for (const ticket of STACK_TICKETS.slice(0, 2))
        world.tickets.set(ticket.id, { ...TICKET, ...ticket });
      vi.mocked(world.dependencies.tickets.list).mockImplementation(
        async (actor, id) => (id === "ticket-2" ? [{ id: "png" }] : []),
      );
      const tickets = new AgentTicketParameterService(
        world.context,
        world.assets,
        undefined,
        new AgentTicketAssetSnapshots(directory),
      );
      const runtime = stackRuntime({
        work: ticketIds.map(() => stackReport()),
      });
      const received: {
        ticketId: string;
        files: readonly string[];
        bytes: readonly Buffer[];
      }[] = [];
      const execution = {
        ...runtime.execution,
        open: async (...args: Parameters<typeof runtime.execution.open>) => {
          const input = args[0];
          await input.beforeStart?.();
          const files = (await input.readTicketAssets?.()) ?? [];
          received.push({
            ticketId: input.ticketInputs?.[0]?.ticket.id ?? "missing",
            files: files.map((file) => file.asset.id),
            bytes: files.map((file) => Buffer.from(file.bytes ?? [])),
          });
          return runtime.execution.open(...args);
        },
      };
      const plan = await stackEngine(execution, {
        tickets,
        nodes: (build) => stackNodes(ticketIds, build),
        edges: [
          flow("start", "loop"),
          flow("stack", "work"),
          flow("loop", "end"),
        ],
      });
      const assets = plan.snapshot.steps[0]?.prepared.parameters.assetInputs;
      expect(
        assets?.some(
          (asset) =>
            asset.parameter === "aufgabe" && asset.ticket.id === ticketIds[0],
        ),
      ).toBe(true);
      const started = await plan.engine.start("owner", plan.snapshot);
      const run = await finishedRun(plan, started.id);
      expect(run.status).toBe("succeeded");
      expect(received).toEqual(
        ticketIds.map((ticketId) => ({
          ticketId,
          files: ticketId === "ticket-2" ? ["png"] : [],
          bytes: ticketId === "ticket-2" ? [PNG] : [],
        })),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
