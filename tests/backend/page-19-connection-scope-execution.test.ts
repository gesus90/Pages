import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentServices } from "@/app/lib/agent-services.server";
import { AgentPlanExecution } from "@/backend/agents/AgentPlanExecution";
import { AgentTextExecution } from "@/backend/agents/AgentTextExecution";
import { ScopedExecution } from "@/backend/agents/ScopedExecution";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";

import {
  connectionIdOf,
  createScopeHarness,
  textAgent,
} from "../helpers/connection-scope";
import { useMigratedDatabase } from "../helpers/test-database";

import type {
  ScopedConnectionKind,
  ScopeHarness,
} from "../helpers/connection-scope";

const SIGNAL = new AbortController().signal;
const KINDS: readonly ScopedConnectionKind[] = ["api", "cli"];

/** A resolved agent of the connection and a scope that admits only carol. */
async function restrictedAgent(h: ScopeHarness, kind: ScopedConnectionKind) {
  const connectionId = connectionIdOf(kind);
  const profileId = await h.profiles.save(
    h.admin,
    null,
    textAgent(connectionId, {
      name: `Agent on ${kind}`,
      targets: [{ kind: "person", targetId: h.carol.id }],
    }),
  );
  const agent = await h.profiles.resolve(h.carol.id, "text", profileId);
  await h.setScope(connectionId, {
    mode: "restricted",
    targets: [{ kind: "person", targetId: h.carol.id }],
  });
  return agent;
}

describe.each(KINDS)("PAGE-19 execution point of a %s connection", (kind) => {
  const getDatabase = useMigratedDatabase();

  it.each(["exclusive", "shared"] as const)(
    "keeps the text adapter behind the scope (%s lock)",
    async (lock) => {
      const h = await createScopeHarness(getDatabase());
      const agent = await restrictedAgent(h, kind);
      const api = { run: vi.fn(async () => "api answer") };
      const cli = { run: vi.fn(async () => "cli answer") };
      const execution = new ScopedExecution(
        new AgentTextExecution(api, cli, new AgentOperationRegistry(), lock),
        h.access,
      );
      await expect(
        execution.run({ agent, userId: h.bob.id, prompt: "Prompt" }, SIGNAL),
      ).rejects.toMatchObject({ code: "accessDenied" });
      expect(api.run).not.toHaveBeenCalled();
      expect(cli.run).not.toHaveBeenCalled();
      await expect(
        execution.run({ agent, userId: h.carol.id, prompt: "Prompt" }, SIGNAL),
      ).resolves.toBe(kind === "api" ? "api answer" : "cli answer");
      expect(api.run).toHaveBeenCalledTimes(kind === "api" ? 1 : 0);
      expect(cli.run).toHaveBeenCalledTimes(kind === "cli" ? 1 : 0);
    },
  );

  it("keeps the plan adapter and its start check behind the scope", async () => {
    const h = await createScopeHarness(getDatabase());
    const agent = await restrictedAgent(h, kind);
    const api = { run: vi.fn(async () => "api answer") };
    const cli = { run: vi.fn(async () => "cli answer") };
    const beforeStart = vi.fn(async () => undefined);
    const execution = new ScopedExecution(
      new AgentPlanExecution(api, cli, new AgentOperationRegistry()),
      h.access,
    );
    const input = {
      agent,
      prompt: "Prompt",
      directory: "/synthetic/work",
      beforeStart,
    };
    await expect(
      execution.run({ ...input, userId: h.bob.id }, SIGNAL),
    ).rejects.toMatchObject({ code: "accessDenied" });
    expect(api.run).not.toHaveBeenCalled();
    expect(cli.run).not.toHaveBeenCalled();
    expect(beforeStart).not.toHaveBeenCalled();
    await expect(
      execution.run({ ...input, userId: h.carol.id }, SIGNAL),
    ).resolves.toBe(kind === "api" ? "api answer" : "cli answer");
    // The CLI adapter performs its own start check; the API path runs it here.
    expect(beforeStart).toHaveBeenCalledTimes(kind === "api" ? 1 : 0);
  });
});

describe("PAGE-19 production wiring", () => {
  const getDatabase = useMigratedDatabase();
  const directories: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const directory of directories.splice(0))
      rmSync(directory, { force: true, recursive: true });
  });

  it("puts text, chat and plan execution of the application behind the scope", async () => {
    const h = await createScopeHarness(getDatabase());
    const directory = mkdtempSync(path.join(tmpdir(), "page19-agents-"));
    directories.push(directory);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const services = createAgentServices(
      getDatabase(),
      directory,
      Buffer.alloc(32, 7),
      path.join(directory, "Agents"),
    );
    const before = readdirSync(directory);
    for (const kind of KINDS) {
      const agent = await restrictedAgent(h, kind);
      for (const execution of [
        services.agentTextExecution,
        services.agentChatExecution,
      ])
        await expect(
          execution.run({ agent, userId: h.bob.id, prompt: "Prompt" }, SIGNAL),
        ).rejects.toMatchObject({ code: "accessDenied" });
      await expect(
        services.agentPlanExecution.run(
          { agent, userId: h.bob.id, prompt: "Prompt", directory: null },
          SIGNAL,
        ),
      ).rejects.toMatchObject({ code: "accessDenied" });
      // An unknown executor is refused as well, not treated as a system call.
      await expect(
        services.agentTextExecution.run(
          { agent, userId: "", prompt: "Prompt" },
          SIGNAL,
        ),
      ).rejects.toMatchObject({ code: "accessDenied" });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(readdirSync(directory)).toEqual(before);
  });
});
