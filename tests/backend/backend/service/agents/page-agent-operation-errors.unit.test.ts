import { expect, it } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { translatePageAgentError } from "@/backend/service/agents/PageAgentOperationErrors";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { TextAssistantErrorCode } from "@/backend/error/TextAssistantErrors";

function agent(code: AgentErrorCode): unknown {
  return translatePageAgentError(new AgentError(code));
}

function assistant(code: TextAssistantErrorCode): unknown {
  return translatePageAgentError(new TextAssistantError(code));
}

it("turns refusals of a definition into a public code and a fixed reason", () => {
  expect(agent("profile_limit_reached")).toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "agent_limit_reached" },
  });
  expect(agent("agent_usage_denied")).toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "model_unavailable" },
  });
  expect(agent("profile_target_invalid")).toMatchObject({
    details: { reason: "sharing_target_unavailable" },
  });
  expect(agent("parameter_invalid")).toMatchObject({
    details: { reason: "configuration_invalid" },
  });
  expect(agent("workspace_path_invalid")).toMatchObject({
    details: { reason: "parameter_reference_unavailable" },
  });
});

it("keeps what is missing, running or changed apart from a refused input", () => {
  expect(agent("profile_not_found")).toMatchObject({ code: "NOT_FOUND" });
  expect(agent("profile_running")).toMatchObject({
    code: "CONFLICT",
    details: { reason: "agent_running" },
  });
  expect(agent("profile_conflict")).toMatchObject({
    code: "CONFLICT",
    details: undefined,
  });
});

it("names no reason for a failure that has none", () => {
  expect(agent("profile_invalid")).toMatchObject({
    code: "INVALID_REQUEST",
    details: undefined,
  });
  expect(assistant("invalidInput")).toMatchObject({
    code: "INVALID_REQUEST",
    details: undefined,
  });
});

it("maps the model rules of the assistant onto the same reasons", () => {
  for (const code of [
    "accessDenied",
    "connectionUnavailable",
    "accessUnverified",
    "modelUnavailable",
  ] as const)
    expect(assistant(code)).toMatchObject({
      details: { reason: "model_unavailable" },
    });
  expect(assistant("reasoningUnsupported")).toMatchObject({
    details: { reason: "reasoning_unsupported" },
  });
  expect(assistant("credentialsInText")).toMatchObject({
    details: { reason: "credentials_in_text" },
  });
});

it("passes any other failure on unchanged", () => {
  const failure = new Error("database unavailable");

  expect(translatePageAgentError(failure)).toBe(failure);
});
