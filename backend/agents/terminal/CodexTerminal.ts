import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { PAGES_MCP_SERVER } from "@/backend/agents/acp/AcpLaunch";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  JsonLinesTail,
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
} from "./TerminalLaunch";

/** The variable that carries the step credential to the Pages MCP server; it never is an argument. */
const MCP_TOKEN_VARIABLE = "PAGES_MCP_TOKEN";
const DISCOVERY_MILLISECONDS = 500;
/** Codex shows these when it waits for an approval; a plan run never answers one. */
const APPROVAL_QUESTION =
  /Would you like to (?:run the following command|make the following edits|grant these permissions)/u;

/** One TOML value of a `-c` override; JSON strings, numbers, booleans and string lists are valid TOML. */
function tomlValue(value: unknown): string | null {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return JSON.stringify(value);
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string"))
    return JSON.stringify(value);
  return null;
}

/** Flattens a configuration object into `-c key=value` overrides. */
function overrides(
  configuration: Readonly<Record<string, unknown>>,
  prefix = "",
): readonly string[] {
  return Object.entries(configuration).flatMap(([key, value]) => {
    const name = `${prefix}${key}`;
    if (typeof value === "object" && value !== null && !Array.isArray(value))
      return overrides(Object.fromEntries(Object.entries(value)), `${name}.`);
    const toml = tomlValue(value);
    return toml === null ? [] : ["-c", `${name}=${toml}`];
  });
}

/** The date folders of the rollouts written since a time: its day and the next. */
function rolloutFolders(home: string, since: Date): readonly string[] {
  return [0, 1].map((days) => {
    const day = new Date(since.getTime() + days * 86_400_000);
    return path.join(
      home,
      "sessions",
      String(day.getFullYear()),
      String(day.getMonth() + 1).padStart(2, "0"),
      String(day.getDate()).padStart(2, "0"),
    );
  });
}

/** The rollout files written since a time, oldest first. */
async function rolloutsSince(
  home: string,
  since: Date,
): Promise<readonly string[]> {
  const candidates: { readonly file: string; readonly created: number }[] = [];
  for (const folder of rolloutFolders(home, since)) {
    const names = await readdir(folder).catch(() => []);
    for (const name of names.filter((entry) => entry.startsWith("rollout-"))) {
      const file = path.join(folder, name);
      const metadata = await stat(file);
      const created = metadata.birthtimeMs || metadata.ctimeMs;
      if (created >= since.getTime() - 1_000)
        candidates.push({ file, created });
    }
  }
  return candidates
    .sort((left, right) => left.created - right.created)
    .map((candidate) => candidate.file);
}

/**
 * Follows a Codex session through its rollout file: the token counts, the
 * context window, the end of a turn and the end of an interrupted turn.
 *
 * @remarks
 * Codex writes the rollout of every thread below `CODEX_HOME/sessions`. The
 * session's own thread is the first rollout written after the start whose
 * working directory is the node's; a title thread of the same session is
 * written later and never followed.
 */
class CodexTerminalMonitor implements TerminalMonitor {
  private readonly home: string;
  private readonly directory: string;
  private readonly startedAt = new Date();
  private readonly tail: JsonLinesTail;
  private events: TerminalMonitorEvents | null = null;
  private discovery: ReturnType<typeof setInterval> | null = null;
  private isFound = false;
  private lastMessage = "";
  private readonly totals = new Map<string, number>();

  public constructor(home: string, directory: string) {
    this.home = home;
    this.directory = directory;
    this.tail = new JsonLinesTail((line) => this.line(line));
  }

  /** Looks for the rollout of the session until it appears. */
  public start(events: TerminalMonitorEvents): Promise<void> {
    this.events = events;
    this.discovery = setInterval(() => {
      void this.discover();
    }, DISCOVERY_MILLISECONDS);
    this.discovery.unref();
    return Promise.resolve();
  }

  /** Stops looking and reads the rest of the rollout. */
  public async close(): Promise<void> {
    if (this.discovery !== null) clearInterval(this.discovery);
    this.discovery = null;
    await this.tail.stop();
  }

  private async discover(): Promise<void> {
    if (this.isFound) return;
    try {
      for (const file of await rolloutsSince(this.home, this.startedAt)) {
        if (!(await this.isOwnRollout(file))) continue;
        this.isFound = true;
        if (this.discovery !== null) clearInterval(this.discovery);
        this.tail.follow(file);
        return;
      }
    } catch (error: unknown) {
      logCaughtError("CodexTerminalMonitor", error);
    }
  }

  private async isOwnRollout(file: string): Promise<boolean> {
    const first = (await readFile(file, "utf8")).split("\n", 1)[0] ?? "";
    const meta = readObject(readJsonObject(first), "payload");
    if (readString(meta, "cwd") !== this.directory) return false;
    const sessionId = readString(meta, "id");
    if (sessionId) this.events?.identified(sessionId);
    return true;
  }

