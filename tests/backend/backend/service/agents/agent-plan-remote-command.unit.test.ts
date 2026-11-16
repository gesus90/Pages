import { expect, it } from "vitest";

import {
  remoteModelCommand,
  remoteScriptCommand,
  remoteTextInputs,
} from "@/backend/service/agents/AgentPlanRemoteCommand";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlan, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";
import type { RunnerExecution } from "@/definition/RunnerExecution";

const BASIS = partial<RunnerExecution>({
  version: 1,
  revision: 1,
  workspace: "/work",
  input: "{}",
  outputBytes: 100,
});

it("builds a finite remote model command from its pinned route", () => {
  const step = partial<AgentPlanStep>({
    id: "step",
    type: "agent",
    instruction: "Do work",
    completion: "none",
    configuration: {
      runnerRoute: {
        connectionId: "connection",
        workspaceId: "workspace",
        catalogRevision: "revision",
      },
      model: "model",
      template: { markdown: "Instructions", run: { timeoutMinutes: 2 } },
    },
  });
  expect(remoteModelCommand(step, BASIS)).toMatchObject({
    timeoutSeconds: 120,
    program: {
      kind: "model",
      model: "model",
      prompt: "Instructions\n\nDo work",
    },
  });
  expect(() =>
    remoteModelCommand({ ...step, completion: "todos" }, BASIS),
  ).toThrow();
  expect(() => remoteModelCommand(partial<AgentPlanStep>({}), BASIS)).toThrow();
});

it("refuses an unavailable script interpreter and non-text bindings", () => {
  const script = partial<AgentPlanScript>({
    type: "script",
    interpreterProfileId: "workspace-python",
  });
  expect(() =>
    remoteScriptCommand(
      script,
      partial<AgentPlanRemoteTarget>({ workspaceId: "workspace" }),
      [],
      BASIS,
    ),
  ).toThrow();
  const step = partial<AgentPlanStep>({
    type: "agent",
    configuration: {
      template: { parameters: [{ name: "ticket", type: "ticket" }] },
    },
  });
  expect(() => remoteTextInputs(partial<AgentPlan>({}), step, [])).toThrow();
});
