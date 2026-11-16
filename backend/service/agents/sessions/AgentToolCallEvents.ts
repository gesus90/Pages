import {
  PROGRESS_TOOL,
  describeInput,
  describeOutput,
  progressText,
  toolText,
} from "./AgentSessionRecorderEvents";

import type { ToolCallState } from "./AgentSessionRecorderEvents";
import type { AgentSessionEventInput } from "./AgentSessionJournal";
import type { SessionUpdate } from "@agentclientprotocol/sdk";

/**
 * Turns the tool-call updates of one agent session into journal events.
 * @remarks
 * Keeps the state of every open tool call, so that a later update can name
 * what an earlier update only announced.
 */
export class AgentToolCallEvents {
  private readonly tools = new Map<string, ToolCallState>();

  /**
   * The journal event that a tool-call update adds, if it adds one.
   * @param update - The tool-call update reported by the agent.
   * @returns The event to record, or `null` when the update adds none.
   */
  public event(
    update: SessionUpdate,
  ): Omit<AgentSessionEventInput, "turn"> | null {
    if (update.sessionUpdate === "tool_call") {
      const state: ToolCallState = {
        title: update.title,
        kind: update.kind ?? "other",
        input: describeInput(update.rawInput),
        ...(PROGRESS_TOOL.test(update.title) ? { raw: update.rawInput } : {}),
      };
      this.tools.set(update.toolCallId, state);
      return this.announcement(update.toolCallId, state);
    }
    if (update.sessionUpdate !== "tool_call_update") return null;
    const state = this.updatedTool(update);
    if (update.status !== "completed" && update.status !== "failed")
      return this.announcement(update.toolCallId, state);
    this.tools.delete(update.toolCallId);
    const progress =
      update.status === "completed" ? progressText(state.raw) : null;
    if (progress !== null)
      return {
        kind: "progress",
        text: progress,
        dedupeKey: `tool:${update.toolCallId}:progress`,
      };
    return {
      kind: update.status === "completed" ? "tool_completed" : "tool_failed",
      text: toolText(state, describeOutput(update)),
      dedupeKey: `tool:${update.toolCallId}:${update.status}`,
    };
  }

  /** What a tool call reported so far, with this update applied. */
  private updatedTool(
    update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>,
  ): ToolCallState {
    const state = this.tools.get(update.toolCallId) ?? {
      title: "",
      kind: "other",
      input: "",
    };
    if (update.title) state.title = update.title;
    if (update.kind) state.kind = update.kind;
    if (update.rawInput !== undefined)
      state.input = describeInput(update.rawInput);
    if (PROGRESS_TOOL.test(state.title) && update.rawInput !== undefined)
      state.raw = update.rawInput;
    this.tools.set(update.toolCallId, state);
    return state;
  }

  /**
   * The start of a tool call, once its command or path is known.
   *
   * @remarks
   * OpenCode announces a call before its arguments; its start is recorded
   * with the first update that names them, so the terminal shows what runs.
   * A progress report becomes a todo line once Pages took it.
   */
  private announcement(
    toolCallId: string,
    state: ToolCallState,
  ): Omit<AgentSessionEventInput, "turn"> | null {
    if (state.isAnnounced || state.raw !== undefined || state.input === "")
      return null;
    state.isAnnounced = true;
    return {
      kind: "tool_started",
      text: toolText(state),
      dedupeKey: `tool:${toolCallId}:started`,
    };
  }
}
