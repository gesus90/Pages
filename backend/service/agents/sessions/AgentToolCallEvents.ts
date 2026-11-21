import {
  PROGRESS_TOOL,
  TODO_LIST_TOOL,
  describeCall,
  describeInput,
  describeOutput,
  progressText,
  reportedCall,
  todoListEvent,
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
  /** Open calls of OpenCode's own task list, whose updates become plan events. */
  private readonly todoLists = new Set<string>();

  /**
   * The journal event that a tool-call update adds, if it adds one.
   * @param update - The tool-call update reported by the agent.
   * @returns The event to record, or `null` when the update adds none.
   */
  public event(
    update: SessionUpdate,
  ): Omit<AgentSessionEventInput, "turn"> | null {
    const todoList = this.todoListUpdate(update);
    if (todoList !== undefined) return todoList;
    if (update.sessionUpdate === "tool_call") {
      const call = reportedCall(update.rawInput, update._meta);
      const state: ToolCallState = {
        callId: update.toolCallId,
        title: update.title,
        kind: update.kind ?? "other",
        input: describeInput(call.input),
        toolName: call.toolName,
        about: describeCall(call.input, call.toolName),
        ...(PROGRESS_TOOL.test(update.title) ? { raw: call.input } : {}),
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

  /**
   * The plan event of an update of OpenCode's own task list.
   * @returns `undefined` for an update of any other call; `null` when the update holds no readable list.
   * @remarks
   * The list replaces the tool lines of the call, so the terminal and the
   * report check read it like a structured plan of the attempt.
   */
  private todoListUpdate(
    update: SessionUpdate,
  ): Omit<AgentSessionEventInput, "turn"> | null | undefined {
    if (update.sessionUpdate === "tool_call") {
      if (update.kind !== "other" || !TODO_LIST_TOOL.test(update.title))
        return undefined;
      this.todoLists.add(update.toolCallId);
      return todoListEvent(update.rawInput, update.rawOutput);
    }
    if (
      update.sessionUpdate !== "tool_call_update" ||
      !this.todoLists.has(update.toolCallId)
    )
      return undefined;
    if (update.status === "completed" || update.status === "failed")
      this.todoLists.delete(update.toolCallId);
    // A failed call changed no list.
    if (update.status === "failed") return null;
    return todoListEvent(update.rawInput, update.rawOutput);
  }

  /** What a tool call reported so far, with this update applied. */
  private updatedTool(
    update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>,
  ): ToolCallState {
    const state = this.tools.get(update.toolCallId) ?? {
      callId: update.toolCallId,
      title: "",
      kind: "other",
      input: "",
    };
    if (update.title) state.title = update.title;
    if (update.kind) state.kind = update.kind;
    // claude-agent-acp repeats `rawInput: null` in later updates; it keeps the command already known.
    const call = reportedCall(update.rawInput, update._meta);
    state.toolName = call.toolName || state.toolName;
    if (update.rawInput !== undefined && update.rawInput !== null) {
      state.input = describeInput(call.input);
      state.about =
        describeCall(call.input, state.toolName ?? "") || state.about;
    }
    if (PROGRESS_TOOL.test(state.title) && update.rawInput !== undefined)
      state.raw = call.input;
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
