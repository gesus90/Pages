import path from "node:path";

import { beforeEach, expect, it, vi } from "vitest";

import {
  prepareSharedAgentEnvironment,
  sharedAgentEnvironment,
  sharedPnpmBin,
} from "@/backend/agents/cli/AgentSharedEnvironment";
import { createCliRequestEnvironment } from "@/backend/agents/cli/CliEnvironment";
import { scriptEnvironment } from "@/backend/service/agents/AgentPlanScriptResources";

import { environmentFiles as files } from "./page352-files";

const SHARED = "/memory/page416/shared-env";
const boundary = vi.hoisted(() => ({ npm: vi.fn() }));
vi.mock("node:fs/promises", async () => {
  const { environmentFiles } = await import("./page352-files");
  return environmentFiles.module();
});
vi.mock("node:child_process", () => ({
  execFile: (
    file: string,
    args: string[],
    options: unknown,
    callback: (error: Error | null) => void,
  ) => {
    boundary.npm(file, args, options);
    callback(null);
  },
}));

beforeEach(() => {
  files.reset();
  boundary.npm.mockReset();
});

it("sets pnpm 11 settings, legacy aliases and the global virtual store without moving the existing store", () => {
  const environment = sharedAgentEnvironment(SHARED);
  expect(environment).toEqual({
    pnpm_config_store_dir: `${SHARED}/pnpm/store`,
    pnpm_config_cache_dir: `${SHARED}/cache/pnpm`,
    pnpm_config_state_dir: `${SHARED}/state/pnpm`,
    pnpm_config_global_dir: `${SHARED}/pnpm/global`,
    pnpm_config_enable_global_virtual_store: "true",
    npm_config_store_dir: `${SHARED}/pnpm/store`,
    npm_config_cache_dir: `${SHARED}/cache/pnpm`,
    npm_config_state_dir: `${SHARED}/state/pnpm`,
    npm_config_global_dir: `${SHARED}/pnpm/global`,
    npm_config_cache: `${SHARED}/cache/npm`,
    npm_config_manage_package_manager_versions: "false",
    PNPM_HOME: `${SHARED}/pnpm`,
    XDG_CACHE_HOME: `${SHARED}/cache`,
    PLAYWRIGHT_BROWSERS_PATH: `${SHARED}/cache/ms-playwright`,
  });
});

it("forwards the store and virtual linking settings to agent requests despite supplied overrides", () => {
  const environment = createCliRequestEnvironment({
    home: {
      root: "/memory/connection",
      home: "/memory/connection/home",
      config: "/memory/connection/codex",
      work: "/memory/connection/work",
      sharedEnvironment: SHARED,
    },
    provider: "codex_cli",
    file: "/bin/agent",
    environment: {
      pnpm_config_store_dir: "/old-store",
      pnpm_config_enable_global_virtual_store: "false",
      PATH: "/bin",
    },
  });
  expect(environment).toMatchObject(sharedAgentEnvironment(SHARED));
  expect(environment.PATH.split(path.delimiter)[0]).toBe(sharedPnpmBin(SHARED));
});

it("shares script packages and browsers while retaining private HOME and remaining XDG directories", () => {
  vi.stubEnv("PROVIDER_API_KEY", "synthetic-secret");
  const environment = scriptEnvironment({
    directory: "/memory/run",
    interpreter: "/bin/node",
    instanceId: "instance",
    sharedEnvironment: SHARED,
  });
  expect(environment).toMatchObject(sharedAgentEnvironment(SHARED));
  expect(environment).toMatchObject({
    HOME: "/memory/run",
    TMPDIR: "/memory/run",
    XDG_CONFIG_HOME: "/memory/run/config",
    XDG_DATA_HOME: "/memory/run/data",
    XDG_STATE_HOME: "/memory/run/state",
  });
  expect(environment.PATH.split(path.delimiter).slice(0, 2)).toEqual([
    sharedPnpmBin(SHARED),
    `${SHARED}/pnpm`,
  ]);
  expect(environment).not.toHaveProperty("PROVIDER_API_KEY");
});

it.each(["absent", "empty", "populated", "link"])(
  "prepares the existing store and treats an obsolete %s pnpm-store safely",
  async (kind) => {
    const root = `${SHARED}/${kind}`;
    files.seed(`${sharedPnpmBin(root)}/pnpm`, "file");
    files.seed(
      `${path.dirname(path.dirname(sharedPnpmBin(root)))}/ready`,
      "file",
    );
    if (kind === "empty") files.seed(`${root}/pnpm-store`);
    if (kind === "populated") files.seed(`${root}/pnpm-store/retained`, "file");
    if (kind === "link") files.seed(`${root}/pnpm-store`, "link");
    await prepareSharedAgentEnvironment(root);
    expect(files.entries.has(`${root}/pnpm/store`)).toBe(true);
    expect(files.entries.has(`${root}/pnpm-store`)).toBe(
      kind === "populated" || kind === "link",
    );
    expect(boundary.npm).not.toHaveBeenCalled();
  },
);

it("preserves the existing private environment of standalone automation scripts", () => {
  const environment = scriptEnvironment({
    directory: "/memory/automation",
    interpreter: "/bin/node",
    instanceId: "automation",
  });
  expect(environment.HOME).toBe("/memory/automation");
  expect(environment.XDG_CACHE_HOME).toBe("/memory/automation/cache");
  expect(environment).not.toHaveProperty("pnpm_config_store_dir");
});
