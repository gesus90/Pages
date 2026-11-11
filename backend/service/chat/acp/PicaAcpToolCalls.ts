import { redactCredentials } from "@/backend/security/AgentTextSafety";

import type { SessionUpdate, ToolCallContent } from "@agentclientprotocol/sdk";
import type { ChatJobToolEvent } from "@/definition/ChatJob";

/** Characters of the input and of the result a tool call shows in the chat. */
export const TOOL_CALL_TEXT_LIMIT = 4_000;

type ToolUpdate = Extract<
  SessionUpdate,
  { sessionUpdate: "tool_call" | "tool_call_update" }
>;

/** A tool call of the agent as the chat shows it. */
export type PicaNativeToolEvent = Omit<ChatJobToolEvent, "kind">;

function bounded(text: string): string {
  const masked = redactCredentials(text.trim());
  return masked.length > TOOL_CALL_TEXT_LIMIT
    ? `${masked.slice(0, TOOL_CALL_TEXT_LIMIT)}\n[…]`
    : masked;
}

function describe(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  const command: unknown =
    typeof value === "object" && !Array.isArray(value)
      ? Reflect.get(value, "command")
      : null;
  if (typeof command === "string") return command;
  return JSON.stringify(value, null, 2);
}

function contentText(
  content: readonly ToolCallContent[] | null | undefined,
): string | null {
  const parts = (content ?? []).flatMap((entry) => {
    if (entry.type === "diff") return [`diff ${entry.path}`];
    if (entry.type === "terminal") return [`terminal ${entry.terminalId}`];
    return entry.content.type === "text" ? [entry.content.text] : [];
  });
  return parts.length > 0 ? parts.join("\n") : null;
}

function toolName(update: ToolUpdate): string | null {
  const meta = update._meta;
  const claude =
    typeof meta === "object" && meta !== null
      ? Reflect.get(meta, "claudeCode")
      : null;
  const name: unknown =
    typeof claude === "object" && claude !== null
      ? Reflect.get(claude, "toolName")
      : null;
  return typeof name === "string" ? name : null;
}

/** The text of a call, or the one of its earlier state when the update names none. */
function merged(
  text: string | null,
  previous: string | undefined,
): string | undefined {
  return text === null ? previous : bounded(text);
}

function isToolUpdate(update: SessionUpdate): update is ToolUpdate {
  return (
    update.sessionUpdate === "tool_call" ||
    update.sessionUpdate === "tool_call_update"
  );
}

function isOwnTool(name: string | null): boolean {
  return name === "compact" || name?.startsWith("mcp__pages") === true;
}

function status(update: ToolUpdate): ChatJobToolEvent["status"] | null {
  if (update.status === "completed" || update.status === "failed")
    return update.status;
  if (update.status === "pending" || update.status === "in_progress")
    return "running";
  return update.sessionUpdate === "tool_call" ? "running" : null;
}

/**
 * Collects the tool calls an adapter reports for the chat of an agent with
 * host tools (PAGE-303): command or tool, input and result, bounded and with
 * credentials masked.
 *
 * @remarks
 * A call is reported in several updates; each merges into the last known
 * state of its call. The Pages tools come over the bridge or the helper and
 * are journaled there; a call of the Pages MCP server is skipped here, so
 * nothing appears twice. The compaction Claude Code reports as a tool call
 * is not a tool of the agent.
 */
export class PicaAcpToolCalls {
  private readonly calls = new Map<string, PicaNativeToolEvent>();

  /**
   * Reads one update.
   *
   * @returns The new state of the call, or `null` for any other update.
   */
  public read(update: SessionUpdate): PicaNativeToolEvent | null {
    if (!isToolUpdate(update)) return null;
    const name = toolName(update);
    if (isOwnTool(name)) return null;
    const previous = this.calls.get(update.toolCallId);
    const input = merged(describe(update.rawInput), previous?.input);
    const output = merged(
      contentText(update.content) ?? describe(update.rawOutput),
      previous?.output,
    );
    const title = update.title ?? previous?.tool ?? name ?? "tool";
    const next: PicaNativeToolEvent = {
      callId: update.toolCallId,
      tool: bounded(title).slice(0, 200),
      status: status(update) ?? previous?.status ?? "running",
      error: null,
      isNative: true,
      ...(input === undefined ? {} : { input }),
      ...(output === undefined ? {} : { output }),
    };
    this.calls.set(update.toolCallId, next);
    return next;
  }

  /** The calls of the job that still run. */
  public running(): readonly PicaNativeToolEvent[] {
    return [...this.calls.values()].filter((call) => call.status === "running");
  }
}
