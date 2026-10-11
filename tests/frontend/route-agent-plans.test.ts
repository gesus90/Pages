import { RouterContextProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

const planService = vi.hoisted(() => ({
  page: vi.fn(),
  sources: vi.fn(),
  save: vi.fn(),
  play: vi.fn(),
  stop: vi.fn(),
  run: vi.fn(),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({ agentPlanService: planService }),
}));

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { action, headers, loader } from "@/app/routes/agent-plans";
import { loader as sourceLoader } from "@/app/routes/agent-plan-sources";
import { loader as runLoader } from "@/app/routes/agent-plan-runs";
import { AgentError } from "@/backend/error/AgentErrors";

import { createUser } from "../helpers/factories";

function args(
  fields: Record<string, string> = {},
  options: {
    readonly method?: string;
    readonly user?: boolean;
    readonly query?: string;
  } = {},
): Parameters<typeof action>[0] {
  const context = new RouterContextProvider();
  context.set(
    authenticatedUserContext,
    options.user === false ? null : createUser(),
  );
  const url = new URL(
    `https://pages.invalid/agents/plans${options.query ?? ""}`,
  );
  const method = options.method ?? "POST";
  return {
    context,
    params: {},
    pattern: "/agents/plans",
    url,
    request: new Request(url, {
      method,
      body: method === "POST" ? new URLSearchParams(fields) : undefined,
    }),
  };
}

describe("A10.4 authenticated plan route boundaries", () => {
  it("uses null selectors on a new page and rejects absent actions or graph envelopes", async () => {
    planService.page.mockResolvedValue({ plans: [] });
    await loader(args({}, { method: "GET" }));
    expect(planService.page).toHaveBeenCalledWith(createUser().id, {
      planId: null,
      workspaceId: null,
    });
    expect((await action(args())).status).toBe(400);
    expect((await action(args({ intent: "save-plan" }))).status).toBe(500);
  });

  it("uses the session actor, validated selectors and no-store for loaders and polls", async () => {
    planService.page.mockResolvedValue({ plans: [] });
    await loader(
      args(
        {},
        {
          method: "GET",
          query: "?planId=plan&workspaceId=workspace&userId=forged",
        },
      ),
    );
    expect(planService.page).toHaveBeenCalledWith(createUser().id, {
      planId: "plan",
      workspaceId: "workspace",
    });
    planService.sources.mockResolvedValue({ agents: [], tasks: [] });
    const sources = await sourceLoader(
      args({}, { method: "GET", query: "?workspaceId=workspace" }),
    );
    expect(sources.headers.get("Cache-Control")).toBe("no-store");
    expect(await sources.json()).toEqual({
      workspaceId: "workspace",
      sources: { agents: [], tasks: [] },
    });
    expect(planService.sources).toHaveBeenCalledWith(
      createUser().id,
      "workspace",
    );
    planService.run.mockResolvedValue({ id: "run" });
    const run = await runLoader(
      args({}, { method: "GET", query: "?runId=run" }),
    );
    expect(run.headers.get("Cache-Control")).toBe("no-store");
    expect(await run.json()).toMatchObject({
      ok: true,
      intent: "poll-run",
      run: { id: "run" },
    });
    const combined = new Headers(
      headers({
        parentHeaders: new Headers({ "X-Frame-Options": "DENY" }),
        loaderHeaders: new Headers(),
        actionHeaders: new Headers(),
        errorHeaders: undefined,
      }),
    );
    expect(combined.get("Cache-Control")).toBe("no-store");
    expect(combined.get("X-Frame-Options")).toBe("DENY");
  });

  it("rejects unauthenticated access, invalid query identifiers, and resource grants revoked during polling", async () => {
    await expect(
      loader(args({}, { method: "GET", user: false })),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (await sourceLoader(args({}, { method: "GET", user: false }))).status,
    ).toBe(403);
    expect(
      (await runLoader(args({}, { method: "GET", user: false }))).status,
    ).toBe(403);
    expect(
      (await sourceLoader(args({}, { method: "GET", query: "?workspaceId=" })))
        .status,
    ).toBe(400);
    await expect(
      loader(args({}, { method: "GET", query: "?planId=" })),
    ).rejects.toMatchObject({ status: 400 });
    planService.run.mockRejectedValueOnce(new AgentError("plan_access_denied"));
    const denied = await runLoader(
      args({}, { method: "GET", query: "?runId=revoked" }),
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({
      ok: false,
      runId: "revoked",
      error: "plan_access_denied",
    });
  });

  it("routes save, Play and Stop to the signed-in executor and cannot execute submitted unsaved graphs", async () => {
    planService.save.mockResolvedValue("saved");
    const proposed = {
      name: "Plan",
      workspaceId: "workspace",
      nodes: [],
      edges: [],
    };
    const saved = await action(
      args({
        intent: "save-plan",
        plan: JSON.stringify(proposed),
        userId: "forged",
      }),
    );
    expect(saved.status).toBe(200);
    expect(planService.save).toHaveBeenCalledWith(
      createUser().id,
      null,
      proposed,
    );
    expect(saved.headers.get("Cache-Control")).toBe("no-store");
    planService.play.mockResolvedValue({ id: "run" });
    expect(
      (
        await action(
          args({
            intent: "play-plan",
            planId: "saved",
            revision: "2",
            plan: JSON.stringify({ ...proposed, name: "Forged" }),
          }),
        )
      ).status,
    ).toBe(200);
    expect(planService.play).toHaveBeenCalledWith(createUser().id, "saved", 2);
    planService.stop.mockResolvedValue({ id: "run" });
    await action(args({ intent: "stop-plan", runId: "run", userId: "forged" }));
    expect(planService.stop).toHaveBeenCalledWith(createUser().id, "run");
  });

  it("bounds inputs and sanitizes conflicts, native failures, unknown actions and methods", async () => {
    for (const revision of ["", "-1", "1.1", "Infinity"])
      expect(
        (await action(args({ intent: "play-plan", planId: "plan", revision })))
          .status,
      ).toBe(400);
    expect(
      (await action(args({ intent: "save-plan", plan: "x".repeat(2_000_001) })))
        .status,
    ).toBe(400);
    expect((await action(args({ intent: "unknown" }))).status).toBe(400);
    expect((await action(args({}, { method: "GET" }))).status).toBe(405);
    expect((await action(args({}, { user: false }))).status).toBe(403);
    planService.play.mockRejectedValueOnce(
      new AgentError("plan_workspace_conflict"),
    );
    expect(
      (
        await action(
          args({ intent: "play-plan", planId: "plan", revision: "1" }),
        )
      ).status,
    ).toBe(409);
    planService.save.mockRejectedValueOnce(
      new Error("synthetic-secret raw stack"),
    );
    expect(
      await (await action(args({ intent: "save-plan", plan: "{}" }))).text(),
    ).not.toContain("synthetic-secret");
  });
});
