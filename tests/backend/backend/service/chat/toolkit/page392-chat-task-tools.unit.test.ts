import { afterEach, describe, expect, it, vi } from "vitest";

import { createPicaTools } from "@/backend/service/chat/PicaTools";
import { PicaPlanConfirmation } from "@/backend/service/chat/PicaPlanConfirmation";
import {
  closeAgentToolkitJob,
  createAgentToolkitJob,
} from "@/backend/service/chat/toolkit/AgentToolkit";
import { createAgentShellLauncher } from "@/backend/service/chat/toolkit/AgentShellLauncher";
import { agentToolPolicy } from "@/definition/AgentToolGroups";

import { chatTaskWorld } from "../../employee/page392-chat-task-world";
import {
  AGENT_ID,
  callContext,
  resultOf,
  workingFolder,
} from "./page390-toolkit-world";

import type { AgentToolkitJob } from "@/backend/service/chat/toolkit/AgentToolkitContracts";
import type { AgentChatTasks } from "@/definition/AgentChatTask";
import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";

// Never start the independent MCP plan catalog in the Pages unit scope.
vi.mock("@/backend/service/chat/PicaPlanTools", () => ({
  registerPicaPlanTools: vi.fn(),
}));

const jobs: AgentToolkitJob[] = [];

afterEach(async () => {
  for (const job of jobs.splice(0)) await closeAgentToolkitJob(job);
});

async function turnOf(
  chatTasks: AgentChatTasks | undefined,
  access: AgentEmployeeAccess = "workspace",
): Promise<ReturnType<typeof createPicaTools>> {
  const job = createAgentToolkitJob({
    agentId: AGENT_ID,
    root: await workingFolder(),
    policy: agentToolPolicy(access, []),
    isIsolated: false,
    launcher: createAgentShellLauncher(false),
    ...(chatTasks ? { chatTasks } : {}),
  });
  jobs.push(job);
  return createPicaTools({
    tools: { run: vi.fn(async () => ({ ok: true, result: {} })) },
    sessions: { confirmationWord: async () => "LÖSCHEN" },
    authorize: async () => undefined,
    message: "Erinnere mich morgen um 9 an den Zahnarzt",
    planTurnId: "message-1",
    toolkit: { job, approvals: new PicaPlanConfirmation() },
  });
}

function boundTasks(): {
  readonly tasks: AgentChatTasks;
  readonly world: ReturnType<typeof chatTaskWorld>;
} {
  const world = chatTaskWorld();
  return {
    world,
    tasks: world.service.bind("agent", {
      kind: "direct",
      personId: "igor",
    }),
  };
}

describe("PAGE-392 tools of scheduled tasks", () => {
  it("plans 'Erinnere mich morgen um 9' and answers the time to confirm in plain words", async () => {
    const { tasks, world } = boundTasks();
    const tools = await turnOf(tasks);
    const planned = await tools.invoke(
      "aufgabe_planen",
      {
        kind: "reminder",
        request: "Erinnere mich morgen um 9 an den Zahnarzt",
        instruction: "Zahnarzttermin",
        schedule: { type: "once", at: "2026-11-16T09:00" },
      },
      callContext(),
    );
    expect(planned?.output).toMatchObject({ ok: true });
    const result = resultOf(planned?.output);
    expect(result).toMatchObject({
      kind: "reminder",
      when: "Morgen, 16.11., 9:00 Uhr",
      nextRunAt: "2026-11-16T08:00:00.000Z",
      instruction:
        "Confirm to the person in plain words: Morgen, 16.11., 9:00 Uhr.",
    });
    expect(world.bindings.size).toBe(1);

    const listed = await tools.invoke("aufgaben_auflisten", {}, callContext());
    expect(resultOf(listed?.output)).toMatchObject({
      tasks: [{ taskId: result.taskId, when: "Morgen, 16.11., 9:00 Uhr" }],
    });

    const paused = await tools.invoke(
      "aufgabe_aendern",
      { taskId: result.taskId, active: false },
      callContext(),
    );
    expect(resultOf(paused?.output)).toMatchObject({ isActive: false });
  });

  it("holds a deletion back until the person approved it", async () => {
    const { tasks, world } = boundTasks();
    const tools = await turnOf(tasks);
    const planned = resultOf(
      (
        await tools.invoke(
          "aufgabe_planen",
          {
            kind: "task",
            request: "Prüfe jeden Montag die offenen Tickets",
            schedule: { type: "weekly", weekdays: [1], times: ["09:00"] },
          },
          callContext(),
        )
      )?.output,
    );
    const held = await tools.invoke(
      "aufgabe_loeschen",
      { taskId: planned.taskId },
      callContext(),
    );
    expect(held?.output).toMatchObject({ error: "CONFIRMATION_REQUIRED" });
    expect(world.bindings.size).toBe(1);
  });
});

describe("PAGE-392 task tool refusals and access", () => {
  it("answers refusals with their codes", async () => {
    const world = chatTaskWorld({ limit: 0 });
    const tools = await turnOf(
      world.service.bind("agent", { kind: "direct", personId: "igor" }),
    );
    const full = await tools.invoke(
      "aufgabe_planen",
      {
        kind: "reminder",
        request: "Zahnarzt",
        schedule: { type: "interval", every: 1, unit: "day" },
      },
      callContext(),
    );
    expect(full?.output).toMatchObject({ ok: false, error: "LIMIT_REACHED" });
    const invalid = await tools.invoke(
      "aufgabe_planen",
      { kind: "reminder", request: "x", schedule: { type: "event" } },
      callContext(),
    );
    expect(invalid?.isValid).toBe(false);
  });

  it("follows the access level: read-only agents only list, a job without a chat plans nothing", async () => {
    const { tasks } = boundTasks();
    const readOnly = (await turnOf(tasks, "read_only"))
      .describe()
      .map((tool) => tool.id);
    expect(readOnly).toContain("aufgaben_auflisten");
    expect(readOnly).not.toContain("aufgabe_planen");
    expect(readOnly).not.toContain("aufgabe_aendern");
    expect(readOnly).not.toContain("aufgabe_loeschen");
    const full = (await turnOf(tasks)).describe().map((tool) => tool.id);
    expect(full).toEqual(
      expect.arrayContaining([
        "aufgabe_planen",
        "aufgaben_auflisten",
        "aufgabe_aendern",
        "aufgabe_loeschen",
      ]),
    );
    const without = (await turnOf(undefined)).describe().map((tool) => tool.id);
    expect(without).not.toContain("aufgabe_planen");
    expect(without).not.toContain("aufgaben_auflisten");
  });
});
