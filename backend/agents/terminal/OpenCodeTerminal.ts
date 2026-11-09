import { randomBytes } from "node:crypto";
import { createServer } from "node:net";

import { PAGES_MCP_SERVER } from "@/backend/agents/acp/AcpLaunch";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  asRecord,
  readCount,
  readJsonObject,
  readObject,
  readString,
} from "./TerminalEventFiles";

import type {
  TerminalLaunch,
  TerminalLaunchInput,
  TerminalMonitor,
  TerminalMonitorEvents,
  TerminalTurnEnd,
} from "./TerminalLaunch";

const HOST = "127.0.0.1";
const READY_ATTEMPTS = 120;
const READY_MILLISECONDS = 500;
const RECONNECT_MILLISECONDS = 1_000;

/** A free port on the loopback interface for the interface of the terminal. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds).unref();
  });
}

/** The text parts of the last assistant message of a session. */
function lastAnswer(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  const entries: readonly unknown[] = messages;
  for (const entry of entries.toReversed()) {
    const message = asRecord(entry);
    if (readString(readObject(message, "info"), "role") !== "assistant")
      continue;
    const parts: unknown = message?.parts;
    if (!Array.isArray(parts)) return "";
    return parts
      .map((part: unknown) => asRecord(part))
      .filter((part) => readString(part, "type") === "text")
      .map((part) => readString(part, "text") ?? "")
      .join("");
  }
  return "";
}

/** How a session error ends the turn: an abort is an interruption, anything else a failure. */
function errorEnd(properties: Record<string, unknown>): TerminalTurnEnd {
  const isAborted =
    readString(readObject(properties, "error"), "name") ===
    "MessageAbortedError";
  return isAborted
    ? { status: "interrupted", output: "" }
    : {
        status: "failed",
        output: "",
        errorCode: "opencode_acp_session_failed",
      };
}

/** The permission or question OpenCode waits for, as it names it. */
function questionOf(properties: Record<string, unknown>): string {
  return (
    readString(properties, "permission") ??
    readString(properties, "question") ??
    JSON.stringify(properties).slice(0, 500)
  );
}

/**
 * Follows an OpenCode session through the interface its terminal serves on
 * the loopback interface, protected by the server password like the ACP
 * process: `session.idle` ends a turn, `session.error` with an aborted
 * message ends an interrupted one, and `permission.asked` or
 * `question.asked` is a question nobody answers.
 */
class OpenCodeTerminalMonitor implements TerminalMonitor {
  private readonly address: string;
  private readonly authorization: string;
  private readonly controller = new AbortController();
  private events: TerminalMonitorEvents | null = null;
  private sessionId: string | null = null;
  private readonly messages = new Map<
    string,
    Readonly<Record<string, number | null>>
  >();

  public constructor(port: number, password: string) {
    this.address = `http://${HOST}:${port}`;
    this.authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  }

  /** Connects to the interface once the CLI serves it. */
  public start(events: TerminalMonitorEvents): Promise<void> {
    this.events = events;
    void this.follow();
    return Promise.resolve();
  }

  /** Ends the connection to the interface. */
  public close(): Promise<void> {
    this.controller.abort();
    return Promise.resolve();
  }

