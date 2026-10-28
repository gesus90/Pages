import { expect, it } from "vitest";

import { agentFailureResponse } from "@/app/lib/settings-actions/settings-agents-response.server";
import {
  AgentAccessDeniedError,
  AgentError,
  AgentInUseError,
} from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";

it("answers an execution refusal with its code and 403 only for denied access", async () => {
  const denied = agentFailureResponse(
    new AgentExecutionError("accessDenied"),
    "run",
  );
  const invalid = agentFailureResponse(new AgentExecutionError("invalidInput"));

  expect(denied.status).toBe(403);
  expect(await denied.json()).toEqual({
    ok: false,
    intent: "run",
    error: "accessDenied",
  });
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toEqual({
    ok: false,
    intent: "",
    error: "invalidInput",
  });
  expect(invalid.headers.get("Cache-Control")).toBe("no-store");
});

it("passes a thrown response through but never lets it be cached", async () => {
  const thrown = new Response("Gone", {
    status: 410,
    headers: { "Cache-Control": "max-age=60", "X-Reason": "kept" },
  });

  const response = agentFailureResponse(thrown);

  expect(response.status).toBe(410);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Reason")).toBe("kept");
  expect(await response.text()).toBe("Gone");
});

it("answers a missing administrator mode with a fixed refusal", async () => {
  const response = agentFailureResponse(new AgentAccessDeniedError(), "save");

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    ok: false,
    intent: "save",
    error: "accessDenied",
  });
});

it("maps known agent codes to their status and others to 400", async () => {
  const missing = agentFailureResponse(new AgentError("connection_not_found"));
  const unmapped = agentFailureResponse(new AgentError("profile_invalid"));

  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({
    ok: false,
    intent: "",
    error: "connection_not_found",
  });
  expect(unmapped.status).toBe(400);
});

it("lists the references that block a deletion", async () => {
  const usages = [{ kind: "plan", id: "plan-1" }] as const;

  const response = agentFailureResponse(
    new AgentInUseError("profile_in_use", usages),
    "delete",
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    ok: false,
    intent: "delete",
    error: "profile_in_use",
    usages,
  });
});

it("includes the findings of a refused plan graph", async () => {
  const issues = [{ nodeId: "node", port: null, reason: "groupSize" }] as const;

  const response = agentFailureResponse(new AgentPlanValidationError(issues));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    ok: false,
    intent: "",
    error: "plan_invalid",
    issues,
  });
});

it("hides an unexpected failure behind a general 500", async () => {
  const response = agentFailureResponse(new Error("secret native text"), "x");

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    ok: false,
    intent: "x",
    error: "general",
  });
});
