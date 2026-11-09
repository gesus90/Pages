import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";
import { PAGES_MCP_SERVER } from "@/backend/agents/acp/AcpLaunch";

import {
  eventFileCommand,
  JsonLinesTail,
  readCount,
  readJsonObject,
  readObject,
  readString,
  TerminalEventDirectory,
} from "./TerminalEventFiles";

import type {
  TerminalLaunch,
  TerminalLaunchInput,
  TerminalMonitor,
  TerminalMonitorEvents,
} from "./TerminalLaunch";

/** The only built-in tools of a "Nur Lesen" session, as over ACP. */
const READ_ONLY_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch"];
const READ_ONLY_DISALLOWED = [
  "Bash",
  "PowerShell",
  "Edit",
  "Write",
  "NotebookEdit",
];
/** Claude asks a person with this tool; a plan run has nobody to answer. */
const QUESTION_TOOL = "AskUserQuestion";
/** The hook events Pages follows; each writes one event file. */
const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
  "StopFailure",
  "Notification",
  "PermissionRequest",
  "Elicitation",
] as const;
/** What Claude writes into its transcript when a person interrupts it. */
const INTERRUPTED = "[Request interrupted by user";

async function writePrivate(file: string, contents: string): Promise<void> {
  await writeFile(file, contents, { mode: 0o600 });
}

/**
 * Marks onboarding, the permission mode and the workspace as accepted in
 * the private configuration of the session.
 *
 * @remarks
 * Without these marks the interactive CLI opens its trust dialog, whose
 * default answer ends it. Other entries the CLI keeps stay as they are.
 */
async function acceptClaudeDialogs(
  configDirectory: string,
  directory: string,
): Promise<void> {
  const file = path.join(configDirectory, ".claude.json");
  const existing = await lstat(file).catch(() => null);
  if (existing && (!existing.isFile() || existing.isSymbolicLink()))
    throw new AgentError("cli_isolation_unavailable");
  const current = existing
    ? readJsonObject(await readFile(file, "utf8"))
    : null;
  const projects = readObject(current, "projects") ?? {};
  const project = readObject(projects, directory) ?? {};
  await writePrivate(
    file,
    JSON.stringify({
      ...current,
      hasCompletedOnboarding: true,
      bypassPermissionsModeAccepted: true,
      projects: {
        ...projects,
        [directory]: { ...project, hasTrustDialogAccepted: true },
      },
    }),
  );
}

function modeArguments(mode: TerminalLaunchInput["mode"]): readonly string[] {
  if (mode === "yolo")
    return [
      "--dangerously-skip-permissions",
      "--disallowedTools",
      QUESTION_TOOL,
    ];
  return [
    // Anything not allowed below is refused without asking anyone.
    "--permission-mode",
    "dontAsk",
    "--tools",
    ...READ_ONLY_TOOLS,
    "--allowedTools",
    "WebSearch",
    "WebFetch",
    `mcp__${PAGES_MCP_SERVER}`,
    "--disallowedTools",
    ...READ_ONLY_DISALLOWED,
    QUESTION_TOOL,
  ];
}

/**
 * Follows a Claude Code session: its hooks report start, prompts, the end of
 * a turn and every question; its transcript reports model, tokens and the end
 * of an interrupted turn, for which no hook runs.
 */
class ClaudeTerminalMonitor implements TerminalMonitor {
  private readonly hooks: TerminalEventDirectory;
  private readonly transcript: JsonLinesTail;
  private events: TerminalMonitorEvents | null = null;

  private readonly isResumed: boolean;

  public constructor(eventDirectory: string, isResumed: boolean) {
    this.isResumed = isResumed;
    this.hooks = new TerminalEventDirectory(eventDirectory, (event) =>
      this.hook(event),
    );
    this.transcript = new JsonLinesTail((line) => this.line(line));
  }

  /** Starts reading the hook events. */
  public async start(events: TerminalMonitorEvents): Promise<void> {
    this.events = events;
    await this.hooks.start();
  }

  /** Reads what is left, stops and removes the event folder. */
  public async close(): Promise<void> {
    await this.hooks.stop();
    await this.transcript.stop();
    await this.hooks.remove();
  }

  private hook(event: Record<string, unknown>): void {
    const events = this.events;
    if (!events) return;
    const name = readString(event, "hook_event_name");
    const transcript = readString(event, "transcript_path");
    if (transcript) this.transcript.follow(transcript, this.isResumed);
    if (name === "SessionStart") {
      const sessionId = readString(event, "session_id");
      if (sessionId) events.identified(sessionId);
    } else if (name === "UserPromptSubmit") events.turnStarted();
    else if (name === "Stop")
      events.turnEnded({
        status: "completed",
        output: readString(event, "last_assistant_message") ?? "",
      });
    else if (name === "StopFailure")
      events.turnEnded({
        status: "failed",
        output: "",
        errorCode: "plan_step_failed",
      });
    else this.ask(name, event);
  }

