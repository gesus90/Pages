import { RouterContextProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { action, loader } from "@/app/routes/agent-plan-recovery";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";

import { TICKET_ACTOR } from "../../backend/service/agents/page55-ticket-fixture";

const service = vi.hoisted(() => ({
  view: vi.fn(),
  checkpoint: vi.fn(),
  control: vi.fn(),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({ agentPlanRecoveryService: service }),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

function requestArgs(
  request: Request,
  isAuthenticated = true,
): Parameters<typeof action>[0] {
  const context = new RouterContextProvider();
  if (isAuthenticated) context.set(authenticatedUserContext, TICKET_ACTOR);
  return {
    request,
    context,
    params: { runId: "run" },
    url: new URL(request.url),
    pattern: "/agent-api/plan-runs/:runId/recovery",
  };
}

function commandRequest(body: unknown, origin?: string): Request {
  return new Request(
    "http://synthetic.invalid/agent-api/plan-runs/run/recovery",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify(body),
    },
  );
}

it("reads diagnostics and an explicit checkpoint as the authenticated executor, without caching", async () => {
  service.view.mockResolvedValue({
    runId: "run",
    state: "interrupted",
    revision: 4,
  });
  const response = await loader(
    requestArgs(
      new Request("http://synthetic.invalid/agent-api/plan-runs/run/recovery"),
    ),
  );
  expect(service.view).toHaveBeenCalledExactlyOnceWith("owner", "run");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toMatchObject({
    ok: true,
    recovery: { state: "interrupted", revision: 4 },
  });

  service.checkpoint.mockResolvedValue({ version: 2, stepId: "a" });
  const checkpoint = await loader(
    requestArgs(
      new Request(
        "http://synthetic.invalid/agent-api/plan-runs/run/recovery?checkpoint=2",
      ),
    ),
  );
  expect(service.checkpoint).toHaveBeenCalledExactlyOnceWith("owner", "run", 2);
  expect(await checkpoint.json()).toMatchObject({
    ok: true,
    checkpoint: { version: 2 },
  });
});

it("forwards the expected revision and idempotency key without replacing the authenticated user", async () => {
  const command = {
    action: "cancel",
    expectedRevision: 4,
    idempotencyKey: "cancel-001",
  };
  service.control.mockResolvedValue({
    commandId: "decision",
    revision: 5,
    outcome: "cancelled",
  });

  const response = await action(requestArgs(commandRequest(command)));

  expect(service.control).toHaveBeenCalledExactlyOnceWith(
    "owner",
    "run",
    command,
  );
  expect(await response.json()).toMatchObject({
    ok: true,
    result: { revision: 5, outcome: "cancelled" },
  });
});

it.each([
  "revision_conflict",
  "idempotency_conflict",
  "workflow_unavailable",
  "action_unavailable",
] as const)("returns a structured, uncacheable %s conflict", async (code) => {
  service.control.mockRejectedValue(new AgentPlanRecoveryError(code));

  const response = await action(
    requestArgs(commandRequest({ action: "cancel" })),
  );

  expect(response.status).toBe(409);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ ok: false, error: code });
});

it("rejects unauthenticated and foreign-origin controls before calling a service", async () => {
  const anonymous = await action(requestArgs(commandRequest({}), false));
  const foreign = await action(
    requestArgs(commandRequest({}, "http://foreign.invalid")),
  );
  const read = await loader(
    requestArgs(
      new Request("http://synthetic.invalid/agent-api/plan-runs/run/recovery"),
      false,
    ),
  );

  expect([anonymous.status, foreign.status, read.status]).toEqual([
    403, 403, 403,
  ]);
  expect(service.control).not.toHaveBeenCalled();
  expect(service.view).not.toHaveBeenCalled();
});

it("rejects unsupported methods and malformed JSON and never echoes upstream diagnostics", async () => {
  const method = await action(
    requestArgs(
      new Request("http://synthetic.invalid/agent-api/plan-runs/run/recovery", {
        method: "DELETE",
      }),
    ),
  );
  expect(method.status).toBe(405);
  expect(method.headers.get("Allow")).toBe("POST");
  const malformed = await action(
    requestArgs(
      new Request("http://synthetic.invalid/agent-api/plan-runs/run/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    ),
  );
  expect(malformed.status).toBe(400);
  expect(service.control).not.toHaveBeenCalled();
  service.control.mockRejectedValue(new Error("sensitive upstream output"));
  const failure = await action(requestArgs(commandRequest({})));
  expect(failure.status).toBe(500);
  expect(await failure.text()).not.toContain("sensitive upstream output");
});
