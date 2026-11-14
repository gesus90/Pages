import path from "node:path";
import { createHash } from "node:crypto";

import { beforeEach, expect, it, vi } from "vitest";

import {
  prepareSharedAgentEnvironment,
  sharedPnpmBin,
} from "@/backend/agents/cli/AgentSharedEnvironment";
import { prepareClaudePlanSessionHome } from "@/backend/agents/cli/ClaudePlanSessionHome";
import {
  createCliEnvironment,
  createCliRequestEnvironment,
} from "@/backend/agents/cli/CliEnvironment";
import { CliPlanIsolation } from "@/backend/agents/cli/CliPlanIsolation";
import { AgentEnvironmentMaintenance } from "@/backend/storage/AgentEnvironmentMaintenance";
import { AgentToolFiles } from "@/backend/service/agents/tools/AgentToolFiles";
import { agentToolDefinition } from "@/backend/service/agents/tools/AgentToolRegistry";

import { environmentFiles as files } from "./page352-files";

import type { CliHome } from "@/backend/agents/cli/CliContracts";

const setup = vi.hoisted(() => ({ npm: vi.fn() }));
vi.mock("node:fs/promises", async () => {
  const { environmentFiles } = await import("./page352-files");
  return {
    ...environmentFiles.module(),
    realpath: async (location: string) => location,
  };
});
vi.mock("node:child_process", () => ({
  execFile: (
    file: string,
    args: string[],
    options: unknown,
    callback: (error: Error | null) => void,
  ) => {
    setup.npm(file, args, options);
    callback(null);
  },
}));
vi.mock("@/backend/agents/cli/CliSshConfigOverlay", () => ({
  sshConfigOverlayArguments: async () => [],
}));

const PLAN = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const NEXT = "33333333-3333-4333-8333-333333333333";
const SHARED = "/memory/data/shared-env";
const HOME: CliHome = {
  root: "/memory/data/agents/connection",
  home: "/memory/data/agents/connection/home",
  config: "/memory/data/agents/connection/claude",
  work: "/memory/data/agents/connection/work",
  sharedEnvironment: SHARED,
};

beforeEach(() => {
  files.reset();
  setup.npm.mockReset();
  files.seed(`${HOME.config}/.credentials.json`, "file");
});

it("reuses plan/scope homes across runs and native recovery, with shared caches for every provider", async () => {
  const first = await prepareClaudePlanSessionHome(HOME, {
    planId: PLAN,
    runId: RUN,
    scopeId: "node",
  });
  files.seed(`${first.home.config}/transcript.jsonl`, "file", "session");
  const second = await prepareClaudePlanSessionHome(HOME, {
    planId: PLAN,
    runId: NEXT,
    sourceRunId: RUN,
    scopeId: "node",
  });
  expect(second.home).toEqual(first.home);
  expect(files.entries.has(`${second.home.config}/transcript.jsonl`)).toBe(
    true,
  );
  for (const provider of [
    "claude_code",
    "codex_cli",
    "opencode",
    "antigravity",
  ] as const) {
    const environment = createCliEnvironment(
      second.home,
      provider,
      "/bin/agent",
      {},
    );
    expect(environment).toMatchObject({
      HOME: first.home.home,
      PNPM_HOME: `${SHARED}/pnpm`,
      npm_config_store_dir: `${SHARED}/pnpm-store`,
      XDG_CACHE_HOME: `${SHARED}/cache`,
      npm_config_cache: `${SHARED}/cache/npm`,
      npm_config_cache_dir: `${SHARED}/cache/pnpm`,
      PLAYWRIGHT_BROWSERS_PATH: `${SHARED}/cache/ms-playwright`,
      npm_config_manage_package_manager_versions: "false",
    });
    expect(environment.PATH.split(path.delimiter)[0]).toBe(
      sharedPnpmBin(SHARED),
    );
  }
  expect(
    [...files.entries.keys()].filter((location) =>
      location.startsWith(first.home.home),
    ),
  ).toEqual([first.home.home]);
  const other = await prepareClaudePlanSessionHome(HOME, {
    planId: PLAN,
    runId: NEXT,
    scopeId: "other",
  });
  expect(other.home.home).not.toBe(first.home.home);
});

it("provisions the pinned pnpm exactly once for simultaneous and successive workers", async () => {
  const root = "/memory/setup/shared-env";
  setup.npm.mockImplementation(() =>
    files.seed(`${sharedPnpmBin(root)}/pnpm`, "file"),
  );
  await Promise.all([
    prepareSharedAgentEnvironment(root),
    prepareSharedAgentEnvironment(root),
  ]);
  await prepareSharedAgentEnvironment(root);
  expect(setup.npm).toHaveBeenCalledOnce();
  expect(setup.npm.mock.calls[0]?.[1]).toContain("pnpm@11.23.0");
  expect(files.entries.has(`${sharedPnpmBin(root)}/pnpm`)).toBe(true);
  expect(files.entries.has(`${root}/pnpm-setup.lock`)).toBe(false);
});

