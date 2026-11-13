import { describe, expect, it, vi } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { planOperationFailure } from "@/backend/service/agents/bridge/PlanBridgeFailure";
import { PlanBridgeGrants } from "@/backend/service/agents/bridge/PlanBridgeGrants";
import {
  answerPlanBridgeMessage,
  PlanBridgeRpcError,
} from "@/backend/service/agents/bridge/PlanBridgeProtocol";

import type { PlanBridgeHandlers } from "@/backend/service/agents/bridge/PlanBridgeProtocol";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const GRANT = {
  runId: "run",
  stepId: "step",
  instanceId: "instance",
  token: "secret",
  expiresAt: 0,
};

function handlers(): PlanBridgeHandlers {
  return {
    list: async () => [],
    call: async (name, input) => ({
      content: [{ type: "text", text: JSON.stringify({ name, input }) }],
    }),
  };
}

function request(method: string, params?: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
}

describe("plan bridge grants", () => {
  it("resolves active grants and revokes only the requested step or run", async () => {
    const active = vi.fn(async () => true);
    const grants = new PlanBridgeGrants(active);
    const first = grants.open(GRANT);
    const second = grants.open({ ...GRANT, stepId: "other" });
    const third = grants.open({ ...GRANT, runId: "another" });
    expect(first).not.toBe(second);
    await expect(grants.resolve(first)).resolves.toBe("secret");
    expect(active).toHaveBeenCalledWith(GRANT);
    expect(grants.revoke("run", "step")).toBe(1);
    await expect(grants.resolve(first)).resolves.toBeNull();
    await expect(grants.resolve(second)).resolves.toBe("secret");
    expect(grants.revoke("run", null)).toBe(1);
    await expect(grants.resolve(third)).resolves.toBe("secret");
  });

  it("expires and removes inactive grants", async () => {
    const active = vi.fn(async () => false);
    const grants = new PlanBridgeGrants(active);
    const expired = grants.open({ ...GRANT, expiresAt: Date.now() - 1 });
    await expect(grants.resolve(expired)).resolves.toBeNull();
    expect(active).not.toHaveBeenCalled();
    const inactive = grants.open(GRANT);
    await expect(grants.resolve(inactive)).resolves.toBeNull();
    await expect(grants.resolve(inactive)).resolves.toBeNull();
    expect(active).toHaveBeenCalledTimes(1);
  });

  it("honors revocation while the activity check is pending", async () => {
    let finish: (active: boolean) => void = () => undefined;
    const grants = new PlanBridgeGrants(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const bearer = grants.open(GRANT);
    const pending = grants.resolve(bearer);
    expect(grants.revoke("run", null)).toBe(1);
    finish(true);
    await expect(pending).resolves.toBeNull();
  });
});

describe("plan bridge protocol", () => {
  it("negotiates supported versions and defaults unknown versions", async () => {
    const known = await answerPlanBridgeMessage(
      request("initialize", { protocolVersion: "2024-11-05" }),
      handlers(),
    );
    expect(known).toMatchObject({
      status: 200,
      body: {
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "pages-plan" },
        },
      },
    });
    expect(known.sessionId).toEqual(expect.any(String));
    const fallback = await answerPlanBridgeMessage(
      request("initialize", { protocolVersion: "unknown" }),
      { ...handlers(), serverName: "custom" },
    );
    expect(fallback.body).toMatchObject({
      result: { protocolVersion: "2025-06-18", serverInfo: { name: "custom" } },
    });
  });

  it("dispatches tool calls and refuses malformed parameters", async () => {
    const bridge = handlers();
    const call = vi.spyOn(bridge, "call");
    expect(
      (await answerPlanBridgeMessage(request("tools/list"), bridge)).body,
    ).toMatchObject({ result: { tools: [] } });
    expect(
      (await answerPlanBridgeMessage(request("ping"), bridge)).body,
    ).toMatchObject({ result: {} });
    await answerPlanBridgeMessage(
      request("tools/call", { name: "read" }),
      bridge,
    );
    expect(call).toHaveBeenCalledWith("read", {});
    for (const params of [null, { name: 1 }, { name: "read", arguments: [] }]) {
      expect(
        (await answerPlanBridgeMessage(request("tools/call", params), bridge))
          .body,
      ).toMatchObject({ error: { code: -32602 } });
    }
    expect(
      (await answerPlanBridgeMessage(request("missing"), bridge)).body,
    ).toMatchObject({ error: { code: -32601 } });
  });

  it("handles malformed messages, notifications and sanitized failures", async () => {
    expect(await answerPlanBridgeMessage("{", handlers())).toMatchObject({
      status: 400,
      body: { error: { code: -32700 } },
    });
    expect(await answerPlanBridgeMessage("[]", handlers())).toMatchObject({
      status: 400,
      body: { error: { code: -32600 } },
    });
    expect(
      await answerPlanBridgeMessage(
        '{"jsonrpc":"2.0","method":"ping"}',
        handlers(),
      ),
    ).toEqual({ status: 202, body: null });
    const bridge = handlers();
    vi.spyOn(bridge, "list")
      .mockRejectedValueOnce(new PlanBridgeRpcError(-32001, "refused"))
      .mockRejectedValueOnce(new Error("secret"));
    expect(
      (await answerPlanBridgeMessage(request("tools/list"), bridge)).body,
    ).toMatchObject({ error: { code: -32001, message: "refused" } });
    expect(
      (await answerPlanBridgeMessage(request("tools/list"), bridge)).body,
    ).toMatchObject({ error: { code: -32603, message: "Internal error" } });
  });
});

describe("plan operation failure", () => {
  it("preserves valid public details and drops details for unrelated codes", () => {
    expect(
      planOperationFailure(
        new AgentOperationError("AMBIGUOUS", {
          candidates: [{ id: "1", name: "Project" }],
          truncated: false,
        }),
      )?.details,
    ).toEqual({ candidates: [{ id: "1", name: "Project" }], truncated: false });
    expect(
      planOperationFailure(
        new AgentOperationError("CONFLICT", { currentRevision: 4 }),
      )?.details,
    ).toEqual({ currentRevision: 4 });
    expect(
      planOperationFailure(
        new AgentOperationError("INVALID_REQUEST", {
          reason: "step_report_invalid",
          problems: ["missing result"],
        }),
      )?.details,
    ).toEqual({ reason: "step_report_invalid", problems: ["missing result"] });
    expect(
      planOperationFailure(new AgentOperationError("NOT_FOUND"))?.message,
    ).toBe("Not found or no access.");
  });

  it("retains valid graph findings and strips unsupported asset details", () => {
    const error = new AgentOperationError("INVALID_REQUEST", {
      reason: "graph_invalid",
      issues: [{ nodeId: "n", port: null, problem: "cycle" }],
      issueDetailsFiltered: true,
    });
    expect(planOperationFailure(error)?.details).toEqual({
      reason: "graph_invalid",
      issues: [{ nodeId: "n", port: null, problem: "cycle" }],
      issueDetailsFiltered: true,
    });
  });
});
