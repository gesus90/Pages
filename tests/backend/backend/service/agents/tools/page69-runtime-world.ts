import { vi } from "vitest";

import { CliSessionExecution } from "@/backend/agents/cli/CliSessionExecution";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { acpRunOptions } from "@/definition/AgentConfiguration";

import { fakeCliSpawn } from "../../../agents/cli/fake-cli-spawn";
import { toolWorld } from "./page69-tool-world";

import type { FakeAdapterOptions } from "../../../agents/acp/fake-acp-adapter";
import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { CliToolAdapter } from "@/backend/agents/cli/CliContracts";

/** Synthetic saved account and exact selected model, never a real login. */
export function toolSessionInput(): AgentPlanSessionInput {
  return {
    userId: "owner",
    instanceId: "managed-session",
    directory: "/memory/workspace",
    prompt: "Exact synthetic prompt",
    mcp: null,
    options: acpRunOptions("read_only", 0),
    agent: {
      model: "gpt-synthetic",
      reasoningEffort: "high",
      connection: {
        id: "connection",
        name: "Codex",
        provider: "codex_cli",
        isActive: true,
        hasApiKey: false,
        testModel: null,
        reasoningEffort: null,
        cliLoggedInAt: "2026-10-16",
        cliAccountLabel: "synthetic",
        updatedAt: "2026-10-16",
      },
    },
  };
}

/** Existing ACP engine with mocked filesystem, credentials, installation and process boundaries. */
export function toolRuntimeWorld(
  options: FakeAdapterOptions = {},
  probe: () => Promise<boolean> = async () => true,
): {
  readonly world: ReturnType<typeof toolWorld>;
  readonly execution: CliSessionExecution;
  readonly fake: ReturnType<typeof fakeCliSpawn>;
  readonly prepare: ReturnType<typeof vi.fn>;
  readonly secure: ReturnType<typeof vi.fn>;
} {
  const world = toolWorld();
  const fake = fakeCliSpawn(options);
  const prepare = vi.fn(async () => ({
    root: "/memory/credentials",
    home: "/memory/credentials/home",
    config: "/memory/credentials/codex",
    work: "/memory/credentials/work",
  }));
  const secure = vi.fn(async () => undefined);
  const adapter: CliToolAdapter = {
    provider: "codex_cli",
    version: async () => ({ ok: true, detail: {} }),
    readStatus: async () => ({
      outcome: { ok: true, detail: {} },
      accountLabel: null,
    }),
    runTest: async () => ({ ok: true, detail: {} }),
    listModels: async () => [],
    logout: async () => ({ ok: true, detail: {} }),
  };
  const execution = new CliSessionExecution({
    tools: world.manager,
    runtime: { adapter: async () => adapter },
    store: { prepare, secure },
    locator: {
      find: async () => ({ found: false, path: null }),
      locate: async () => ({ found: false, path: null }),
    },
    runner: new CliProcessRunner({
      spawn: fake.spawn,
      signalGroup: fake.signalGroup,
    }),
    isolation: {
      protectedDirectories: ["/memory/instance"],
      isRequired: false,
      probe,
    },
  });
  return { world, execution, fake, prepare, secure };
}
