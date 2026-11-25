import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  InterpreterProfiles,
  InterpreterSettingsError,
} from "./InterpreterProfiles";

import type { ConfigFile } from "@/backend/config/ConfigFile";
import type {
  InterpreterProfile,
  InterpreterSnapshot,
} from "@/definition/InterpreterProfile";

const state = vi.hoisted(() => {
  const located: Record<string, string | null> = {};
  const managed: {
    id: string;
    name: string;
    path: string;
    version: string;
  }[] = [];
  return { located, managed, check: vi.fn() };
});

vi.mock("@/backend/agents/cli/CliLocator", () => ({
  CliLocator: class {
    public locate = async (
      binary: string,
    ): Promise<{ path: string | null }> => ({
      path: state.located[binary] ?? null,
    });
  },
}));
vi.mock("@/backend/service/agents/tools/AgentToolRuntimePaths", () => ({
  managedInterpreterProfiles: async (): Promise<unknown[]> => state.managed,
}));
vi.mock("./InterpreterVersionCheck", () => ({
  checkInterpreterVersion: state.check,
}));

let config: { interpreterProfiles?: InterpreterProfile[] } | null;
let racing: boolean;

const configFile = {
  read: async () => config,
  update: async (change: (value: object) => object) => {
    if (racing)
      config = {
        interpreterProfiles: [{ id: "node", name: "N", path: "/other" }],
      };
    config = change(config ?? {});
  },
} as unknown as ConfigFile;

const profile = (id: string, program: string): InterpreterProfile => ({
  id,
  name: id.toUpperCase(),
  path: program,
});
const python = profile("python3", "/p/python3");
const bash = profile("bash", "/p/bash");
const node = profile("node", "/p/node");
const all = [python, bash, node];

beforeEach(() => {
  config = null;
  racing = false;
  state.managed = [];
  state.located = { python3: "/p/python3", bash: "/p/bash", node: "/p/node" };
  state.check.mockReset();
  state.check.mockImplementation(async (program: string) => ({
    path: program,
    status: "ok",
    version: "1.0",
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("InterpreterProfiles.snapshot", () => {
  it("checks the located defaults once", async () => {
    const profiles = new InterpreterProfiles(configFile);
    const snapshot = await profiles.snapshot();
    await profiles.snapshot();
    expect(snapshot.profiles.map((entry) => entry.path)).toEqual(
      all.map((entry) => entry.path),
    );
    expect(Object.keys(snapshot.checks)).toEqual(["python3", "bash", "node"]);
    expect(snapshot.revision).toMatch(/^[0-9a-f]{64}$/u);
    expect(state.check).toHaveBeenCalledTimes(3);
  });

  it("falls back to the first absolute PATH directory or the node directory", async () => {
    state.located = {};
    vi.stubEnv("PATH", ["relative", "/abs/bin"].join(path.delimiter));
    expect(
      (await new InterpreterProfiles(configFile).snapshot()).profiles[0]?.path,
    ).toBe("/abs/bin/python3");
    vi.stubEnv("PATH", "relative");
    expect(
      (await new InterpreterProfiles(configFile).snapshot()).profiles[1]?.path,
    ).toBe(path.join(path.dirname(process.execPath), "bash"));
    vi.stubEnv("PATH", "");
    delete process.env.PATH;
    expect(
      (await new InterpreterProfiles(configFile).snapshot()).profiles[2]?.path,
    ).toBe(path.join(path.dirname(process.execPath), "node"));
  });

  it("uses saved profiles and omits unchecked paths", async () => {
    config = { interpreterProfiles: [profile("custom", "/c/tool")] };
    const profiles = new InterpreterProfiles(configFile);
    await profiles.initialize();
    state.check.mockClear();
    config = {
      interpreterProfiles: [
        profile("custom", "/c/tool"),
        profile("other", "/c/other"),
      ],
    };
    const snapshot = await profiles.snapshot();
    expect(Object.keys(snapshot.checks)).toEqual(["custom"]);
  });

  it("uses defaults when the configuration has no file", async () => {
    config = {};
    expect(
      (await new InterpreterProfiles(configFile).snapshot()).profiles,
    ).toHaveLength(3);
  });
});

describe("InterpreterProfiles.runtimeSnapshot", () => {
  it("replaces profiles by managed runtimes", async () => {
    state.managed = [
      { id: "node", name: "Managed", path: "/m/node", version: "22" },
      { id: "ruby", name: "Ruby", path: "/m/ruby", version: "3" },
    ];
    const snapshot = await new InterpreterProfiles(
      configFile,
    ).runtimeSnapshot();
    expect(snapshot.profiles.map((entry) => entry.path)).toEqual([
      "/p/python3",
      "/p/bash",
      "/m/node",
      "/m/ruby",
    ]);
    expect(snapshot.checks.node).toEqual({
      path: "/m/node",
      status: "ok",
      version: "22",
    });
    expect(snapshot.managed).toBe(state.managed);
  });
});

describe("InterpreterProfiles.save", () => {
  async function saved(
    input: unknown,
    expected?: string,
  ): Promise<InterpreterSnapshot> {
    const profiles = new InterpreterProfiles(configFile);
    const { revision } = await profiles.snapshot();
    return profiles.save(input, expected ?? revision);
  }

  it("rejects invalid input, stale revisions and removed profiles", async () => {
    await expect(saved("x")).rejects.toMatchObject({ code: "invalid" });
    await expect(saved(all, "stale")).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(
      saved([python, bash, profile("extra", "/p/extra")]),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("rejects profiles that fail the version check, naming the observations", async () => {
    state.check.mockImplementation(async (program: string) => ({
      path: program,
      status: "error",
      version: null,
      error: "missing",
    }));
    const error = await saved([profile("python3", "/p/new"), bash, node]).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(InterpreterSettingsError);
    expect(error).toMatchObject({
      code: "unchecked",
      checks: { python3: { error: "missing" } },
    });
  });

  it("writes changed profiles and returns the new snapshot", async () => {
    const result = await saved([profile("python3", "/p/new"), bash, node]);
    expect(config?.interpreterProfiles?.[0]?.path).toBe("/p/new");
    expect(result.profiles[0]?.path).toBe("/p/new");
    expect(state.check).toHaveBeenCalledWith("/p/new");
  });

  it("detects a concurrent edit during the write", async () => {
    racing = true;
    await expect(
      saved([profile("python3", "/p/new"), bash, node]),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("writes over a configuration without profiles", async () => {
    config = {};
    await saved([profile("python3", "/p/new"), bash, node]);
    expect(config?.interpreterProfiles).toHaveLength(3);
  });
});

describe("InterpreterProfiles.check", () => {
  it("records an observation without writing configuration", async () => {
    const result = await new InterpreterProfiles(configFile).check("/x");
    expect(result).toMatchObject({ path: "/x", status: "ok" });
  });
});

describe("InterpreterSettingsError", () => {
  it("defaults to no observations", () => {
    expect(new InterpreterSettingsError("invalid").checks).toEqual({});
  });
});
