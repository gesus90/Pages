import { methods } from "@agentclientprotocol/sdk";

import { noteSessionEvent } from "@/backend/agents/cli/CliSessionEvents";
import { AgentError } from "@/backend/error/AgentErrors";

import { PAGES_MCP_SERVER } from "./AcpLaunch";
import { readMcpServerStatus } from "./AcpMcpStatus";

import type { ClientConnection, SessionUpdate } from "@agentclientprotocol/sdk";
import type { AcpSessionState } from "./AcpEvents";
import type { McpServerStatus } from "./AcpMcpStatus";

const CONNECT_WAIT_MS = 20_000;
const POLL_MS = 500;

/** Keeps local MCP status commands apart from a model turn and its final answer. */
export class AcpMcpReadiness {
  private readonly connection: ClientConnection;
  private readonly state: AcpSessionState;
  private commandText: string | null = null;

  public constructor(connection: ClientConnection, state: AcpSessionState) {
    this.connection = connection;
    this.state = state;
  }

  /** Consumes updates belonging to a local status command, without exposing them as model output. */
  public receive(update: SessionUpdate): boolean {
    if (this.commandText === null) return false;
    if (
      update.sessionUpdate === "agent_message_chunk" &&
      update.content.type === "text"
    )
      this.commandText += update.content.text;
    return true;
  }

  /** Waits for Pages MCP only when this adapter offers a verified, model-free status command. */
  public async require(sessionId: string, canCheck: boolean): Promise<void> {
    if (this.state.isMcpUnavailable)
      throw new AgentError("plan_mcp_unavailable");
    if (!canCheck) return;
    const deadline = Date.now() + CONNECT_WAIT_MS;
    let previous: McpServerStatus | null = null;
    for (;;) {
      const status = await this.read(sessionId);
      if (status !== previous)
        noteSessionEvent(
          this.state.events,
          `mcp ${PAGES_MCP_SERVER} ${status}`,
        );
      previous = status;
      if (status === "failed") throw new AgentError("plan_mcp_unavailable");
      if (status !== "connecting") return;
      if (Date.now() >= deadline) throw new AgentError("plan_mcp_unavailable");
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  private async read(sessionId: string): Promise<McpServerStatus> {
    this.commandText = "";
    try {
      await this.connection.agent.request(methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text: "/mcp" }],
      });
      return readMcpServerStatus(this.commandText ?? "", PAGES_MCP_SERVER);
    } finally {
      this.commandText = null;
    }
  }
}
