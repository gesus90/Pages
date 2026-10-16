import { readAgentObject } from "@/backend/agents/AgentPayload";

const MAXIMUM_EVENTS = 60;
const MAXIMUM_EVENT_CHARACTERS = 200;

/** What Pages learned from the events of one session so far. */
export interface CliSessionState {
  sessionId: string | null;
  /** The newest final answer of the agent. */
  text: string;
  /** The runner reported the end of its turn. */
  isTurnComplete: boolean;
  /** The runner reported a failed turn. */
  hasFailed: boolean;
  /** Actions the runner refused because nobody may approve them. */
  permissionDenials: number;
  /** What the runner reported about itself. */
  readonly effective: Record<string, string>;
  /** Short lines of what happened, newest last. */
  readonly events: string[];
}

/** What one event line changed that the caller reacts to. */
export interface CliSessionUpdate {
  /** The runner named its session for the first time. */
  readonly identified?: string;
  /** An interactive runner ended its turn. */
  readonly turnEnded?: boolean;
}

/** Creates the state of a session that has not reported anything yet. */
export function createCliSessionState(): CliSessionState {
  return {
    sessionId: null,
    text: "",
    isTurnComplete: false,
    hasFailed: false,
    permissionDenials: 0,
    effective: {},
    events: [],
  };
}

/**
 * Keeps one short line of what happened in a session.
 *
 * @param events - The lines kept so far, newest last; changed in place.
 * @param line - What happened; it is shortened, and the caller redacts it before storing.
 */
export function noteSessionEvent(events: string[], line: string): void {
  events.push(line.replace(/\s+/gu, " ").slice(0, MAXIMUM_EVENT_CHARACTERS));
  if (events.length > MAXIMUM_EVENTS) events.shift();
}

function note(state: CliSessionState, line: string): void {
  noteSessionEvent(state.events, line);
}

function identify(state: CliSessionState, id: unknown): CliSessionUpdate {
  if (typeof id !== "string" || !id || state.sessionId !== null) return {};
  state.sessionId = id.slice(0, 200);
  note(state, `session ${state.sessionId}`);
  return { identified: state.sessionId };
}

function text(input: unknown): string {
  return typeof input === "string" ? input : "";
}

function readOpenCode(
  state: CliSessionState,
  event: Record<string, unknown>,
): CliSessionUpdate {
  const update = identify(state, event.sessionID);
  const part = readAgentObject(event.part);
  if (event.type === "step_start") state.text = "";
  if (event.type === "text") state.text += text(part.text);
  if (event.type === "tool_use") {
    const tool = readAgentObject(part.state);
    note(state, `tool ${text(part.tool)} ${text(tool.status)}`);
  }
  if (event.type === "step_finish" && part.reason === "stop") {
    state.isTurnComplete = true;
    note(state, "turn completed");
  }
  if (event.type === "error") {
    state.hasFailed = true;
    note(state, `error ${text(readAgentObject(event.error).name)}`);
  }
  return update;
}

/**
 * Reads one event line of a runner into the session state.
 *
 * @param provider - The runner that printed the line.
 * @param line - One complete JSON line.
 * @param state - The state, updated in place.
 * @returns What the caller has to react to.
 *
 * @remarks
 * Lines that are no JSON are diagnostics and are ignored. Event text is kept
 * short; the caller redacts it before it is stored. Codex and Claude Code
 * speak ACP and report through the reader of their session.
 */
export function readCliSessionLine(
  provider: "opencode",
  line: string,
  state: CliSessionState,
): CliSessionUpdate {
  let event: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(line);
    event = readAgentObject(parsed);
  } catch {
    return {};
  }
  switch (provider) {
    case "opencode":
      return readOpenCode(state, event);
  }
}
