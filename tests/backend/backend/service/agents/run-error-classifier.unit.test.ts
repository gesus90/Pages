import { expect, it } from "vitest";

import {
  agentRunErrorHint,
  classifyAgentRunError,
  classifyAgentRunErrorCode,
} from "@/backend/service/agents/diagnosis/AgentRunErrorClassifier";

it.each([
  ["plan_model_unavailable", "model"],
  ["provider_rate_limit", "model"],
  ["cli_missing", "tool_missing"],
  ["plan_script_timeout", "timeout"],
  ["plan_git_closeout_conflict", "git"],
  ["workspace_in_use", "workspace_busy"],
  ["workspace_access_denied", "permission"],
  ["workspace_invalid", "plan_invalid"],
  ["plan_script_signal", "process_crash"],
  ["plan_remote_unavailable", "runner_unavailable"],
  ["plan_acceptance_failed", "acceptance_failed"],
  ["unrecognized_code", "unknown"],
] as const)("classifies %s as %s", (code, expected) => {
  expect(classifyAgentRunErrorCode(code)).toBe(expected);
  expect(classifyAgentRunError(code)).toMatchObject({
    errorCode: code,
    errorClass: expected,
    errorHint: agentRunErrorHint(expected),
  });
});

it.each([null, undefined, " ", "old error with details"])(
  "does not expose free-form error text as a code",
  (input) => {
    expect(classifyAgentRunError(input)).toMatchObject({
      errorCode: "unknown_error",
      errorClass: "unknown",
    });
  },
);
