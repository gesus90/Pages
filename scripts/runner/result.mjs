import { createHash } from "node:crypto";

import { remoteBanner } from "./opencode.mjs";

function digest(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function usage(counts) {
  const number = (input) =>
    Number.isSafeInteger(input) && input >= 0 ? input : null;
  return {
    inputTokens: number(counts?.input_tokens),
    outputTokens: number(counts?.output_tokens),
    cacheWriteTokens: number(counts?.cache_creation_input_tokens),
    totalTokens: number(counts?.total_tokens),
    cacheReadTokens: number(
      counts?.cached_input_tokens ?? counts?.cache_read_input_tokens,
    ),
  };
}

/** Collects one native terminal receipt and the final answer, independent of the raw output journal. */
export class CliTerminalResult {
  #command;
  #redact;
  #answer = "";
  #hasOversizedAnswer = false;
  #sessionId = null;
  #terminal = null;
  #failureCode;

  constructor(command, redact) {
    this.#command = command;
    this.#redact = redact;
  }

  /** Consumes a parsed provider event once; trailing diagnostics do not hide the terminal event. */
  receive(event) {
    const tool = this.#command.program.route.tool;
    if (tool === "codex") return this.#codex(event);
    if (tool === "claude" && event.type === "result") {
      this.#identify(event.session_id);
      this.#complete(event, {
        answer: event.result,
        status:
          event.is_error === false && event.subtype === "success"
            ? "completed"
            : "failed",
        event: "result",
        usage: usage(event.usage),
      });
    }
    if (tool === "opencode" && event.type === "pages.result") {
      this.#identify(event.sessionId);
      this.#failureCode = event.error;
      this.#complete(event, {
        answer: event.answer,
        status:
          event.stopReason === "end_turn" && !event.error
            ? "completed"
            : "failed",
        event: "session/prompt",
        usage: usage({
          input_tokens: event.usage?.inputTokens,
          output_tokens: event.usage?.outputTokens,
          cached_input_tokens: event.usage?.cachedReadTokens,
          cache_creation_input_tokens: event.usage?.cachedWriteTokens,
          total_tokens: event.usage?.totalTokens,
        }),
      });
    }
  }

  /** Returns only a confirmed, bounded final answer for its negotiated contract. */
  result() {
    if (!this.#terminal)
      return { output: "", reason: "protocol", terminal: undefined };
    if (this.#hasOversizedAnswer)
      return { output: "", reason: "result_limit", terminal: this.#terminal };
    const output = this.#redact(this.#payload());
    return {
      output,
      reason:
        this.#terminal.status === "completed" &&
        this.#terminal.sessionId &&
        output
          ? null
          : "protocol",
      terminal: { ...this.#terminal, answerDigest: digest(output) },
      ...(this.#failureCode ? { failureCode: this.#failureCode } : {}),
    };
  }

  #identify(sessionId) {
    if (typeof sessionId !== "string" || !sessionId || sessionId.length > 200)
      return;
    if (this.#sessionId && this.#sessionId !== sessionId)
      throw Object.assign(new Error("CLI session identity changed"), {
        reason: "protocol",
      });
    this.#sessionId = sessionId;
  }

  #candidate(answer) {
    this.#hasOversizedAnswer =
      typeof answer === "string" &&
      Buffer.byteLength(answer) > this.#command.outputBytes;
    this.#answer =
      typeof answer === "string" && !this.#hasOversizedAnswer ? answer : "";
  }

  #payload() {
    if (!this.#answer) return "";
    if (this.#command.resultPayloadVersion === 1) return this.#answer;
    return `${remoteBanner(this.#command.workspace)}${this.#answer}`;
  }

  #codex(event) {
    if (event.type === "thread.started") this.#identify(event.thread_id);
    if (
      !this.#terminal &&
      ["item.started", "item.updated", "item.completed"].includes(event.type) &&
      [
        "command_execution",
        "mcp_tool_call",
        "file_change",
        "web_search",
        "todo_list",
        "reasoning",
      ].includes(event.item?.type)
    )
      this.#candidate("");
    if (
      event.type === "item.completed" &&
      event.item?.type === "agent_message" &&
      !this.#terminal
    )
      this.#candidate(event.item.text);
    if (["turn.completed", "turn.failed"].includes(event.type))
      this.#complete(event, {
        answer: this.#answer,
        status: event.type === "turn.completed" ? "completed" : "failed",
        event: event.type,
        usage: usage(event.usage),
      });
    if (event.type === "error")
      throw Object.assign(new Error("CLI reported a terminal error"), {
        reason: "protocol",
      });
  }

  #complete(event, receipt) {
    const eventDigest = digest(JSON.stringify(event));
    if (this.#terminal) {
      if (this.#terminal.eventDigest !== eventDigest)
        throw Object.assign(new Error("Contradictory CLI terminal events"), {
          reason: "protocol",
        });
      return;
    }
    const wasOversized = this.#hasOversizedAnswer;
    this.#candidate(receipt.answer);
    this.#hasOversizedAnswer ||= wasOversized;
    const output = this.#payload();
    const redacted = this.#redact(output);
    this.#hasOversizedAnswer ||=
      Buffer.byteLength(output) > this.#command.outputBytes ||
      Buffer.byteLength(redacted) > this.#command.outputBytes;
    this.#terminal = {
      version: 1,
      provider: this.#command.program.route.tool,
      sessionId: this.#sessionId,
      event: receipt.event,
      status: receipt.status,
      usage: receipt.usage,
      eventDigest,
      answerDigest: digest(redacted),
    };
  }
}
