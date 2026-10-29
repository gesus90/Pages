import { randomUUID } from "node:crypto";

import { client, methods, RequestError } from "@agentclientprotocol/sdk";

import { AcpLineChannel } from "@/backend/agents/acp/AcpLineChannel";
import { ANTIGRAVITY_ACP_DRIVER } from "@/backend/agents/acp/AntigravityAcpDriver";
import { findAcpSelectOption } from "@/backend/agents/acp/AcpConfigOptions";
import { AgentError } from "@/backend/error/AgentErrors";
import { classifyOpenCodeFailure } from "@/backend/agents/acp/OpenCodeAcpErrors";

import { closeCliSession } from "./CliSessionCloseout";
import { readAntigravityChallenge } from "./CliLoginParser";
import { readSpawnScope } from "./CliProcessScan";

import type {
  ClientConnection,
  InitializeResponse,
  SessionConfigOption,
  NewSessionResponse,
} from "@agentclientprotocol/sdk";
import type { CliHome } from "./CliContracts";
import type { CliToolExecution } from "./CliToolExecution";
import type { CliSessionProcess } from "./CliSessionProcess";
import type { TaggedProcessScope } from "./CliProcessScan";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";

/** Short-lived official ACP operations for connection setup and model discovery. */
export class AntigravityProtocol {
  public readonly connection: ClientConnection;
  private readonly child: CliSessionProcess;
  private readonly instanceId: string;
  private readonly scope: TaggedProcessScope;
  private text = "";
  private hasOversizedAnswer = false;
  private hasLoginChallenge = false;

  private constructor(input: {
    readonly child: CliSessionProcess;
    readonly channel: AcpLineChannel;
    readonly instanceId: string;
    readonly scope: TaggedProcessScope;
  }) {
    this.child = input.child;
    this.instanceId = input.instanceId;
    this.scope = input.scope;
    this.connection = client({ name: "pages" })
      .onRequest(methods.client.session.requestPermission, () => ({
        outcome: { outcome: "cancelled" },
      }))
      .onNotification(methods.client.session.update, (notification) => {
        const update = notification.params.update;
        if (
          update.sessionUpdate === "agent_message_chunk" &&
          update.content.type === "text"
        ) {
          this.hasOversizedAnswer ||=
            Buffer.byteLength(this.text + update.content.text) > 65536;
          if (!this.hasOversizedAnswer) this.text += update.content.text;
        }
      })
      .connect(input.channel.stream);
  }

  /** Starts inside the connection context, never inheriting the personal Gemini home. */
  public static async open(
    execution: CliToolExecution,
    home: CliHome,
    options: {
      readonly signal: AbortSignal;
      readonly onStderr?: (tail: string) => void;
    },
  ): Promise<AntigravityProtocol> {
    const instanceId = randomUUID();
    const scope = await readSpawnScope();
    const channel = new AcpLineChannel();
    let protocol: AntigravityProtocol | null = null;
    const child = execution.openProtocol(home, {
      ...options,
      onStderr: (tail) => {
        if (options.onStderr) options.onStderr(tail);
        else if (readAntigravityChallenge(tail)) {
          if (protocol) protocol.hasLoginChallenge = true;
          child.cancel("cli_not_logged_in");
        }
      },
      instanceId,
      onLine: (line) => channel.receive(line),
    });
    channel.attach((line) => child.write(line));
    void child.exited.then(() => channel.close());
    protocol = new AntigravityProtocol({ child, channel, instanceId, scope });
    return protocol;
  }

  /** Verifies the exact registry identity and advertised Google OAuth method. */
  public async initialize(): Promise<InitializeResponse> {
    const response = await this.connection.agent.request(
      methods.agent.initialize,
      {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "pages", version: "0.1.0" },
      },
    );
    if (
      response.protocolVersion !== 1 ||
      !ANTIGRAVITY_ACP_DRIVER.isSupportedAdapter(response.agentInfo) ||
      !response.authMethods?.some((method) => method.id === "oauth-personal")
    )
      throw new AgentError("antigravity_acp_unsupported");
    return response;
  }

  /** Opens a disposable metadata session with every native tool disabled. */
  public async newSession(home: CliHome): Promise<NewSessionResponse> {
    try {
      return await this.connection.agent.request(methods.agent.session.new, {
        cwd: home.work,
        mcpServers: [],
        _meta: { antigravity: { enabledTools: [] } },
      });
    } catch (error: unknown) {
      if (this.hasLoginChallenge) throw new AgentError("cli_not_logged_in");
      throw error;
    }
  }

  /** Confirms both membership and echoed value; a remapped effort or model is refused. */
  public async select(
    sessionId: string,
    options: readonly SessionConfigOption[],
    selection: {
      readonly id: string;
      readonly value: string;
      readonly error: AgentErrorCode;
    },
  ): Promise<readonly SessionConfigOption[]> {
    const offered = findAcpSelectOption(options, selection.id);
    if (!offered?.values.includes(selection.value))
      throw new AgentError(selection.error);
    const response = await this.connection.agent.request(
      methods.agent.session.setConfigOption,
      { sessionId, configId: selection.id, value: selection.value },
    );
    if (
      findAcpSelectOption(response.configOptions, selection.id)
        ?.currentValue !== selection.value
    )
      throw new AgentError(selection.error);
    return response.configOptions;
  }

  /** Sends the explicit administrator model check only after exact selection. */
  public async test(sessionId: string, prompt: string): Promise<boolean> {
    this.text = "";
    this.hasOversizedAnswer = false;
    const result = await this.connection.agent.request(
      methods.agent.session.prompt,
      { sessionId, prompt: [{ type: "text", text: prompt }] },
    );
    return (
      result.stopReason === "end_turn" &&
      !this.hasOversizedAnswer &&
      this.text.trim() === "OK"
    );
  }

  /** Ends the adapter, its loopback callback and tagged children, and confirms closeout. */
  public async close(): Promise<void> {
    this.connection.close();
    this.child.cancel("login_cancelled");
    if (
      !(await closeCliSession(this.child, this.instanceId, this.scope, true))
        .isConfirmed
    )
      throw new AgentError("credential_cleanup_failed");
  }
}

/** Maps ACP failures without exposing OAuth URLs, provider text or error payloads. */
export function antigravityFailure(
  error: unknown,
  signal: AbortSignal,
): AgentErrorCode {
  if (signal.aborted)
    return signal.reason instanceof DOMException &&
      signal.reason.name === "TimeoutError"
      ? "check_timeout"
      : "login_cancelled";
  if (error instanceof AgentError) return error.code;
  if (error instanceof RequestError && error.code === -32000)
    return "cli_not_logged_in";
  const classified = classifyOpenCodeFailure(
    error instanceof Error ? error.message : "",
  );
  return classified === "opencode_acp_session_failed"
    ? "antigravity_acp_session_failed"
    : classified;
}
