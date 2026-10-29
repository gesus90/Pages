import { beforeEach, expect, it, vi } from "vitest";

import {
  antigravityContextBinding,
  boundAntigravityHome,
  requireBoundAntigravityHome,
} from "@/backend/agents/cli/AntigravityContextBinding";
import { createCliEnvironment } from "@/backend/agents/cli/CliEnvironment";
import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";

const files = vi.hoisted(() => ({ lstat: vi.fn(), rm: vi.fn() }));
vi.mock("node:fs/promises", () => files);

const ID = "10000000-0000-4000-8000-000000000001";
const binding = { connectionId: ID, root: "/private/context" };

beforeEach(() => {
  files.lstat.mockReset();
  files.rm.mockReset();
  files.lstat.mockResolvedValue({
    isDirectory: () => true,
    isSymbolicLink: () => false,
    uid: process.getuid?.() ?? 0,
    mode: 0o700,
  });
});

it("binds only the selected connection and never deletes its context", async () => {
  const store = new AgentCredentialStore("/private/pages", undefined, binding);
  expect(store.isBound(ID, "antigravity")).toBe(true);
  expect(store.isBound(ID, "codex_cli")).toBe(false);
  expect(
    store.isBound("10000000-0000-4000-8000-000000000002", "antigravity"),
  ).toBe(false);
  await expect(store.prepare(ID, "antigravity")).resolves.toEqual(
    boundAntigravityHome(binding),
  );
  await store.secure(ID, "antigravity");
  await store.remove(ID, "antigravity");
  expect(files.rm).not.toHaveBeenCalled();
});

it("requires both operator settings and preserves the dedicated XDG paths", () => {
  expect(antigravityContextBinding({})).toBeNull();
  expect(() =>
    antigravityContextBinding({
      PAGES_ANTIGRAVITY_CONNECTION_ID: ID,
      PAGES_ANTIGRAVITY_CONTEXT_ROOT: "/private/context/",
    }),
  ).toThrow();
  expect(() =>
    antigravityContextBinding({ PAGES_ANTIGRAVITY_CONNECTION_ID: ID }),
  ).toThrow();
  const selected = antigravityContextBinding({
    PAGES_ANTIGRAVITY_CONNECTION_ID: ID,
    PAGES_ANTIGRAVITY_CONTEXT_ROOT: binding.root,
  });
  expect(selected).toEqual(binding);
  const home = boundAntigravityHome(binding);
  const environment = createCliEnvironment(home, "antigravity", "/adapter", {});
  expect(environment.GEMINI_HOME).toBe("/private/context/gemini");
  expect(environment.XDG_CONFIG_HOME).toBe("/private/context/config");
  expect(environment.XDG_CACHE_HOME).toBe("/private/context/work");
});

it("rejects writable ancestors, symlinks and contexts owned by another account", async () => {
  const home = boundAntigravityHome(binding);
  await expect(requireBoundAntigravityHome(home)).resolves.toBeUndefined();
  files.lstat.mockResolvedValueOnce({
    isDirectory: () => true,
    isSymbolicLink: () => false,
    uid: process.getuid?.() ?? 0,
    mode: 0o775,
  });
  await expect(requireBoundAntigravityHome(home)).rejects.toMatchObject({
    code: "antigravity_configuration_unmanaged",
  });
  files.lstat.mockResolvedValueOnce({
    isDirectory: () => true,
    isSymbolicLink: () => true,
    uid: process.getuid?.() ?? 0,
    mode: 0o700,
  });
  await expect(requireBoundAntigravityHome(home)).rejects.toMatchObject({
    code: "antigravity_configuration_unmanaged",
  });
  files.lstat.mockResolvedValueOnce({
    isDirectory: () => true,
    isSymbolicLink: () => false,
    uid: 90001,
    mode: 0o700,
  });
  await expect(requireBoundAntigravityHome(home)).rejects.toMatchObject({
    code: "antigravity_configuration_unmanaged",
  });
});
