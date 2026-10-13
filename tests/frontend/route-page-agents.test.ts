import { RouterContextProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  pageAgentService: { page: vi.fn(), save: vi.fn(), requireVisible: vi.fn() },
  agentRunArchive: { read: vi.fn() },
  agentPlanService: { run: vi.fn() },
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { action, loader } from "@/app/routes/page-agents";
import { loader as archiveLoader } from "@/app/routes/agent-run-record";
import { AgentError } from "@/backend/error/AgentErrors";

import { createUser } from "../helpers/factories";

function args(
  fields: Record<string, string> = {},
  isAuthenticated = true,
): Parameters<typeof action>[0] {
  const context = new RouterContextProvider();
  context.set(authenticatedUserContext, isAuthenticated ? createUser() : null);
  return {
    context,
    request: new Request("https://pages.invalid/agents/agents", {
      method: "POST",
      body: new URLSearchParams(fields),
    }),
    params: {},
    url: new URL("https://pages.invalid/agents/agents"),
    pattern: "/agents/agents",
  };
}

describe("PAGE-20 authenticated management and archive endpoints", () => {
  it("delegates only the authenticated user, validates envelopes and returns server authorization refusals", async () => {
    services.pageAgentService.page.mockResolvedValue({ agents: [] });
    expect((await loader(args())).data).toEqual({ agents: [] });
    expect(services.pageAgentService.page).toHaveBeenCalledWith(
      createUser().id,
    );
    services.pageAgentService.save.mockResolvedValue("agent");
    const proposed = { name: "Agent", ownerId: "forged" };
    const response = await action(
      args({
        intent: "save-agent",
        agentId: "agent",
        agent: JSON.stringify(proposed),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      intent: "save-agent",
      agentId: "agent",
    });
    expect(services.pageAgentService.save).toHaveBeenCalledWith(
      createUser().id,
      "agent",
      proposed,
    );
    services.pageAgentService.save.mockRejectedValue(
      new AgentError("agent_usage_denied"),
    );
    expect(
      (
        await action(
          args({ intent: "save-agent", agentId: "agent", agent: "{}" }),
        )
      ).status,
    ).toBe(403);
    expect((await action(args({}, false))).status).toBe(403);
    await expect(loader(args({}, false))).rejects.toMatchObject({
      status: 403,
    });
    expect(
      (await action(args({ intent: "save-agent", agent: "x".repeat(500001) })))
        .status,
    ).toBe(400);
    expect((await action(args({ intent: "other" }))).status).toBe(400);
    expect(
      (await action(args({ intent: "save-agent", agent: "{not json" }))).status,
    ).toBe(400);
  });

  it("protects markdown with agent, executor, model, plan and source-resource checks and no caching", async () => {
    const base = args();
    const request = {
      ...base,
      params: { agentId: "agent", runId: "run" },
      pattern: "/agent-api/run-records/:agentId/:runId",
    };
    services.pageAgentService.requireVisible.mockRejectedValueOnce(
      new AgentError("agent_usage_denied"),
    );
    expect((await archiveLoader(request)).status).toBe(403);
    expect(services.agentRunArchive.read).not.toHaveBeenCalled();
    services.pageAgentService.requireVisible.mockResolvedValue(undefined);
    services.agentRunArchive.read.mockRejectedValueOnce(
      new AgentError("agent_usage_denied"),
    );
    expect((await archiveLoader(request)).status).toBe(403);
    services.agentRunArchive.read.mockResolvedValue({
      record: { planRunId: "plan-run" },
      markdown: "# Private run",
    });
    services.agentPlanService.run.mockRejectedValueOnce(
      new AgentError("plan_access_denied"),
    );
    expect((await archiveLoader(request)).status).toBe(403);
    services.agentPlanService.run.mockResolvedValue(undefined);
    const response = await archiveLoader(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("# Private run");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toContain("text/markdown");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(services.agentPlanService.run).toHaveBeenCalledWith(
      createUser().id,
      "plan-run",
    );
    expect(
      (await archiveLoader({ ...request, context: args({}, false).context }))
        .status,
    ).toBe(403);
  });
});
