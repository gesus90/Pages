import { expect, it, vi } from "vitest";

import { remoteTodoChecklists } from "@/backend/service/agents/AgentPlanRemoteChecklist";
import { remoteModelCommand } from "@/backend/service/agents/AgentPlanRemoteCommand";

import { progressTicket } from "./page162-progress-fixture";
import { remoteTodoParameters, remoteTodoStep } from "./page162-remote-fixture";

it("reads the executor's current checklist and puts real ticket IDs into a remote TODO contract", async () => {
  const ticket = progressTicket("- [ ] Implement the actual ticket");
  const checklist = vi.fn(async () => ticket);
  const step = remoteTodoStep();
  const tickets = await remoteTodoChecklists({
    step,
    parameters: remoteTodoParameters(),
    tasks: { checklist },
    userId: "executor",
    projectId: "project",
  });
  expect(checklist).toHaveBeenCalledExactlyOnceWith(
    "executor",
    "project",
    "ticket",
  );
  const command = remoteModelCommand(
    step,
    {
      version: 1,
      revision: 1,
      workspace: "/remote/authorized",
      outputBytes: 65536,
      pagesAccess: 1,
      input: "{}",
    },
    tickets,
  );
  if (command.program.kind !== "cli") throw new Error("Expected a CLI command");
  expect(command.resultPayloadVersion).toBe(1);
  expect(command.program.prompt).toContain("SYN-ticket (ID `ticket`)");
  expect(command.program.prompt).toContain(ticket.checklist.items[0]?.id);
  expect(command.program.prompt).toContain("Implement the actual ticket");
  expect(command.program.prompt).not.toContain("Stale empty planning snapshot");
  expect(command.program.prompt).toContain("read-only");
});

it("reads current bound requirements for report-mode remote commands too", async () => {
  const ticket = progressTicket("- [ ] Current report work");
  const checklist = vi.fn(async () => ticket);
  const result = await remoteTodoChecklists({
    step: { ...remoteTodoStep(), completion: "report" },
    parameters: remoteTodoParameters(),
    tasks: { checklist },
    userId: "executor",
    projectId: "project",
  });
  expect(result).toEqual([ticket]);
  expect(checklist).toHaveBeenCalledExactlyOnceWith(
    "executor",
    "project",
    "ticket",
  );
});

it("includes current bound ticket requirements for a remote OpenCode report", async () => {
  const ticket = progressTicket("- [ ] Inspect the actual ticket");
  const checklist = vi.fn(async () => ticket);
  const base = remoteTodoStep();
  if (!base.configuration?.runnerRoute) throw new Error("Expected a route");
  const step = {
    ...base,
    completion: "report" as const,
    configuration: {
      ...base.configuration,
      provider: "opencode" as const,
      runnerRoute: {
        ...base.configuration.runnerRoute,
        tool: "opencode" as const,
      },
    },
  };
  const tickets = await remoteTodoChecklists({
    step,
    parameters: remoteTodoParameters(),
    tasks: { checklist },
    userId: "executor",
    projectId: "project",
  });
  const command = remoteModelCommand(
    step,
    {
      version: 1,
      revision: 1,
      workspace: "/remote/authorized",
      outputBytes: 65536,
      input: "{}",
    },
    tickets,
  );
  if (command.program.kind !== "cli") throw new Error("Expected a CLI command");
  expect(checklist).toHaveBeenCalledExactlyOnceWith(
    "executor",
    "project",
    "ticket",
  );
  expect(command.program.prompt).toContain("Inspect the actual ticket");
  expect(command.program.prompt).toContain("requires business acceptance");
});

it("retains an empty planning list without inventing T1/K1 ticket tasks", async () => {
  const result = await remoteTodoChecklists({
    step: remoteTodoStep(),
    parameters: remoteTodoParameters(),
    tasks: { checklist: async () => progressTicket() },
    userId: "executor",
    projectId: "project",
  });
  expect(result[0]?.checklist.items).toEqual([]);
});

it("refuses an unreadable binding without falling back to stale remote Markdown", async () => {
  const input = {
    step: remoteTodoStep(),
    parameters: remoteTodoParameters(),
    userId: "executor",
    projectId: "project",
  };
  await expect(
    remoteTodoChecklists({ ...input, tasks: undefined }),
  ).rejects.toMatchObject({ code: "plan_binding_invalid" });
  await expect(
    remoteTodoChecklists({
      ...input,
      tasks: {
        checklist: async () => {
          throw new Error("Current permission refused");
        },
      },
    }),
  ).rejects.toThrow("Current permission refused");
});

it("leaves a remote node without ticket parameters unbound", async () => {
  const checklist = vi.fn();
  await expect(
    remoteTodoChecklists({
      step: remoteTodoStep(),
      parameters: undefined,
      tasks: { checklist },
      userId: "executor",
      projectId: "project",
    }),
  ).resolves.toEqual([]);
  expect(checklist).not.toHaveBeenCalled();
});
