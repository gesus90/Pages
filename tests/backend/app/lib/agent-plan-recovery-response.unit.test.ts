import { expect, it } from "vitest";

import { planRecoveryFailure } from "@/app/lib/agent-plan-recovery-response.server";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";

it("answers a recovery refusal with its fixed code and status", async () => {
  const conflict = planRecoveryFailure(
    new AgentPlanRecoveryError("revision_conflict"),
  );
  const tooLarge = planRecoveryFailure(
    new AgentPlanRecoveryError("checkpoint_too_large"),
  );

  expect(conflict.status).toBe(409);
  expect(conflict.headers.get("Cache-Control")).toBe("no-store");
  expect(await conflict.json()).toEqual({
    ok: false,
    error: "revision_conflict",
  });
  expect(tooLarge.status).toBe(413);
});

it("returns the fixed cleanup reason and affected node to the executor", async () => {
  const response = planRecoveryFailure(
    new AgentPlanRecoveryError("cleanup_unconfirmed", {
      stepId: "node-a",
      kind: "local_script",
      reason: "scan_access_denied",
    }),
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    ok: false,
    error: "cleanup_unconfirmed",
    cleanupFailure: {
      stepId: "node-a",
      kind: "local_script",
      reason: "scan_access_denied",
    },
  });
});

it("reports an oversized operation as 413 and other operation refusals as 400", async () => {
  const large = planRecoveryFailure(
    new AgentOperationError("PAYLOAD_TOO_LARGE"),
  );
  const invalid = planRecoveryFailure(new AgentOperationError("CONFLICT"));

  expect(large.status).toBe(413);
  expect(await large.json()).toEqual({ ok: false, error: "invalid_request" });
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toEqual({ ok: false, error: "invalid_request" });
  expect(invalid.headers.get("Cache-Control")).toBe("no-store");
});

it("reports unavailable durable diagnostics without claiming release", async () => {
  const response = planRecoveryFailure(
    new AgentPlanRecoveryError("diagnostic_unavailable"),
  );

  expect(response.status).toBe(503);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    ok: false,
    error: "diagnostic_unavailable",
  });
});

it("falls back to the agent failure answer with the recovery intent", async () => {
  const response = planRecoveryFailure(new Error("native"));

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    ok: false,
    intent: "plan-recovery",
    error: "general",
  });
});
