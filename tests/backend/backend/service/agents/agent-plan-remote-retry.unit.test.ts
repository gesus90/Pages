import { expect, it } from "vitest";

import { remoteContinuationCommand } from "@/backend/service/agents/AgentPlanRemoteContinuation";
import { remoteRetryCommand } from "@/backend/service/agents/AgentPlanRemoteRetryCommand";
import { MAX_RUNNER_PROMPT_CHARACTERS } from "@/definition/RunnerExecution";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { RemoteRetryTerms } from "@/backend/service/agents/AgentPlanRemoteDispatch";
import type { RunnerExecution } from "@/definition/RunnerExecution";

const COMMAND = partial<RunnerExecution>({
  program: { kind: "cli", access: "yolo", prompt: "Work" },
});

it("requests a resumable session only for supported writing CLI work", () => {
  expect(
    remoteContinuationCommand(COMMAND, {
      isSupported: true,
      resumeSessionId: "session",
    }),
  ).toMatchObject({ continuation: { version: 1, resumeSessionId: "session" } });
  expect(
    remoteContinuationCommand(COMMAND, {
      isSupported: false,
      resumeSessionId: null,
    }),
  ).toEqual(COMMAND);
  expect(() =>
    remoteContinuationCommand(COMMAND, {
      isSupported: false,
      resumeSessionId: "session",
    }),
  ).toThrow();
  const script = partial<RunnerExecution>({ program: { kind: "script" } });
  expect(
    remoteContinuationCommand(script, {
      isSupported: true,
      resumeSessionId: "session",
    }),
  ).toEqual(script);
});

it("preserves unchanged retries and rejects prompts beyond the runner limit", () => {
  expect(remoteRetryCommand(COMMAND, undefined)).toEqual(COMMAND);
  const retry = partial<RemoteRetryTerms>({
    retry: null,
    resumeSessionId: null,
  });
  expect(remoteRetryCommand(COMMAND, retry)).toEqual(COMMAND);
  const large = partial<RunnerExecution>({
    program: {
      kind: "cli",
      prompt: "x".repeat(MAX_RUNNER_PROMPT_CHARACTERS + 1),
    },
  });
  expect(() => remoteRetryCommand(large, retry)).toThrow();
});
