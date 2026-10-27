import { expect, it, vi } from "vitest";

import { readPlanStepTickets } from "@/backend/agents/AgentPlanStepTickets";
import { readPlanProgress } from "@/backend/agents/AgentPlanProgressInput";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { withPlanProgress } from "@/backend/service/agents/AgentPlanProgressView";
import {
  buildPlanContract,
  renderPlanAssignment,
} from "@/backend/service/agents/AgentPlanContract";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanProgress } from "@/definition/AgentPlanProgress";
import type { Database } from "@/backend/database/Database";

import {
  progressRun,
  progressSession,
  progressStep,
  progressTicket,
} from "./page162-progress-fixture";

function observation(run: AgentPlanRun): AgentPlanProgress {
  const progress = run.steps[0]?.progress;
  if (!progress) throw new Error("Missing progress observation");
  return progress;
}

it("observes a genuinely empty remote ticket before a session or checklist exists", async () => {
  const checklist = vi.fn(async () => progressTicket());
  const run = await withPlanProgress(progressRun(), {
    projectId: "project",
    tasks: { checklist },
    stepTickets: { agent: ["ticket"] },
  });
  expect(checklist).toHaveBeenCalledWith("executor", "project", "ticket");
  expect(run.steps[0]?.progress).toMatchObject({
    source: "live",
    availability: "observed",
    todos: [],
    tickets: [{ id: "ticket", key: "SYN-ticket" }],
    scope: { runId: "run", stepId: "agent", attemptId: null },
  });
});

it("reads added, checked, edited and removed entries afresh with real IDs and content versions", async () => {
  let ticket = progressTicket("- [ ] Implement the ticket\n");
  const context = {
    projectId: "project",
    tasks: { checklist: vi.fn(async () => ticket) },
    stepTickets: { agent: ["ticket"] },
  };
  const initial = observation(await withPlanProgress(progressRun(), context));
  ticket = progressTicket(
    "- [x] Implement the ticket\n- [ ] Check changed behavior\n",
  );
  const second = observation(await withPlanProgress(progressRun(), context));
  expect(second.todos.map((item) => item.status)).toEqual(["done", "open"]);
  expect(second.todos[0]?.id).toBe(initial.todos[0]?.id);
  expect(second.tickets?.[0]?.contentHash).not.toBe(
    initial.tickets?.[0]?.contentHash,
  );
  ticket = progressTicket("- [ ] Check revised behavior\n");
  const final = observation(await withPlanProgress(progressRun(), context));
  expect(final.todos).toHaveLength(1);
  expect(final.todos[0]?.id).not.toBe(second.todos[1]?.id);
  expect(initial.todos[0]?.status).toBe("open");
});

it("does not invent activity from the first open entry or a matching plain title", async () => {
  const ticket = progressTicket(
    "- [ ] Implement behavior\n- [ ] Verify behavior",
  );
  const first = ticket.checklist.items[0];
  const second = ticket.checklist.items[1];
  if (!first || !second) throw new Error("Missing fixture checklist");
  const context = {
    projectId: "project",
    tasks: { checklist: async () => ticket },
    stepTickets: { agent: ["ticket"] },
  };
  const plain = progressStep({ session: progressSession([first.text]) });
  const observed = await withPlanProgress(progressRun([plain]), context);
  expect(observed.steps[0]?.progress?.todos.map((item) => item.status)).toEqual(
    ["open", "open"],
  );
  const explicit = progressStep({
    session: progressSession([
      `${ticket.key}#${first.id}`,
      `${ticket.key}#${second.id} Verify behavior`,
    ]),
  });
  expect(
    (
      await withPlanProgress(progressRun([explicit]), context)
    ).steps[0]?.progress?.todos.map((item) => item.status),
  ).toEqual(["active", "active"]);
  expect(
    (
      await withPlanProgress(
        progressRun([{ ...explicit, status: "paused" }]),
        context,
      )
    ).steps[0]?.progress?.todos.map((item) => item.status),
  ).toEqual(["open", "open"]);
});

it("distinguishes unavailable access from an empty list and recovers without relying on a live event", async () => {
  const checklist = vi.fn(async () => progressTicket("- [x] Completed work"));
  checklist.mockRejectedValueOnce(new Error("No ticket read permission"));
  const context = {
    projectId: "project",
    tasks: { checklist },
    stepTickets: { agent: ["ticket"] },
  };
  expect(
    (await withPlanProgress(progressRun(), context)).steps[0]?.progress,
  ).toMatchObject({ availability: "unavailable", todos: [] });
  expect(
    (await withPlanProgress(progressRun(), context)).steps[0]?.progress,
  ).toMatchObject({ availability: "observed", todos: [{ status: "done" }] });
});

it("keeps node, run and attempt scopes while deduplicating reads of a shared group ticket", async () => {
  const session = progressSession([]);
  const first = progressStep({ session });
  const second = progressStep({
    id: "other",
    session: { ...session, attemptId: "retry", instanceId: "new-session" },
  });
  const checklist = vi.fn(async () =>
    progressTicket("- [x] Durable completion"),
  );
  const context = {
    projectId: "project",
    tasks: { checklist },
    stepTickets: { agent: ["ticket"], other: ["ticket", "ticket"] },
  };
  const run = await withPlanProgress(progressRun([first, second]), context);
  expect(checklist).toHaveBeenCalledTimes(1);
  expect(run.steps[0]?.progress?.scope?.attemptId).toBe("attempt");
  expect(run.steps[1]?.progress?.scope?.attemptId).toBe("retry");
  expect(run.steps[1]?.progress?.todos).toEqual(run.steps[0]?.progress?.todos);
});

