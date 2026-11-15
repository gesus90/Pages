import os from "node:os";
import path from "node:path";

import { beforeEach, expect, it, vi } from "vitest";

import {
  createScriptResources,
  scriptRuntimeDirectory,
  scriptRuntimeRoot,
} from "@/backend/service/agents/AgentPlanScriptResources";

const files = vi.hoisted(() => ({
  mkdir: vi.fn(),
  lstat: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
}));
vi.mock("node:fs/promises", () => files);

const INSTANCE = "20000000-0000-4000-8000-000000000002";
const HOME = "/synthetic/home";

function folder(isLink = false): object {
  return {
    isDirectory: () => true,
    isSymbolicLink: () => isLink,
    uid: process.getuid?.(),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  for (const mock of Object.values(files)) mock.mockReset();
  vi.spyOn(os, "homedir").mockReturnValue(HOME);
  vi.spyOn(os, "tmpdir").mockReturnValue("/private-service-tmp");
});

it("keeps script runtimes in the account's home, not in the private /tmp of the plan service", () => {
  expect(scriptRuntimeRoot()).toBe(
    path.join(HOME, ".local", "state", "pages", "plan-scripts"),
  );
  expect(scriptRuntimeDirectory(INSTANCE)).toBe(
    path.join(scriptRuntimeRoot(), `pages-plan-script-${INSTANCE}`),
  );
  expect(scriptRuntimeDirectory(INSTANCE)).not.toContain(
    "/private-service-tmp",
  );
});

it("creates the private root before the runtime of one attempt", async () => {
  files.lstat.mockResolvedValue(folder());
  const directory = await createScriptResources(INSTANCE, "script");
  expect(directory).toBe(scriptRuntimeDirectory(INSTANCE));
  expect(files.mkdir).toHaveBeenNthCalledWith(1, scriptRuntimeRoot(), {
    recursive: true,
    mode: 0o700,
  });
  expect(files.mkdir).toHaveBeenNthCalledWith(2, directory, { mode: 0o700 });
  expect(files.writeFile).toHaveBeenCalledWith(
    path.join(directory, "script.cjs"),
    "script",
    { mode: 0o600, flag: "wx" },
  );
});

it("refuses a root that is a link instead of the account's own folder", async () => {
  files.lstat.mockResolvedValue(folder(true));
  await expect(createScriptResources(INSTANCE, "script")).rejects.toThrow(
    "The script runtime root is not a private directory",
  );
  expect(files.mkdir).toHaveBeenCalledOnce();
  expect(files.writeFile).not.toHaveBeenCalled();
});