  private async follow(): Promise<void> {
    for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
      if (this.controller.signal.aborted) return;
      try {
        await this.read();
      } catch (error: unknown) {
        if (this.controller.signal.aborted) return;
        logCaughtError("OpenCodeTerminalMonitor", error);
      }
      await wait(attempt === 0 ? READY_MILLISECONDS : RECONNECT_MILLISECONDS);
    }
  }

  private async read(): Promise<void> {
    const response = await fetch(`${this.address}/event`, {
      headers: { authorization: this.authorization },
      signal: this.controller.signal,
    });
    if (!response.ok || !response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines)
        if (line.startsWith("data:"))
          await this.event(readJsonObject(line.slice(5)));
    }
  }

  private async event(event: Record<string, unknown> | null): Promise<void> {
    const events = this.events;
    const properties = readObject(event, "properties");
    if (!events || !properties) return;
    const type = readString(event, "type");
    if (type === "session.updated") this.claim(readObject(properties, "info"));
    const sessionId = readString(properties, "sessionID");
    if (sessionId === null || sessionId !== this.sessionId) return;
    if (type === "session.status") {
      if (readString(readObject(properties, "status"), "type") === "busy")
        events.turnStarted();
    } else if (type === "session.idle") {
      events.turnEnded({ status: "completed", output: await this.answer() });
    } else if (type === "session.error") {
      events.turnEnded(errorEnd(properties));
    } else if (type === "message.updated") {
      this.usage(readObject(properties, "info"));
    } else if (type === "permission.asked" || type === "question.asked") {
      events.question(questionOf(properties));
    }
  }

  /** The session of the node is the first one without a parent; subagent sessions have one. */
  private claim(info: Record<string, unknown> | null): void {
    const id = readString(info, "id");
    if (this.sessionId !== null || !id || readString(info, "parentID")) return;
    this.sessionId = id;
    this.events?.identified(id);
  }

  private usage(info: Record<string, unknown> | null): void {
    const id = readString(info, "id");
    if (readString(info, "role") !== "assistant" || id === null) return;
    const tokens = readObject(info, "tokens");
    const cache = readObject(tokens, "cache");
    const counts = {
      inputTokens: readCount(tokens, "input"),
      outputTokens: readCount(tokens, "output"),
      cacheReadTokens: readCount(cache, "read"),
      cacheWriteTokens: readCount(cache, "write"),
    };
    // A message is updated while it streams; only what it gained is new usage.
    const before = this.messages.get(id);
    this.messages.set(id, counts);
    const gained = (field: keyof typeof counts): number | null => {
      const now = counts[field];
      return now === null ? null : Math.max(0, now - (before?.[field] ?? 0));
    };
    const provider = readString(info, "providerID");
    const model = readString(info, "modelID");
    this.events?.usage({
      model: provider && model ? `${provider}/${model}` : model,
      contextUsed:
        (counts.inputTokens ?? 0) +
          (counts.cacheReadTokens ?? 0) +
          (counts.outputTokens ?? 0) || null,
      increment: {
        inputTokens: gained("inputTokens"),
        outputTokens: gained("outputTokens"),
        cacheReadTokens: gained("cacheReadTokens"),
        cacheWriteTokens: gained("cacheWriteTokens"),
        totalTokens: null,
      },
    });
  }

  private async answer(): Promise<string> {
    if (this.sessionId === null) return "";
    try {
      const response = await fetch(
        `${this.address}/session/${this.sessionId}/message`,
        {
          headers: { authorization: this.authorization },
          signal: this.controller.signal,
        },
      );
      return response.ok ? lastAnswer(await response.json()) : "";
    } catch (error: unknown) {
      logCaughtError("OpenCodeTerminalMonitor", error);
      return "";
    }
  }
}

/** Adds the Pages MCP server to the inline configuration the ACP driver planned. */
function withPagesServer(
  configuration: string | undefined,
  mcp: TerminalLaunchInput["mcp"],
): string {
  const planned = readJsonObject(configuration ?? "{}") ?? {};
  if (!mcp) return JSON.stringify(planned);
  return JSON.stringify({
    ...planned,
    mcp: {
      [PAGES_MCP_SERVER]: {
        type: "remote",
        url: mcp.url,
        enabled: true,
        headers: { Authorization: `Bearer ${mcp.token}` },
      },
    },
  });
}

/**
 * Plans the interactive OpenCode of a plan node.
 *
 * @remarks
 * Verified against opencode 1.18.34/1.19.5 (PAGE-265 prototype). The inline
 * configuration of the ACP driver applies unchanged, with the Pages MCP
 * server added; the switches of the CLI environment keep project files,
 * plugins and the updater off, whose dialog would otherwise take the first
 * key. The interface of the terminal listens on a free loopback port behind
 * a fresh server password.
 */
export async function planOpenCodeTerminal(
  launch: TerminalLaunchInput,
): Promise<TerminalLaunch> {
  const { input, mcp, driverEnvironment } = launch;
  const port = await freePort();
  const password =
    driverEnvironment.OPENCODE_SERVER_PASSWORD ??
    randomBytes(32).toString("base64url");
  const options = [
    "--pure",
    "--port",
    String(port),
    "--hostname",
    HOST,
    "-m",
    input.agent.model,
    ...(input.resumeSessionId ? ["--session", input.resumeSessionId] : []),
  ];
  const prompt = `${launch.instruction}\n\n${input.prompt}`;
  return {
    file: launch.cliFile,
    arguments: [...options, "--prompt", prompt, input.directory],
    displayArguments: [...options, "--prompt", "<prompt>", input.directory],
    environment: {
      ...driverEnvironment,
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_CONFIG_CONTENT: withPagesServer(
        driverEnvironment.OPENCODE_CONFIG_CONTENT,
        mcp,
      ),
    },
    secrets: [password, ...(mcp ? [mcp.token] : [])],
    monitor: new OpenCodeTerminalMonitor(port, password),
    interrupt: [
      { data: "\u001b", delayMs: 0 },
      { data: "\u001b", delayMs: 120 },
    ],
    questionPattern: null,
    unattended: `OpenCode in a terminal with the permissions of the mode; a permission request fails the node`,
    sessionId: input.resumeSessionId ?? null,
  };
}