  private line(line: Record<string, unknown>): void {
    const events = this.events;
    const payload = readObject(line, "payload");
    if (!events || !payload) return;
    const type = readString(payload, "type");
    if (readString(line, "type") === "turn_context") {
      events.usage({
        model: readString(payload, "model"),
        reasoningEffort: readString(payload, "effort"),
      });
      return;
    }
    if (type === "task_started" || type === "user_message")
      events.turnStarted();
    else if (type === "agent_message")
      this.lastMessage = readString(payload, "message") ?? "";
    else if (type === "token_count") this.usage(payload);
    else if (type === "task_complete")
      events.turnEnded({
        status: "completed",
        output: readString(payload, "last_agent_message") ?? this.lastMessage,
      });
    else if (type === "turn_aborted")
      events.turnEnded({ status: "interrupted", output: this.lastMessage });
  }

  private usage(payload: Record<string, unknown>): void {
    const info = readObject(payload, "info");
    const last = readObject(info, "last_token_usage");
    const total = readObject(info, "total_token_usage");
    if (!last || !total) return;
    // Codex repeats a report with the same totals; only a growth is new usage.
    const delta = (field: string): number | null => {
      const now = readCount(total, field);
      if (now === null) return null;
      const before = this.totals.get(field) ?? 0;
      this.totals.set(field, now);
      return Math.max(0, now - before);
    };
    this.events?.usage({
      contextUsed: readCount(last, "total_tokens"),
      contextLimit: readCount(info, "model_context_window"),
      increment: {
        inputTokens: delta("input_tokens"),
        outputTokens: delta("output_tokens"),
        cacheReadTokens: delta("cached_input_tokens"),
        cacheWriteTokens: null,
        totalTokens: delta("total_tokens"),
      },
    });
  }
}

/**
 * Plans the interactive Codex of a plan node.
 *
 * @remarks
 * Verified against codex-cli 0.160.0 (PAGE-265 prototype). Every setting is
 * a `-c` override above the configuration files, so the connection's
 * `CODEX_HOME` keeps no file of Pages: model, effort, the profile of the
 * mode, the workspace trust, no update check and the Pages MCP server, whose
 * tools are approved and whose credential comes from the environment.
 * `--no-alt-screen` keeps an ordinary terminal output with its own
 * scrollback; `--no-daemon` keeps the session in this process. YOLO runs
 * without approvals inside bubblewrap; "Nur Lesen" never asks and keeps
 * Codex's read-only sandbox.
 */
export function planCodexTerminal(launch: TerminalLaunchInput): TerminalLaunch {
  const { input, mcp } = launch;
  const options = [
    "--no-alt-screen",
    "--no-daemon",
    "-C",
    input.directory,
    ...(launch.mode === "yolo"
      ? ["--dangerously-bypass-approvals-and-sandbox"]
      : ["-a", "never", "-s", "read-only"]),
    ...overrides({
      ...launch.configuration,
      model: input.agent.model,
      ...(input.agent.reasoningEffort
        ? { model_reasoning_effort: input.agent.reasoningEffort }
        : {}),
      check_for_update_on_startup: false,
    }),
    "-c",
    `projects.${JSON.stringify(input.directory)}.trust_level="trusted"`,
    ...(mcp
      ? overrides({
          [`mcp_servers.${PAGES_MCP_SERVER}`]: {
            url: mcp.url,
            bearer_token_env_var: MCP_TOKEN_VARIABLE,
            default_tools_approval_mode: "approve",
          },
        })
      : []),
  ];
  const prompt = `${launch.instruction}\n\n${input.prompt}`;
  return {
    file: launch.cliFile,
    arguments: [
      ...options,
      ...(input.resumeSessionId ? ["resume", input.resumeSessionId] : []),
      prompt,
    ],
    displayArguments: [...options, "<prompt>"],
    environment: {
      NO_BROWSER: "1",
      ...(mcp ? { [MCP_TOKEN_VARIABLE]: mcp.token } : {}),
    },
    secrets: mcp ? [mcp.token] : [],
    monitor: new CodexTerminalMonitor(launch.home.config, input.directory),
    // Escape ends the turn; `/stop` ends the commands it left running in the background.
    interrupt: [
      { data: "\u001b", delayMs: 0 },
      { data: "/stop", delayMs: 400 },
      { data: "\r", delayMs: 150 },
    ],
    questionPattern: APPROVAL_QUESTION,
    unattended:
      launch.mode === "yolo"
        ? "Codex in a terminal without approvals inside the bubblewrap isolation"
        : "Codex in a terminal, approval never, read-only sandbox",
    sessionId: input.resumeSessionId ?? null,
  };
}
