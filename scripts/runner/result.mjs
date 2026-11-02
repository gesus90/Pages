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

// A block or item of these kinds changes nothing outside the conversation.
const CLAUDE_BENIGN_BLOCKS = new Set(["text", "thinking", "redacted_thinking"]);
const CODEX_BENIGN_ITEMS = new Set([
  "agent_message",
  "reasoning",
  "todo_list",
  "error",
]);
const MAXIMUM_TRACKED_CALLS = 10000;
const MAXIMUM_REPORTED_CALLS = 1000000;

// Causes that are permanent or already have their own contract; they never count as a broken session.
const PERMANENT_CAUSE =
  /not logged in|\/login|unauthori[sz]ed|forbidden|invalid[ _-]?(?:api[ _-]?)?key|authenticat|oauth|\b40[123]\b|\b429\b|rate[ _-]?limit|quota|usage limit|insufficient|credit|billing|payment|model[^\n]{0,60}(?:not found|not available|unavailable|not supported|does not exist)|permission|policy|zero data retention|\bzdr\b|content filter|guardrail/iu;

/**
 * Follows one CLI event stream and states what it proves about the session.
 *
 * @remarks
 * Every tool announces a call before it runs, so a stream that began and
 * showed no call proves that a fresh session cannot repeat an effect. A stream
 * that could not be followed to the end proves nothing and says `unknown`.
 */
class ContinuationTrace {
  #tool;
  #isStarted = false;
  #sessionId = null;
  #canResume = false;
  #calls = new Set();
  #extraCalls = 0;
  #isUnreliable = false;
  #sawError = false;
  #causeText = "";
  #result = null;

  constructor(tool) {
    this.#tool = tool;
  }

  get isStarted() {
    return this.#isStarted;
  }

  get sawError() {
    return this.#sawError;
  }

  /** What the stream said about its own failure, only ever matched against known causes. */
  get causeText() {
    return this.#causeText;
  }

  /** The subtype of the final Claude result, `null` before one arrived. */
  get resultSubtype() {
    return this.#result?.subtype ?? null;
  }

  /** A stream that was cut or malformed cannot prove the absence of a tool call. */
  markUnreliable() {
    this.#isUnreliable = true;
  }

  receive(event) {
    if (this.#tool === "claude") this.#claude(event);
    else if (this.#tool === "codex") this.#codex(event);
    else this.#acp(event);
  }

  /** The statement a continuation job reports with its result. */
  evidence() {
    const calls = this.#calls.size + this.#extraCalls;
    let tools = "unknown";
    if (calls > 0) tools = "observed";
    else if (this.#isStarted && !this.#isUnreliable) tools = "none";
    const isOwnSession = ["claude", "codex"].includes(this.#tool);
    return {
      version: 1,
      sessionId: this.#isStarted ? this.#sessionId : null,
      canResume:
        this.#isStarted &&
        this.#sessionId !== null &&
        (isOwnSession || this.#canResume),
      tools,
      calls: Math.min(calls, MAXIMUM_REPORTED_CALLS),
    };
  }

  #start(sessionId) {
    if (typeof sessionId !== "string" || !sessionId || sessionId.length > 200)
      return;
    if (this.#sessionId !== null && this.#sessionId !== sessionId)
      this.#isUnreliable = true;
    this.#isStarted = true;
    this.#sessionId = sessionId;
  }

  #call(id) {
    if (
      typeof id === "string" &&
      id &&
      this.#calls.size < MAXIMUM_TRACKED_CALLS
    )
      this.#calls.add(id);
    else this.#extraCalls += 1;
  }

  #cause(...texts) {
    for (const text of texts)
      if (typeof text === "string")
        this.#causeText = `${this.#causeText}\n${text}`.slice(-8192);
  }

  #claudeBlock(block) {
    if (
      !block ||
      typeof block.type !== "string" ||
      CLAUDE_BENIGN_BLOCKS.has(block.type)
    )
      return;
    this.#call(block.id);
  }

  #claude(event) {
    if (event.type === "system" && event.subtype === "init")
      this.#start(event.session_id);
    if (
      event.type === "stream_event" &&
      event.event?.type === "content_block_start"
    )
      this.#claudeBlock(event.event.content_block);
    if (event.type === "assistant" && Array.isArray(event.message?.content))
      for (const block of event.message.content) this.#claudeBlock(block);
    if (event.type === "result") {
      this.#result = { subtype: event.subtype };
      if (event.is_error === true) {
        this.#sawError = true;
        this.#cause(
          event.result,
          ...(Array.isArray(event.errors) ? event.errors : []),
        );
      }
    }
  }

