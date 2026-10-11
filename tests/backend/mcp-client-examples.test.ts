import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";

import { assertNoSecrets } from "../../mcp/scripts/package-release";

const EXAMPLES_DIRECTORY = fileURLToPath(
  new URL("../../mcp/examples/clients", import.meta.url),
);
const BUNDLE_PLACEHOLDER = "pages-mcp-vX.Y.Z.js";

function readExample(name: string): string {
  return readFileSync(path.join(EXAMPLES_DIRECTORY, name), "utf8");
}

function readJsonExample(name: string): unknown {
  return JSON.parse(readExample(name));
}

describe("client configuration examples", () => {
  it("covers exactly the four acceptance clients", () => {
    expect(readdirSync(EXAMPLES_DIRECTORY).sort()).toEqual([
      "claude-cli.mcp.json",
      "codex-config.toml",
      "openclaw.json",
      "opencode.json",
    ]);
  });

  it("contains placeholders only, no credential, instance address or token value", () => {
    const entries = readdirSync(EXAMPLES_DIRECTORY).map((name) => ({
      name,
      content: Buffer.from(readExample(name)),
    }));
    expect(() => assertNoSecrets(entries, {})).not.toThrow();
    for (const { name, content } of entries) {
      const text = content.toString("utf8");
      expect(text, name).toContain(BUNDLE_PLACEHOLDER);
      expect(text, name).toContain("https://pages.example.com");
      expect(text, name).toContain("https://mcp.example.com/mcp");
    }
  });

  it("configures Claude CLI for stdio with a token variable and for HTTP without one", () => {
    expect(readJsonExample("claude-cli.mcp.json")).toEqual({
      mcpServers: {
        pages: {
          type: "stdio",
          command: "node",
          args: [`/path/to/${BUNDLE_PLACEHOLDER}`],
          env: {
            PAGES_URL: "https://pages.example.com",
            PAGES_TOKEN: "${PAGES_TOKEN}",
          },
        },
        "pages-http": { type: "http", url: "https://mcp.example.com/mcp" },
      },
    });
  });

  it("configures Codex to forward the token variable instead of storing it", () => {
    expect(parseToml(readExample("codex-config.toml"))).toEqual({
      mcp_servers: {
        pages: {
          command: "node",
          args: [`/path/to/${BUNDLE_PLACEHOLDER}`],
          env_vars: ["PAGES_TOKEN"],
          env: { PAGES_URL: "https://pages.example.com" },
        },
        "pages-http": { url: "https://mcp.example.com/mcp" },
      },
    });
  });

  it("configures OpenClaw with a token variable and OAuth for HTTP", () => {
    expect(readJsonExample("openclaw.json")).toEqual({
      mcp: {
        servers: {
          pages: {
            command: "node",
            args: [`/path/to/${BUNDLE_PLACEHOLDER}`],
            env: {
              PAGES_URL: "https://pages.example.com",
              PAGES_TOKEN: "${PAGES_TOKEN}",
            },
          },
          "pages-http": {
            url: "https://mcp.example.com/mcp",
            transport: "streamable-http",
            auth: "oauth",
          },
        },
      },
    });
  });

  it("configures OpenCode with an environment reference and a remote OAuth server", () => {
    expect(readJsonExample("opencode.json")).toEqual({
      mcp: {
        pages: {
          type: "local",
          command: ["node", `/path/to/${BUNDLE_PLACEHOLDER}`],
          environment: {
            PAGES_URL: "https://pages.example.com",
            PAGES_TOKEN: "{env:PAGES_TOKEN}",
          },
        },
        "pages-http": { type: "remote", url: "https://mcp.example.com/mcp" },
      },
    });
  });
});
