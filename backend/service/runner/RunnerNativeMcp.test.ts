import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { spawnCli } from "@/scripts/runner/cli.mjs";
import { startPagesRelay } from "@/scripts/runner/pages.mjs";

const fixture = vi.hoisted(() => ({ program: "" }));
vi.mock("@/scripts/runner/opencode.mjs", () => ({
  openCodeCommand: () => [fixture.program],
}));

it("starts the configured Pages stdio MCP natively and preserves a server refusal", async () => {
  const root = path.join(process.cwd(), ".native-cli-tests");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "mcp-"));
  const jobId = randomUUID();
  const seen: unknown[] = [];
  const close = await startPagesRelay(directory, async (identity, request) => {
    expect(identity).toBe(jobId);
    seen.push(request);
    if (typeof request !== "object" || request === null || !("kind" in request))
      throw new Error("Malformed fixture request");
    if (request.kind === "list")
      return {
        tools: [{ name: "read_fixture", inputSchema: { type: "object" } }],
      };
    return "name" in request && request.name === "forbidden_fixture"
      ? { isError: true, error: "FORBIDDEN" }
      : { ok: true, result: "fixture-read" };
  });
  try {
    fixture.program = path.join(directory, "provider.cjs");
    await writeFile(
      fixture.program,
      `
const cp = require('node:child_process');
const config = JSON.parse(process.env.PAGES_OPENCODE_JOB);
const bridge = config.mcpServers.find(server => server.name === 'pages');
const requests = [
 {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}},
 {jsonrpc:'2.0',id:2,method:'tools/list'},
 {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'read_fixture',arguments:{}}},
 {jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'forbidden_fixture',arguments:{}}}
];
const replies = cp.execFileSync(bridge.command, bridge.args, {
 input:requests.map(request => JSON.stringify(request)).join('\\n')+'\\n', encoding:'utf8'
});
process.stdout.write(replies);
`,
    );
    const folder = path.join(directory, "jobs", jobId);
    await mkdir(folder, { recursive: true });
    const child = await spawnCli(
      {
        workspace: directory,
        pagesAccess: 1,
        managed: { ownerId: "fixture", bridge: "fixture" },
        runtimeContext: { environment: { PATH: "/usr/bin:/bin" } },
        program: {
          model: "fixture",
          linkedProvider: "openrouter",
          access: "yolo",
          reasoningEffort: null,
          route: { tool: "opencode", catalogRevision: "fixture" },
        },
      },
      jobId,
      new AbortController().signal,
      folder,
    );
    let output = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdin?.end();
    const code = await new Promise((resolve, reject) => {
      child.once("close", resolve);
      child.once("error", reject);
    });
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(output).toContain("pages-run-step");
    expect(output).toContain("fixture-read");
    expect(output).toContain('"isError":true');
    expect(output).toContain("FORBIDDEN");
    expect(seen).toHaveLength(3);
  } finally {
    await close();
    await rm(directory, { recursive: true, force: true });
  }
});