  #codex(event) {
    if (event.type === "thread.started") this.#start(event.thread_id);
    if (["turn.failed", "error"].includes(event.type)) {
      this.#sawError = true;
      this.#cause(event.error?.message, event.message);
    }
    const item = event.item;
    if (
      ["item.started", "item.updated", "item.completed"].includes(event.type) &&
      item &&
      !CODEX_BENIGN_ITEMS.has(item.type)
    )
      this.#call(item.id);
  }

  #acp(event) {
    if (event.type === "pages.session") {
      this.#start(event.sessionId);
      this.#canResume = event.canResume === true;
    }
    if (
      event.type === "pages.update" &&
      event.update?.sessionUpdate === "tool_call"
    )
      this.#call(event.update.toolCallId);
    if (event.type === "pages.result" && event.error) this.#sawError = true;
  }
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
  #trace;

  constructor(command, redact) {
    this.#command = command;
    this.#redact = redact;
    this.#trace = new ContinuationTrace(command.program.route.tool);
  }

  /** A malformed event leaves the stream unreadable, so no later statement may rest on it. */
  markUnreliable() {
    this.#trace.markUnreliable();
  }

  /**
   * The stable cause of a CLI session that broke off, or `undefined`.
   *
   * @param end - How the process ended: `isStopped` for a stop, timeout or
   * limit set by the runner, the exit code and signal, and the redacted
   * diagnostic tail.
   *
   * @remarks
   * Only a session that began and ended without a sign-in, quota, model or
   * policy cause counts. A continuation that never began names the resume
   * instead; the tool is never asked to open a new conversation in its place.
   */
  sessionFailure(end) {
    const tool = this.#command.program.route.tool;
    if (!["claude", "codex"].includes(tool) || end.isStopped) return undefined;
    if (this.#terminal?.status === "completed") return undefined;
    if (
      this.#command.continuation?.resumeSessionId !== undefined &&
      !this.#trace.isStarted
    )
      return "acp_session_resume_failed";
    if (!this.#trace.isStarted) return undefined;
    if (PERMANENT_CAUSE.test(`${this.#trace.causeText}\n${end.stderr}`))
      return undefined;
    if (this.#terminal)
      return this.#trace.resultSubtype === "error_during_execution"
        ? "plan_runner_session_failed"
        : undefined;
    // The CLI ended abnormally without a terminal event and without naming any cause.
    return !this.#trace.sawError && (end.exitCode !== 0 || end.signal)
      ? "plan_runner_session_failed"
      : undefined;
  }

  /** Consumes a parsed provider event once; trailing diagnostics do not hide the terminal event. */
  receive(event) {
    // The trace sees the event first, so a terminal error it carries is known even when the receipt below refuses it.
    this.#trace.receive(event);
    try {
      this.#consume(event);
    } catch (error) {
      this.#trace.markUnreliable();
      throw error;
    }
  }

  #consume(event) {
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
    if (
      ["opencode", "antigravity"].includes(tool) &&
      event.type === "pages.result"
    ) {
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
    return {
      ...this.#answerResult(),
      ...(this.#command.continuation
        ? { continuation: this.#trace.evidence() }
        : {}),
    };
  }

  #answerResult() {
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
