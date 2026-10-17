import { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";

import type { CliSpawn } from "@/backend/agents/cli/CliContracts";

/** Synthetic MCP stdio peer; no executable, network or MCP package is started. */
export function toolMcpSpawn(): {
  readonly spawn: CliSpawn;
  readonly methods: string[];
  readonly environments: NodeJS.ProcessEnv[];
} {
  const methods: string[] = [];
  const environments: NodeJS.ProcessEnv[] = [];
  const spawn: CliSpawn = (file, args, options) => {
    if (!file || !Array.isArray(args))
      throw new Error("Invalid synthetic launch");
    environments.push(options.env ?? {});
    const child = new ChildProcess();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    Object.defineProperty(child, "stdin", { value: stdin });
    Object.defineProperty(child, "stdout", { value: stdout });
    Object.defineProperty(child, "stderr", { value: new PassThrough() });
    Object.defineProperty(child, "pid", { value: 9898 });
    stdin.on("data", (chunk: Buffer) => {
      const request: unknown = JSON.parse(chunk.toString());
      if (
        typeof request !== "object" ||
        request === null ||
        !("method" in request) ||
        typeof request.method !== "string"
      )
        return;
      methods.push(request.method);
      if (!("id" in request)) return;
      stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result:
            request.method === "initialize"
              ? {
                  protocolVersion: "2025-11-25",
                  capabilities: { tools: {} },
                  serverInfo: {
                    name: "Playwright",
                    version: "1.64.0-alpha-1790635538000",
                  },
                }
              : { tools: [{ name: "browser_navigate" }] },
        })}\n`,
      );
    });
    stdin.once("finish", () => {
      child.emit("exit", 0, null);
      child.emit("close", 0, null);
    });
    return child;
  };
  return { spawn, methods, environments };
}
