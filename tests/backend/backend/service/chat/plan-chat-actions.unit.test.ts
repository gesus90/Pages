import { beforeEach, expect, it, vi } from "vitest";

import {
  describeChatOperations,
  isChatOperation,
  isChatWriteOperation,
  requiresChatConfirmation,
} from "@/backend/service/chat/ChatToolCatalog";
import {
  AGENT_PLAN_READ_OPERATIONS,
  AGENT_PLAN_WRITE_OPERATIONS,
} from "@/definition/AgentPlanOperations";

import { memoryFiles } from "../agents/page-agent-files";
import {
  PlanWorld,
  REVIEWER,
  runnablePlan,
  WORKSPACE,
} from "../agents/plan-operation-world";
import { ChatAgentWorld, modelAction } from "./page56-chat-world";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesModule } = await import("../agents/page-agent-files");
  return memoryFilesModule();
});

let plans: PlanWorld;
let chat: ChatAgentWorld;

beforeEach(() => {
  memoryFiles.reset();
  plans = new PlanWorld();
  plans.members.add("igor");
  plans.seed(
    runnablePlan("plan-nightly", { name: "Nightly review", ownerId: "igor" }),
  );
  plans.seed(
    runnablePlan("plan-release", { name: "Release review", ownerId: "igor" }),
  );
  plans.seed(
    runnablePlan("plan-foreign", { name: "Foreign", ownerId: "owner" }),
  );
  chat = new ChatAgentWorld(plans.operations);
});

it("offers every plan operation to Pica; changes get an operation ID and need no deletion word", () => {
  for (const operation of [
    ...AGENT_PLAN_READ_OPERATIONS,
    ...AGENT_PLAN_WRITE_OPERATIONS,
  ]) {
    expect(isChatOperation(operation)).toBe(true);
    expect(describeChatOperations()).toContain(`\`${operation}\``);
    expect(requiresChatConfirmation(operation)).toBe(false);
  }
  expect(isChatWriteOperation("plans.update")).toBe(true);
  expect(isChatWriteOperation("plans.parameter.remove")).toBe(true);
  expect(isChatWriteOperation("plans.runs.list")).toBe(false);
});

it("finds a plan by name, reads its newest run and answers with date and status", async () => {
  plans.addRun({
    id: "run-old",
    planId: "plan-nightly",
    userId: "igor",
    startedAt: "2026-10-13T08:00:00.000Z",
    status: "failed",
  });
  plans.addRun({
    id: "run-new",
    planId: "plan-nightly",
    userId: "igor",
    startedAt: "2026-10-14T13:42:00.000Z",
  });

  const reply = await chat.send("Wie lief der letzte Run vom Nightly-Plan?", [
    modelAction("plans.list", { text: "nightly" }),
    modelAction("plans.run.read", { planId: "plan-nightly", select: "latest" }),
    "Der letzte Run von „Nightly review“ startete am 14.10.2026 um 15:42 Uhr und war erfolgreich.",
  ]);

  expect(reply.answer.content).toContain("14.10.2026 um 15:42 Uhr");
  expect(chat.prompts[1].prompt).toContain('"ok":true');
  expect(chat.prompts[1].prompt).toContain('"name":"Nightly review"');
  expect(chat.prompts[2].prompt).toContain(
    '"runId":"run-new","planId":"plan-nightly","planName":"Nightly review"',
  );
  expect(chat.prompts[2].prompt).toContain(
    '"startedAt":"2026-10-14T13:42:00.000Z","status":"succeeded"',
  );
  const { instructions } = chat.prompts[0];
  expect(instructions).toContain("## Agent Plans");
  expect(instructions).toContain("frage nach, welcher gemeint ist");
  expect(instructions).toContain("succeeded = erfolgreich");
  expect(instructions).toContain("Datum und Uhrzeit des Starts");
});

it("lets Pica see both candidates of an ambiguous name before it asks back", async () => {
  const reply = await chat.send("Zeig mir den Review-Plan.", [
    modelAction("plans.list", { text: "review" }),
    "Ich habe zwei passende Pläne gefunden: „Nightly review“ und „Release review“. Welchen meinst du?",
  ]);

  expect(reply.answer.content).toContain("Welchen meinst du?");
  expect(chat.prompts[1].prompt).toContain('"name":"Nightly review"');
  expect(chat.prompts[1].prompt).toContain('"name":"Release review"');
  expect(chat.prompts[1].prompt).toContain('"total":2');
});

it("creates a plan, edits its structure and a parameter through chat actions", async () => {
  const created = await chat.run("plans.create", {
    name: "Chat plan",
    workspaceId: WORKSPACE,
    changes: [
      { action: "addNode", node: { type: "start", id: "begin" } },
      {
        action: "addNode",
        node: { type: "agent", id: "work", agentId: REVIEWER },
      },
      { action: "addNode", node: { type: "end", id: "finish" } },
      { action: "connect", from: "begin", to: "work" },
      { action: "connect", from: "work", to: "finish" },
    ],
  });
  const planId =
    typeof created.result === "object" &&
    created.result !== null &&
    "planId" in created.result
      ? created.result.planId
      : null;
  const parameter = await chat.run("plans.parameter.create", {
    planId,
    expectedRevision: 1,
    name: "topic",
    value: { type: "text", text: "Release notes" },
  });
  const disconnected = await chat.run("plans.update", {
    planId,
    expectedRevision: 2,
    changes: [{ action: "disconnect", from: "work", to: "finish" }],
  });
  const read = await chat.run("plans.read", { planId });

  expect([created.ok, parameter.ok, disconnected.ok, read.ok]).toEqual([
    true,
    true,
    true,
    true,
  ]);
  expect(read.result).toMatchObject({
    plan: {
      name: "Chat plan",
      revision: 3,
      edges: [{ from: "begin", to: "work" }],
      status: { isRunnable: false },
    },
  });
  expect(JSON.stringify(read.result)).toContain('"name":"topic"');
});

it("reports refusals of the plan rules to Pica as codes", async () => {
  plans.addRun({
    id: "run-foreign",
    planId: "plan-foreign",
    userId: "owner",
    startedAt: "2026-10-14T09:00:00.000Z",
  });

  const foreignChange = await chat.run("plans.update", {
    planId: "plan-foreign",
    expectedRevision: 1,
    name: "Mine now",
  });
  const foreignRun = await chat.run("plans.run.read", { runId: "run-foreign" });
  const outsider = await chat.run(
    "plans.read",
    { planId: "plan-nightly" },
    { userId: "outsider" },
  );

  expect(foreignChange).toEqual({ ok: false, error: "FORBIDDEN" });
  expect(foreignRun).toEqual({ ok: false, error: "NOT_FOUND" });
  expect(outsider).toEqual({ ok: false, error: "NOT_FOUND" });
  expect(plans.saves).toBe(0);
});