  private ask(name: string | null, event: Record<string, unknown>): void {
    const kind = readString(event, "notification_type");
    // An idle reminder follows the end of a turn; it asks nothing.
    if (
      name === "Notification" &&
      kind !== "permission_prompt" &&
      kind !== "elicitation_dialog"
    )
      return;
    const tool = readString(event, "tool_name");
    const input = readObject(event, "tool_input");
    const command = readString(input, "command");
    const question =
      readString(event, "message") ??
      [tool, command].filter((part) => part !== null).join(": ");
    this.events?.question(question || "Claude Code waits for an answer");
  }

  private line(line: Record<string, unknown>): void {
    const events = this.events;
    if (!events) return;
    const message = readObject(line, "message");
    if (
      readString(line, "type") === "user" &&
      JSON.stringify(message?.content ?? "").includes(INTERRUPTED)
    ) {
      events.turnEnded({ status: "interrupted", output: "" });
      return;
    }
    if (readString(line, "type") !== "assistant" || line.isSidechain === true)
      return;
    const usage = readObject(message, "usage");
    if (!usage) return;
    const input = readCount(usage, "input_tokens");
    const cacheRead = readCount(usage, "cache_read_input_tokens");
    const cacheWrite = readCount(usage, "cache_creation_input_tokens");
    events.usage({
      model: readString(message, "model"),
      contextUsed: (input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0) || null,
      increment: {
        inputTokens: input,
        outputTokens: readCount(usage, "output_tokens"),
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        totalTokens: null,
      },
    });
  }
}

/**
 * Plans the interactive Claude Code of a plan node.
 *
 * @remarks
 * Verified against Claude Code 2.1.293 (PAGE-265 prototype): only the
 * settings and MCP files Pages writes apply, the trust dialog is accepted in
 * the private configuration, the updater is off (`DISABLE_AUTOUPDATER` of
 * the CLI environment) and the prompt is sent at the start. YOLO skips every
 * permission check inside bubblewrap; "Nur Lesen" offers only the reading
 * tools and refuses anything else without asking. The question tool is
 * removed in both modes; the agent decides on its own.
 */
export async function planClaudeTerminal(
  launch: TerminalLaunchInput,
): Promise<TerminalLaunch> {
  const { input, sessionDirectory, mcp } = launch;
  const sessionId = input.resumeSessionId ?? randomUUID();
  const eventDirectory = path.join(sessionDirectory, "events");
  // The first hook runs before the session watches; its folder must exist already.
  await mkdir(eventDirectory, { recursive: true, mode: 0o700 });
  await acceptClaudeDialogs(launch.home.config, input.directory);
  const settingsFile = path.join(sessionDirectory, "settings.json");
  const hook = [
    {
      hooks: [
        { type: "command", command: eventFileCommand(eventDirectory, "stdin") },
      ],
    },
  ];
  await writePrivate(
    settingsFile,
    JSON.stringify({
      hooks: Object.fromEntries(HOOK_EVENTS.map((name) => [name, hook])),
    }),
  );
  const mcpFile = path.join(sessionDirectory, "mcp.json");
  await writePrivate(
    mcpFile,
    JSON.stringify({
      mcpServers: mcp
        ? {
            [PAGES_MCP_SERVER]: {
              type: "http",
              url: mcp.url,
              headers: { Authorization: `Bearer ${mcp.token}` },
            },
          }
        : {},
    }),
  );
  const options = [
    ...(input.resumeSessionId
      ? ["--resume", sessionId]
      : ["--session-id", sessionId]),
    "--model",
    input.agent.model,
    ...(input.agent.reasoningEffort
      ? ["--effort", input.agent.reasoningEffort]
      : []),
    "--setting-sources",
    "",
    "--settings",
    settingsFile,
    "--mcp-config",
    mcpFile,
    "--strict-mcp-config",
    ...modeArguments(launch.mode),
    "--append-system-prompt",
    launch.instruction,
  ];
  return {
    file: launch.cliFile,
    arguments: [...options, "--", input.prompt],
    displayArguments: [...options, "--", "<prompt>"],
    environment: launch.driverEnvironment,
    secrets: mcp ? [mcp.token] : [],
    monitor: new ClaudeTerminalMonitor(
      eventDirectory,
      Boolean(input.resumeSessionId),
    ),
    interrupt: [{ data: "\u001b", delayMs: 0 }],
    questionPattern: null,
    unattended:
      launch.mode === "yolo"
        ? "Claude Code in a terminal, permission checks skipped inside the bubblewrap isolation, question tool removed"
        : "Claude Code in a terminal with the reading tools only; anything else is refused without asking, question tool removed",
    sessionId,
  };
}
