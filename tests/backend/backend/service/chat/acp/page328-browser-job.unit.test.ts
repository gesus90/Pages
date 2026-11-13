import { afterEach, expect, it, vi } from "vitest";

import { AgentBrowserService } from "@/backend/service/chat/browser/AgentBrowserService";
import { PicaAcpSessionPool } from "@/backend/service/chat/acp/PicaAcpSessionPool";

import { FIRST } from "../page48-chat-fixture";
import { completedTurn, PicaJobWorld } from "./page103-job-fixture";

import { browserWorld, runtimeFiles } from "../browser/page328-browser-world";

import type { PicaAcpJobPool } from "@/backend/service/chat/acp/PicaAcpPoolOpening";

vi.mock("@/backend/runtime/ProcessLifecycle", () => ({
  registerShutdownTask: vi.fn(),
}));

afterEach(() => vi.useRealTimers());

/** Real browser authority for a job whose runner is the in-memory fixture. */
function serviceWorld(): {
  readonly service: AgentBrowserService;
  readonly world: ReturnType<typeof browserWorld>;
} {
  const world = browserWorld();
  const service = new AgentBrowserService(world.sessions, {
    origins: () => ({ pages: world.accounts.origins(), services: [] }),
  });
  return { service, world };
}

it.each(["completed", "stopped", "failed"] as const)(
  "prepares private Playwright state and revokes it when the real job is %s",
  async (outcome) => {
    const { service, world } = serviceWorld();
    const job = new PicaJobWorld("codex_cli", null, {
      agentBrowsers: service,
      actor: world.user,
    });
    const { completion } = await job.start();
    const input = job.opened.mock.calls[0][0];
    const directory = input.chat?.browserStateDirectory;
    expect(directory).toContain("pages-agent-browser-");
    expect(directory?.startsWith(input.directory + "/")).toBe(false);
    expect(input.prompt).toContain(`${directory}/storage-state.json`);
    expect(runtimeFiles.contents.has(`${directory}/storage-state.json`)).toBe(
      true,
    );
    expect(job.catalog.map((tool) => tool.id)).toContain("browser_open");
    if (outcome === "stopped") {
      job.job.stop();
      job.controller.abort();
    } else if (outcome === "failed")
      job.complete({
        ...completedTurn(),
        failure: "failed",
        errorCode: "provider_unavailable",
      });
    else job.complete();
    await completion;
    expect(job.finish).toHaveBeenCalledWith(
      "job",
      outcome,
      outcome === "failed" ? "provider_unavailable" : null,
    );
    expect(runtimeFiles.contents.has(`${directory}/storage-state.json`)).toBe(
      false,
    );
    await world.sessions.close();
  },
);

it("renews the private state while retaining the native session between two jobs", async () => {
  const { service, world } = serviceWorld();
  const pool = new PicaAcpSessionPool({ idleMinutes: async () => 10 });
  const kept: PicaAcpJobPool = {
    sessions: pool,
    session: {
      chatSessionId: FIRST,
      agentId: world.user.id,
      agentName: world.user.displayName,
      conversation: "Chat",
      fingerprint: "same",
    },
  };
  const first = new PicaJobWorld(
    "claude_code",
    null,
    { agentBrowsers: service, actor: world.user },
    kept,
  );
  const { completion } = await first.start();
  const directory = first.opened.mock.calls[0][0].chat?.browserStateDirectory;
  const state = runtimeFiles.contents.get(`${directory}/storage-state.json`);
  first.complete();
  await completion;
  expect(runtimeFiles.contents.has(`${directory}/storage-state.json`)).toBe(
    false,
  );
  expect(first.close).not.toHaveBeenCalled();
  const second = new PicaJobWorld(
    "claude_code",
    "native-session",
    { agentBrowsers: service, actor: world.user },
    kept,
  );
  await second.job.run(second.controller.signal);
  expect(second.opened).not.toHaveBeenCalled();
  expect(runtimeFiles.writeFile.mock.calls.at(-1)?.[1]).not.toBe(state);
  expect(runtimeFiles.contents.has(`${directory}/storage-state.json`)).toBe(
    false,
  );
  await pool.closeAll();
  await world.sessions.close();
});

vi.mock(
  "node:fs/promises",
  async () => (await import("../browser/page328-browser-files")).runtimeFiles,
);
