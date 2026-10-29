import { beforeEach, expect, it, vi } from "vitest";

import { requireManagedAntigravityConfiguration } from "@/backend/agents/acp/AntigravityConfiguration";

const files = vi.hoisted(() => ({
  paths: new Set<string>(),
  content: "{}",
  isSymlink: false,
  readFile: vi.fn(async () => files.content),
  lstat: vi.fn(async (file: string) => {
    if (!files.paths.has(file))
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return {
      isFile: () => true,
      isSymbolicLink: () => files.isSymlink,
      size: files.content.length,
    };
  }),
}));
vi.mock("node:fs/promises", () => ({
  lstat: files.lstat,
  readFile: files.readFile,
}));
const HOME = {
  root: "/test",
  home: "/test/home",
  config: "/test/gemini",
  work: "/test/work",
};

beforeEach(() => {
  files.paths.clear();
  files.content = "{}";
  files.isSymlink = false;
  files.readFile.mockClear();
});

it("accepts a fresh connection or only the adapter's personal auth setting", async () => {
  await expect(
    requireManagedAntigravityConfiguration(HOME),
  ).resolves.toBeUndefined();
  files.paths.add("/test/gemini/antigravity-acp/settings.json");
  files.content = JSON.stringify({ auth: { type: "oauth-personal" } });
  await expect(
    requireManagedAntigravityConfiguration(HOME),
  ).resolves.toBeUndefined();
});

it.each([
  "/test/gemini/config",
  "/test/gemini/antigravity-cli",
  "/test/work/.agents/hooks.json",
  "/test/work/_agent/hooks.json",
])(
  "refuses executable configuration at %s without reading it",
  async (file) => {
    files.paths.add(file);
    await expect(
      requireManagedAntigravityConfiguration(HOME),
    ).rejects.toMatchObject({ code: "antigravity_configuration_unmanaged" });
    expect(files.readFile).not.toHaveBeenCalled();
  },
);

it.each([
  "{}",
  '{"auth":{"type":"gemini-api-key"}}',
  '{"auth":{"type":"oauth-personal"},"mcpServers":{}}',
  "broken",
])("refuses malformed or widening settings %s", async (content) => {
  files.paths.add("/test/gemini/antigravity-acp/settings.json");
  files.content = content;
  await expect(
    requireManagedAntigravityConfiguration(HOME),
  ).rejects.toMatchObject({ code: "antigravity_configuration_unmanaged" });
});

it("refuses a settings symlink", async () => {
  files.paths.add("/test/gemini/antigravity-acp/settings.json");
  files.isSymlink = true;
  await expect(
    requireManagedAntigravityConfiguration(HOME),
  ).rejects.toMatchObject({ code: "antigravity_configuration_unmanaged" });
  expect(files.readFile).not.toHaveBeenCalled();
});
