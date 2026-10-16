import type {
  ContentBlock,
  McpServer,
  PromptCapabilities,
  SessionUpdate,
  Usage,
} from "@agentclientprotocol/sdk";

/** The extension method of codex-acp that adds a prompt to the running turn. */
export const ACP_STEERING_METHOD = "_session/steering";

/**
 * What became of a steering prompt.
 *
 * @remarks
 * `injected` joined the running turn, `startedNewTurn` means the adapter found
 * no running turn and started one of its own, `failed` is the adapter's own
 * refusal or a lost request, and `inactive` means Pages did not send it
 * because no prompt of the session was running.
 */
export type AcpSteerOutcome =
  "injected" | "startedNewTurn" | "failed" | "inactive";

/** Prompt blocks resolved right before a prompt, checked against what the adapter negotiated. */
export type AcpPromptContent = (
  capabilities: PromptCapabilities | null | undefined,
) => Promise<readonly ContentBlock[]>;

/** Receives what the adapter reports while a chat session runs; it must not throw. */
export interface AcpSessionListener {
  readonly update: (update: SessionUpdate) => void;
  /** The token usage the adapter returned with a prompt, or `null` without one. */
  readonly prompted: (usage: Usage | null) => void;
  /** The connection to the adapter ended, for example because its process exited. */
  readonly closed: () => void;
}

/** What a chat session adds to a plan session: its MCP bridge, its continuation and its updates. */
export interface AcpChatOptions {
  /** The only MCP servers of the session, in place of the Pages MCP process of a plan node. */
  readonly mcpServers: readonly McpServer[];
  /** The protocol session to continue with `session/resume`; `null` starts a new one. */
  readonly resumeSessionId: string | null;
  readonly listener: AcpSessionListener;
}

/**
 * Reads the answer of codex-acp to a steering request.
 *
 * @param response - The result of `_session/steering`.
 * @returns The outcome; anything the adapter does not document counts as failed.
 */
export function readAcpSteerOutcome(response: unknown): AcpSteerOutcome {
  if (typeof response !== "object" || response === null) return "failed";
  const outcome: unknown = Reflect.get(response, "outcome");
  return outcome === "injected" || outcome === "startedNewTurn"
    ? outcome
    : "failed";
}