it("binds the shared environment writable after protected instance folders are hidden", async () => {
  const isolation = new CliPlanIsolation(["/memory/data"], async () => true);
  const request = await isolation.isolate({
    file: "/bin/agent",
    arguments: [],
    provider: "claude_code",
    home: HOME,
    workingDirectory: "/workspace",
    environment: {},
    timeoutMs: 0,
    signal: new AbortController().signal,
    onLine: () => undefined,
  });
  const args = request?.arguments ?? [];
  expect(args.join(" ")).toContain(`--bind ${SHARED} ${SHARED}`);
  expect(args.indexOf(SHARED)).toBeGreaterThan(
    args.indexOf("--tmpfs", args.indexOf("/workspace")),
  );
});

it("sweeps ended legacy runs without a new start, empties completed homes and removes deleted plans on all connections", async () => {
  const scope = "a".repeat(64);
  for (const connection of ["one", "two"]) {
    files.seed(
      `/memory/data/agents/${connection}/plan-sessions/${RUN}/transcript`,
      "file",
    );
    files.seed(
      `/memory/data/agents/${connection}/plan-sessions/${NEXT}/transcript`,
      "file",
    );
    files.seed(
      `/memory/data/agents/${connection}/plan-homes/${PLAN}/${scope}/claude/transcript`,
      "file",
    );
  }
  const maintenance = new AgentEnvironmentMaintenance("/memory/data", {
    canRemoveRun: async (id) => id === RUN,
    maintainPlan: async (id, maintain) => {
      await maintain("empty");
    },
  });
  await maintenance.run();
  expect(
    [...files.entries.keys()].some((entry) =>
      entry.includes(`/plan-sessions/${RUN}`),
    ),
  ).toBe(false);
  expect(
    [...files.entries.keys()].filter((entry) => entry.endsWith("/transcript")),
  ).toHaveLength(2);
  expect(
    files.entries.has(
      `/memory/data/agents/one/plan-homes/${PLAN}/${scope}/claude`,
    ),
  ).toBe(true);
  const deletion = new AgentEnvironmentMaintenance("/memory/data", {
    canRemoveRun: async () => false,
    maintainPlan: async (id, maintain) => {
      await maintain("remove");
    },
  });
  await deletion.run();
  expect(
    [...files.entries.keys()].some((entry) =>
      entry.includes(`/plan-homes/${PLAN}`),
    ),
  ).toBe(false);
});

it("retains only current and previous tool releases", async () => {
  const root = "/memory/tools";
  files.seed(
    `${root}/antigravity_acp/active.json`,
    "file",
    JSON.stringify({ current: "1.4.4-new", previous: "1.4.4-old" }),
  );
  for (const release of ["1.4.4-new", "1.4.4-old", "1.4.4-abandoned"])
    files.seed(`${root}/antigravity_acp/releases/${release}/binary`, "file");
  await new AgentToolFiles(root).prune(agentToolDefinition("antigravity_acp"));
  expect(
    [...files.entries.keys()].filter((entry) => entry.endsWith("/binary")),
  ).toEqual([
    `${root}/antigravity_acp/releases/1.4.4-new/binary`,
    `${root}/antigravity_acp/releases/1.4.4-old/binary`,
  ]);
});

it("adopts native recovery transcripts from a legacy run and discards its private caches", async () => {
  const hash = createHash("sha256").update("legacy").digest("hex");
  const legacy = `${HOME.root}/plan-sessions/${RUN}/${hash}`;
  files.seed(`${legacy}/claude/transcript.jsonl`, "file", "history");
  files.seed(`${legacy}/home/cache/pnpm/store`, "file");
  files.seed(`${legacy}/home/data/pnpm/manager`, "file");
  const recovered = await prepareClaudePlanSessionHome(HOME, {
    planId: PLAN,
    runId: NEXT,
    sourceRunId: RUN,
    scopeId: "legacy",
  });
  expect(
    files.entries.get(`${recovered.home.config}/transcript.jsonl`)?.content,
  ).toBe("history");
  expect(
    [...files.entries.keys()].some((entry) => entry.startsWith(legacy)),
  ).toBe(false);
  expect(files.entries.has(`${recovered.home.home}/cache`)).toBe(false);
  expect(files.entries.has(`${recovered.home.home}/data/pnpm`)).toBe(false);
});

it("uses an already provisioned pinned pnpm after a process restart without invoking npm", async () => {
  const root = "/memory/restarted/shared-env";
  files.seed(`${sharedPnpmBin(root)}/pnpm`, "file");
  files.seed(
    `${path.dirname(path.dirname(sharedPnpmBin(root)))}/ready`,
    "file",
    "11.23.0",
  );
  await prepareSharedAgentEnvironment(root);
  expect(setup.npm).not.toHaveBeenCalled();
});

it("keeps pinned pnpm first when GitHub access prepends another binary directory", () => {
  const environment = createCliRequestEnvironment({
    home: HOME,
    provider: "claude_code",
    file: "/bin/agent",
    environment: { PATH: "/usr/bin:/bin", XDG_CACHE_HOME: "/private/cache" },
  });
  expect(environment.PATH.split(path.delimiter)[0]).toBe(sharedPnpmBin(SHARED));
  expect(environment.XDG_CACHE_HOME).toBe(`${SHARED}/cache`);
});