it("reloads persistent ticket state after a terminal run without rewriting its acceptance", async () => {
  const session = progressSession([]);
  const run = {
    ...progressRun([progressStep({ status: "succeeded", session })]),
    status: "succeeded" as const,
  };
  const projected = await withPlanProgress(run, {
    projectId: "project",
    tasks: {
      checklist: async () => progressTicket("- [x] Durable completion"),
    },
    stepTickets: { agent: ["ticket"] },
  });
  expect(projected.steps[0]?.progress?.todos[0]?.status).toBe("done");
  expect(projected.steps[0]?.session).toBe(session);
});

it("extracts only stable per-node local and remote ticket identities, never host paths", () => {
  expect(
    readPlanStepTickets({
      steps: [
        {
          step: { id: "local" },
          taskIds: ["first"],
          prepared: {
            parameters: {
              values: { ticket: { type: "ticket", ticketId: "second" } },
            },
          },
        },
      ],
      remoteSteps: [
        {
          step: { id: "remote", type: "agent" },
          parameters: { tickets: { mobile: { path: "/private/host" } } },
        },
      ],
    }),
  ).toEqual({ local: ["first", "second"], remote: ["mobile"] });
  expect(readPlanStepTickets({ steps: [{ prepared: {} }] })).toEqual({});
});

it("uses the newest resumed binding for progress while retaining older tickets for authorization", async () => {
  function snapshot(ticketId: string): unknown {
    return {
      plan: { workspaceId: "workspace", projectId: "project", nodes: [] },
      remoteSteps: [
        {
          step: { type: "agent", id: "agent" },
          target: { workspaceId: "remote-workspace" },
          parameters: { tickets: { [ticketId]: { id: ticketId } } },
        },
      ],
    };
  }
  const database: Pick<Database, "query" | "execute" | "transaction"> = {
    query: async () => [
      [JSON.stringify(snapshot("current"))],
      [JSON.stringify(snapshot("original"))],
    ],
    execute: async () => {
      throw new Error("Read-only repository boundary");
    },
    transaction: async () => {
      throw new Error("No transaction needed for resource projection");
    },
  };
  const resources = await new AgentPlanRunRepository(database).resources("run");
  expect(resources.stepTickets).toEqual({ agent: ["current"] });
  expect(resources.ticketIds).toEqual(["current", "original"]);
});

it("observes description tasks and separately stored criteria by their distinct real IDs", async () => {
  const ticket = progressTicket("- [ ] Implement behavior", "ticket", [
    {
      id: "criterion",
      workItemId: "ticket",
      title: "Verify behavior",
      isDone: true,
      sortOrder: 0,
      createdAt: "2026-10-27",
      updatedAt: "2026-10-27",
    },
  ]);
  const run = await withPlanProgress(progressRun(), {
    projectId: "project",
    tasks: { checklist: async () => ticket },
    stepTickets: { agent: ["ticket"] },
  });
  const current = observation(run);
  expect(current.todos).toHaveLength(2);
  expect(current.todos[1]).toMatchObject({
    id: "ticket:ac-criterion",
    ticket: { itemId: "ac-criterion" },
    status: "done",
  });
  expect(current.todos[0]?.status).toBe("open");
});

it("keeps ticket progress scoped to its own node even when checklist IDs coincide", async () => {
  const first = progressTicket("- [x] Same task title", "first");
  const second = progressTicket("- [ ] Same task title", "second");
  const run = await withPlanProgress(
    progressRun([progressStep(), progressStep({ id: "other" })]),
    {
      projectId: "project",
      tasks: {
        checklist: async (userId, projectId, id) => {
          expect([userId, projectId]).toEqual(["executor", "project"]);
          return id === "first" ? first : second;
        },
      },
      stepTickets: { agent: ["first"], other: ["second"] },
    },
  );
  expect(observation(run).todos[0]).toMatchObject({
    ticket: { id: "first" },
    status: "done",
  });
  expect(run.steps[1]?.progress?.todos[0]).toMatchObject({
    ticket: { id: "second" },
    status: "open",
  });
});

it("asks TODO agents to reuse real work and identify activity without changing diagnostic completion", () => {
  const contract = buildPlanContract("", [progressTicket()], {
    completion: "todos",
    isReadOnly: false,
  });
  const prompt = renderPlanAssignment({
    contract,
    isReadOnly: false,
    usesMcp: true,
    runnerLabel: "Codex",
    instanceId: "attempt",
    directory: "/authorized/synthetic",
  });
  expect(contract.todos).toEqual([]);
  expect(contract.criteria).toEqual([]);
  expect(prompt).toContain("Reuse equivalent concrete ticket tasks");
  expect(prompt).toContain("checklist ID");
  expect(prompt).toContain(
    "Regular runner completion releases the next steps automatically",
  );
  const readonly = renderPlanAssignment({
    contract,
    isReadOnly: true,
    usesMcp: true,
    runnerLabel: "Codex",
    instanceId: "readonly",
    directory: "/authorized/synthetic",
  });
  expect(readonly).not.toContain(
    "add only missing work with the available revision-protected description tools",
  );
  expect(readonly).toContain("read-only");
});

it.each([
  { availability: "assumed" },
  { tickets: {} },
  { work: {} },
  { tickets: [{ id: "ticket", key: "SYN-ticket" }] },
  { scope: { runId: "run", attemptId: "attempt" } },
  { todos: [{ id: "entry", text: "Task", status: "active", ticket: {} }] },
])(
  "refuses malformed progress observations instead of interpreting them as confirmed work: %j",
  (invalid) => {
    expect(() =>
      readPlanProgress({
        source: "live",
        observedAt: "2026-10-27T18:00:00Z",
        todos: [],
        ...invalid,
      }),
    ).toThrow();
  },
);
