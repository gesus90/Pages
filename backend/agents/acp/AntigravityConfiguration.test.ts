import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { requireManagedAntigravityConfiguration } from "@/backend/agents/acp/AntigravityConfiguration";
import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import type * as FileSystem from "node:fs/promises";
import type { CliHome } from "@/backend/agents/cli/CliContracts";

/** A path suffix whose `lstat` fails, and the rejection it fails with. */
const injected = vi.hoisted(
  (): { suffix: string | null; rejection: unknown } => ({
    suffix: null,
    rejection: null,
  }),
);

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystem>();
  return {
    ...actual,
    lstat: (file: string, ...rest: never[]) =>
      injected.suffix !== null && file.endsWith(injected.suffix)
        ? Promise.reject(injected.rejection)
        : actual.lstat(file, ...rest),
  };
});

const ROOT = pagesTempDirectory("antigravity-configuration-test");
let base = "";
let home: CliHome;

beforeEach(async () => {
  await mkdir(ROOT, { recursive: true });
  base = await mkdtemp(path.join(ROOT, "case-"));
  home = {
    root: base,
    home: base,
    config: path.join(base, "config-home"),
    work: path.join(base, "work"),
  };
  await mkdir(home.config, { recursive: true });
  await mkdir(home.work, { recursive: true });
  injected.suffix = null;
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

async function put(relative: string, text: string): Promise<void> {
  const file = path.join(home.config, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

function refused(directory?: string): Promise<void> {
  return expect(
    requireManagedAntigravityConfiguration(home, directory),
  ).rejects.toMatchObject({ code: "antigravity_configuration_unmanaged" });
}

function accepted(directory?: string): Promise<void> {
  return expect(
    requireManagedAntigravityConfiguration(home, directory),
  ).resolves.toBeUndefined();
}

it("accepts a clean context and workspace", async () => {
  await accepted();
  await accepted(path.join(base, "elsewhere"));
});

it("refuses an application folder that is a file or a link", async () => {
  await put("antigravity-acp", "");
  await refused();
  await rm(path.join(home.config, "antigravity-acp"));
  await symlink(home.work, path.join(home.config, "antigravity-acp"));
  await refused();
});

it("accepts an application folder that is a directory", async () => {
  await mkdir(path.join(home.config, "antigravity-acp"));
  await accepted();
});

it("refuses every unexpected failure of a file check", async () => {
  const error = Object.assign(new Error("denied"), { code: "EACCES" });
  const checks = [
    "antigravity-acp",
    "config-home/config",
    "config-home/antigravity-cli",
    "antigravity-acp/hooks.json",
    "antigravity-acp/mcp_config.json",
    "work/.agents/hooks.json",
    "antigravity-acp/settings.json",
  ];
  for (const check of checks) {
    injected.suffix = check;
    injected.rejection = error;
    await refused();
  }
});

it("treats a failure without an error code or without an error as unexpected", async () => {
  injected.suffix = "antigravity-cli";
  injected.rejection = new Error("plain");
  await refused();
  injected.rejection = "text";
  await refused();
});

it("accepts the default content of the global config folder", async () => {
  await mkdir(path.join(home.config, "config", "projects"), {
    recursive: true,
  });
  await put("config/.migrated", "");
  await put("config/config.json", "{}");
  await put("config/mcp_config.json", " ");
  await accepted();
  await put(
    "config/config.json",
    JSON.stringify({ plugins: { swarm: { enabled: false } } }),
  );
  await put("config/mcp_config.json", "{}");
  await accepted();
  await put("config/mcp_config.json", '{"mcpServers":{}}');
  await accepted();
});

it("refuses a global config folder that is a file or a link", async () => {
  await put("config", "");
  await refused();
  await rm(path.join(home.config, "config"));
  await symlink(home.work, path.join(home.config, "config"));
  await refused();
});

it("refuses a config entry that is not a known default", async () => {
  await put("config/other.txt", "x");
  await refused();
  await rm(path.join(home.config, "config", "other.txt"));
  await mkdir(path.join(home.config, "config", ".migrated"));
  await refused();
});

it("refuses a config entry that vanished while reading", async () => {
  await put("config/config.json", "{}");
  injected.suffix = "config/config.json";
  injected.rejection = Object.assign(new Error("gone"), { code: "ENOENT" });
  await refused();
});

it("refuses a projects entry that is a file", async () => {
  await put("config/projects", "x");
  await refused();
});

it("refuses a config file that is too large", async () => {
  await put("config/config.json", " ".repeat(70_000));
  await refused();
});

it("refuses a config.json beyond the built-in plugin switches", async () => {
  const documents = [
    "not json",
    "[]",
    '{"other":1}',
    '{"plugins":{},"other":1}',
    '{"plugins":[]}',
    '{"plugins":{"evil":{"enabled":true}}}',
    '{"plugins":{"swarm":true}}',
    '{"plugins":{"swarm":{"enabled":true,"extra":1}}}',
    '{"plugins":{"swarm":{"enabled":"yes"}}}',
  ];
  for (const document of documents) {
    await put("config/config.json", document);
    await refused();
  }
});

it("refuses an mcp_config.json that names a server or cannot be read", async () => {
  const documents = [
    "not json",
    "[]",
    '{"mcpServers":{"a":{}}}',
    '{"other":1}',
    '{"mcpServers":{},"other":1}',
  ];
  for (const document of documents) {
    await put("config/mcp_config.json", document);
    await refused();
  }
});

it("refuses a print-mode folder and application hooks or MCP servers", async () => {
  await mkdir(path.join(home.config, "antigravity-cli"));
  await refused();
  await rm(path.join(home.config, "antigravity-cli"), { recursive: true });
  await put("antigravity-acp/hooks.json", "{}");
  await refused();
  await rm(path.join(home.config, "antigravity-acp", "hooks.json"));
  await put("antigravity-acp/mcp_config.json", "{}");
  await refused();
});

it("refuses hooks in every workspace folder", async () => {
  for (const folder of [".agents", ".agent", "_agents", "_agent"]) {
    const hooks = path.join(home.work, folder, "hooks.json");
    await mkdir(path.dirname(hooks), { recursive: true });
    await writeFile(hooks, "{}");
    await refused();
    await rm(path.dirname(hooks), { recursive: true });
  }
});

it("accepts personal settings", async () => {
  await put("antigravity-acp/settings.json", "{}");
  await accepted();
  await put(
    "antigravity-acp/settings.json",
    JSON.stringify({
      auth: { type: "oauth-personal" },
      trustedWorkspaces: ["/a", "/b"],
    }),
  );
  await accepted();
});

it("refuses settings that add anything beyond a personal sign-in", async () => {
  const documents = [
    "not json",
    "[]",
    '{"mcpServers":{}}',
    '{"auth":"x"}',
    '{"auth":null}',
    '{"auth":{"type":"oauth-personal","extra":1}}',
    '{"auth":{"type":"api-key"}}',
    '{"trustedWorkspaces":"x"}',
    '{"trustedWorkspaces":[1]}',
  ];
  for (const document of documents) {
    await put("antigravity-acp/settings.json", document);
    await refused();
  }
  await put("antigravity-acp/settings.json", " ".repeat(70_000));
  await refused();
});

it("refuses settings that are a directory", async () => {
  await mkdir(path.join(home.config, "antigravity-acp", "settings.json"), {
    recursive: true,
  });
  await refused();
});
