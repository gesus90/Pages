import { randomUUID } from "node:crypto";

import { acpDriverFor } from "@/backend/agents/acp/AcpDrivers";
import { closeCliSession } from "@/backend/agents/cli/CliSessionCloseout";

import type { Implementation } from "@agentclientprotocol/sdk";
import type { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import type { CliHome } from "@/backend/agents/cli/CliContracts";
import type { AgentToolDefinition } from "./AgentToolRegistry";

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function implementation(input: unknown): input is Implementation {
  return (
    record(input) &&
    typeof input.name === "string" &&
    typeof input.version === "string"
  );
}

/** A bounded model-free protocol exchange through the existing session process. */
export class AgentToolProtocolProbe {
  private readonly runner: Pick<CliProcessRunner, "startSession">;

  public constructor(runner: Pick<CliProcessRunner, "startSession">) {
    this.runner = runner;
  }

  /** Initializes ACP or MCP and confirms cleanup before accepting readiness. */
  public async check(input: {
    readonly tool: AgentToolDefinition;
    readonly file: string;
    readonly home: CliHome;
    readonly signal: AbortSignal;
    readonly environment?: Readonly<Record<string, string>>;
  }): Promise<string | null> {
    const { tool } = input;
    const instanceId = randomUUID();
    let receive: (line: string) => void = () => undefined;
    const child = this.runner.startSession({
      file: tool.id === "pages_mcp" ? process.execPath : input.file,
      arguments: tool.id === "pages_mcp" ? [input.file, "health-check"] : [],
      provider: tool.id === "claude_acp" ? "claude_code" : "codex_cli",
      home: input.home,
      workingDirectory: input.home.work,
      environment: {
        TMPDIR: input.home.root,
        PAGES_RUN_INSTANCE: instanceId,
        NO_BROWSER: "1",
        ...input.environment,
      },
      signal: input.signal,
      timeoutMs: 15_000,
      onLine: (line) => receive(line),
    });
    let version: string | null = null;
    let finish: (result: string | null) => void = () => undefined;
    const answer = new Promise<string | null>((resolve) => {
      finish = resolve;
    });
    receive = (line) => {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (!record(message)) return;
      if (message.id === 1) {
        version = this.initialized(tool, message.result);
        if (
          version === null ||
          tool.probe === "acp" ||
          tool.id === "pages_mcp"
        ) {
          finish(version);
          return;
        }
        child.write(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
          }),
        );
        child.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: {},
          }),
        );
      }
      if (message.id === 2)
        finish(
          record(message.result) &&
            Array.isArray(message.result.tools) &&
            message.result.tools.length > 0
            ? version
            : null,
        );
    };
    try {
      child.write(this.initializeRequest(tool));
      return await Promise.race([answer, child.exited.then(() => null)]);
    } finally {
      child.cancel("login_cancelled");
      const closed = await closeCliSession(child, instanceId);
      if (!closed.isConfirmed)
        throw new Error("Tool probe cleanup unconfirmed");
    }
  }

  private initializeRequest(tool: AgentToolDefinition): string {
    return JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params:
        tool.probe === "acp"
          ? {
              protocolVersion: 1,
              clientCapabilities: {},
              clientInfo: { name: "pages-health", version: "1" },
            }
          : {
              protocolVersion: "2025-11-25",
              capabilities: {},
              clientInfo: { name: "pages-health", version: "1" },
            },
    });
  }

  private initialized(
    tool: AgentToolDefinition,
    result: unknown,
  ): string | null {
    if (!record(result)) return null;
    if (tool.probe === "acp") {
      const provider = tool.id === "claude_acp" ? "claude_code" : "codex_cli";
      return implementation(result.agentInfo) &&
        acpDriverFor(provider).isSupportedAdapter(result.agentInfo) &&
        result.protocolVersion === 1
        ? result.agentInfo.version
        : null;
    }
    return implementation(result.serverInfo) &&
      record(result.capabilities) &&
      record(result.capabilities.tools) &&
      result.protocolVersion === "2025-11-25"
      ? result.serverInfo.version
      : null;
  }
}
